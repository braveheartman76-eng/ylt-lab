-- ============================================================
-- 노량진 형사법 헌터 — 게임 전용 스키마 (001)
--
-- 원칙
--  * 기존 운영 테이블(profiles, quiz_*, exam_*, materials ...)은 수정하지 않는다.
--    profiles 는 FK 참조와 current_user_role() 호출만 한다 (읽기 전용 의존).
--  * 모든 게임 테이블은 game_ 접두사를 사용한다.
--  * 풀이기록(game_answer_attempts)과 문항 버전(game_question_versions)은
--    append-only 이다. UPDATE/DELETE 는 트리거로 차단된다.
--  * 학생은 검수완료(approved) + 활성 문항만 볼 수 있고,
--    채점/복습예약 갱신은 game_submit_attempt() RPC 로만 이루어진다.
--  * 이 파일은 사전 승인 없이 운영 Supabase 에 실행하지 말 것.
--    (개발용 별도 프로젝트 또는 로컬에서 먼저 검증)
-- ============================================================

-- ------------------------------------------------------------
-- 0. 열거형 대신 CHECK 제약 사용 (마이그레이션 용이)
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 1. 과목 / 단원
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_subjects (
  id          TEXT PRIMARY KEY,                -- 'criminal_law', 'criminal_procedure'
  name        TEXT NOT NULL,                   -- '형법', '형사소송법'
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

-- 대단원(level 1) > 중단원(2) > 소단원(3) 자기참조 트리
CREATE TABLE IF NOT EXISTS game_units (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id  TEXT NOT NULL REFERENCES game_subjects(id),
  parent_id   UUID REFERENCES game_units(id),
  level       SMALLINT NOT NULL CHECK (level BETWEEN 1 AND 3),
  title       TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (subject_id, parent_id, title)
);
CREATE INDEX IF NOT EXISTS idx_game_units_subject ON game_units(subject_id);
CREATE INDEX IF NOT EXISTS idx_game_units_parent  ON game_units(parent_id);

-- ------------------------------------------------------------
-- 2. 가져오기 배치 (원본 파일 추적)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_import_batches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file   TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  book_title    TEXT NOT NULL,
  question_count INTEGER NOT NULL DEFAULT 0,
  warning_count  INTEGER NOT NULL DEFAULT 0,
  is_test_data  BOOLEAN NOT NULL DEFAULT FALSE,
  imported_by   UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_sha256)
);

-- ------------------------------------------------------------
-- 3. 문항 (고정 신원) + 버전 (불변 내용)
--    문제집 개정/정답 수정 시 새 버전을 추가하고 current_version_id 만 옮긴다.
--    기존 풀이기록은 학습 당시 version_id 를 그대로 가리킨다.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_questions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id         TEXT NOT NULL REFERENCES game_subjects(id),
  unit_id            UUID REFERENCES game_units(id),     -- 소단원(없으면 상위 단원)
  source_book        TEXT NOT NULL,                      -- 원본 교재명
  source_page        INTEGER,                            -- 원본 페이지 (추출 불가 시 NULL)
  source_no          TEXT NOT NULL,                      -- 원본 문제번호
  import_batch_id    UUID REFERENCES game_import_batches(id),
  current_version_id UUID,                               -- FK 는 아래에서 추가 (순환 참조)
  review_status      TEXT NOT NULL DEFAULT 'pending'
                       CHECK (review_status IN ('pending','approved','rejected','needs_fix')),
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,      -- 법령 개정 등으로 비활성화
  is_test_data       BOOLEAN NOT NULL DEFAULT FALSE,     -- 가상 테스트 문항 표시
  deactivated_reason TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_book, source_no)
);
CREATE INDEX IF NOT EXISTS idx_game_questions_unit    ON game_questions(unit_id);
CREATE INDEX IF NOT EXISTS idx_game_questions_subject ON game_questions(subject_id);
CREATE INDEX IF NOT EXISTS idx_game_questions_serve
  ON game_questions(subject_id) WHERE review_status = 'approved' AND is_active;

CREATE TABLE IF NOT EXISTS game_question_versions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id      UUID NOT NULL REFERENCES game_questions(id),
  version_no       INTEGER NOT NULL,
  statement        TEXT NOT NULL,                        -- 문제 원문 (보존)
  answer           CHAR(1) NOT NULL CHECK (answer IN ('O','X')),
  explanation      TEXT,                                 -- 원본 해설 (보존)
  raw_markers      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- 원본 표시 기호 (해석 없이 원문 그대로)
  law_basis_date   DATE,                                 -- 관련 법령 기준일
  change_note      TEXT,
  created_by        UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (question_id, version_no)
);

ALTER TABLE game_questions
  ADD CONSTRAINT game_questions_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES game_question_versions(id)
  DEFERRABLE INITIALLY DEFERRED;

-- ------------------------------------------------------------
-- 4. 문항 메타데이터: 난이도 / 중요도 / 출제빈도 는 별도 개념
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_question_metadata (
  question_id        UUID PRIMARY KEY REFERENCES game_questions(id),
  -- 난이도 (D1~D5). 초기=예상, 이후 학생 데이터로 보정
  difficulty_initial SMALLINT CHECK (difficulty_initial BETWEEN 1 AND 5),
  difficulty_basis   TEXT,                               -- 설정 근거
  difficulty_adjusted NUMERIC(3,2),                      -- 데이터 보정값 (1.00~5.00)
  -- 중요도: 출제빈도와 별개
  importance         SMALLINT CHECK (importance BETWEEN 1 AND 5),
  importance_basis   TEXT,                               -- 원본 표시/조문 비중/기출 근거 등
  -- 출제빈도: 검증된 기출 근거가 있을 때만 숫자. 없으면 'unverified'
  exam_frequency        INTEGER CHECK (exam_frequency >= 0),
  exam_frequency_status TEXT NOT NULL DEFAULT 'unverified'
                          CHECK (exam_frequency_status IN ('unverified','verified')),
  CONSTRAINT freq_requires_verified
    CHECK (exam_frequency IS NULL OR exam_frequency_status = 'verified'),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 5. 문항 근거: 조문 / 판례 / 기출
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_question_sources (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  UUID NOT NULL REFERENCES game_questions(id),
  source_type  TEXT NOT NULL CHECK (source_type IN ('statute','precedent','past_exam')),
  citation     TEXT NOT NULL,         -- 예: '형사소송법 제212조', '대판 2020도1234', '2023 경찰 1차'
  exam_year    SMALLINT,              -- past_exam 일 때
  exam_name    TEXT,
  reference_url TEXT,
  is_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at  DATE
);
CREATE INDEX IF NOT EXISTS idx_game_qsources_q ON game_question_sources(question_id);

-- 오류 신고
CREATE TABLE IF NOT EXISTS game_question_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES game_questions(id),
  user_id     UUID NOT NULL REFERENCES profiles(id),
  message     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 6. 학습자 프로필 (직렬 선택 등 게임 전용 정보)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_player_profiles (
  user_id     UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  track       TEXT NOT NULL DEFAULT 'police'
                CHECK (track IN ('police','corrections','prosecution','court','other')),
  nickname    TEXT,
  exam_date   DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 7. 풀이 기록 — append-only
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_answer_attempts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES profiles(id),
  question_id         UUID NOT NULL REFERENCES game_questions(id),
  question_version_id UUID NOT NULL REFERENCES game_question_versions(id),
  attempted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  selected            CHAR(1) NOT NULL CHECK (selected IN ('O','X')),
  is_correct          BOOLEAN NOT NULL,
  elapsed_ms          INTEGER CHECK (elapsed_ms >= 0),
  attempt_no          INTEGER NOT NULL,          -- 이 학생의 이 문항 n번째 풀이
  was_review          BOOLEAN NOT NULL,          -- 복습 예정 문항이었는지
  -- 풀이 직후의 스냅샷 (이력 분석용)
  wrong_count_after   INTEGER NOT NULL,
  review_count_after  INTEGER NOT NULL,
  streak_after        INTEGER NOT NULL,
  mastery_after       SMALLINT NOT NULL,
  next_review_after   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_attempts_user_time ON game_answer_attempts(user_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_game_attempts_user_q    ON game_answer_attempts(user_id, question_id);

-- ------------------------------------------------------------
-- 8. 복습 일정 (학생 x 문항 1행)
-- ------------------------------------------------------------
-- 간격 설정표: 운영 중 학생 데이터로 조정할 수 있도록 테이블화
CREATE TABLE IF NOT EXISTS game_srs_intervals (
  box              SMALLINT PRIMARY KEY CHECK (box BETWEEN 0 AND 5),
  interval_minutes INTEGER  NOT NULL CHECK (interval_minutes >= 0),
  note             TEXT
);
INSERT INTO game_srs_intervals(box, interval_minutes, note) VALUES
  (0,    30, '오답 직후: 당일 재확인'),
  (1,  1440, '1일 후'),
  (2,  4320, '3일 후'),
  (3, 10080, '7일 후'),
  (4, 20160, '14일 후'),
  (5, 43200, '30일 후 (최고 단계, 이후에도 30일 간격 유지)')
ON CONFLICT (box) DO NOTHING;

CREATE TABLE IF NOT EXISTS game_review_schedules (
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  question_id      UUID NOT NULL REFERENCES game_questions(id),
  box              SMALLINT NOT NULL DEFAULT 0 CHECK (box BETWEEN 0 AND 5),
  attempt_count    INTEGER  NOT NULL DEFAULT 0,
  wrong_count      INTEGER  NOT NULL DEFAULT 0,   -- 누적 오답 횟수 (감소하지 않음)
  review_count     INTEGER  NOT NULL DEFAULT 0,   -- 복습 상태에서 푼 횟수
  streak           INTEGER  NOT NULL DEFAULT 0,   -- 최근 연속 정답
  mastery          SMALLINT NOT NULL DEFAULT 0 CHECK (mastery BETWEEN 0 AND 100),
  last_attempt_id  UUID,
  last_attempted_at TIMESTAMPTZ,
  next_review_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_game_sched_due ON game_review_schedules(user_id, next_review_at);

-- ------------------------------------------------------------
-- 9. 단원별 숙련도 통계 (학생 x 단원)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_mastery_stats (
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  unit_id          UUID NOT NULL REFERENCES game_units(id),
  attempts         INTEGER NOT NULL DEFAULT 0,
  correct          INTEGER NOT NULL DEFAULT 0,
  first_attempts   INTEGER NOT NULL DEFAULT 0,
  first_correct    INTEGER NOT NULL DEFAULT 0,
  review_attempts  INTEGER NOT NULL DEFAULT 0,
  review_correct   INTEGER NOT NULL DEFAULT 0,
  total_elapsed_ms BIGINT  NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, unit_id)
);

-- ------------------------------------------------------------
-- 10. 게임 진행 / 아이템 / 인벤토리  (경험치·코인 != 학습 숙련도)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_progress (
  user_id      UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  xp           INTEGER NOT NULL DEFAULT 0,
  coins        INTEGER NOT NULL DEFAULT 0,
  stage        TEXT NOT NULL DEFAULT 'noryangjin_arrival',
  season       INTEGER NOT NULL DEFAULT 1,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS game_items (
  id          TEXT PRIMARY KEY,                -- 'pencil', 'desk' ...
  name        TEXT NOT NULL,
  tier        TEXT NOT NULL CHECK (tier IN ('basic','mid','high')),
  slot        TEXT,                            -- 'bag','desk','outfit','room' ...
  price_coins INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS game_inventory (
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item_id     TEXT NOT NULL REFERENCES game_items(id),
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  equipped    BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, item_id)
);

-- ------------------------------------------------------------
-- 11. 주간 평가 (게임 내 학습성과 등급 — 합격 가능성 예측이 아님)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_assessment_results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start        DATE NOT NULL,
  questions_solved  INTEGER NOT NULL DEFAULT 0,
  accuracy          NUMERIC(5,2),
  review_completion NUMERIC(5,2),
  key_mastery       NUMERIC(5,2),
  trend             NUMERIC(6,2),
  grade             CHAR(1) CHECK (grade IN ('S','A','B','C','D')),
  note              TEXT DEFAULT '게임 내 학습성과 등급이며 실제 시험 합격 가능성을 의미하지 않습니다.',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, week_start)
);

-- ============================================================
-- 불변성 보호 (append-only)
-- ============================================================
CREATE OR REPLACE FUNCTION game_block_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% 는 append-only 테이블입니다 (% 불가)', TG_TABLE_NAME, TG_OP;
END $$;

DROP TRIGGER IF EXISTS trg_attempts_immutable ON game_answer_attempts;
CREATE TRIGGER trg_attempts_immutable
  BEFORE UPDATE OR DELETE ON game_answer_attempts
  FOR EACH ROW EXECUTE FUNCTION game_block_mutation();

DROP TRIGGER IF EXISTS trg_versions_immutable ON game_question_versions;
CREATE TRIGGER trg_versions_immutable
  BEFORE UPDATE OR DELETE ON game_question_versions
  FOR EACH ROW EXECUTE FUNCTION game_block_mutation();

-- ============================================================
-- 채점 + 복습예약 + 숙련도 + 보상  (단일 트랜잭션 RPC)
--
-- 복습 규칙 (초기 설계값, game_srs_intervals 로 조정 가능)
--   첫 풀이 정답           → box 2 (3일 후)
--   첫 풀이 오답           → box 0 (당일 재확인)
--   정답                   → box + 1 (최대 5)
--   오답                   → box - 2 (최소 0)  ※ 간격 단축, wrong_count 는 누적
--   box 0 에서 정답         → box 1 (다음 날)
-- 보상: 정답이고 (처음 푸는 문항 또는 복습 예정 문항)일 때만 지급 → 쉬운 문제 반복 파밍 방지
-- ============================================================
CREATE OR REPLACE FUNCTION game_submit_attempt(
  p_question_id UUID,
  p_selected    TEXT,
  p_elapsed_ms  INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_q         game_questions%ROWTYPE;
  v_ver       game_question_versions%ROWTYPE;
  v_sched     game_review_schedules%ROWTYPE;
  v_has_sched BOOLEAN;
  v_correct   BOOLEAN;
  v_was_review BOOLEAN;
  v_first     BOOLEAN;
  v_box       SMALLINT;
  v_wrong     INTEGER;
  v_review    INTEGER;
  v_streak    INTEGER;
  v_attempts  INTEGER;
  v_mastery   SMALLINT;
  v_next      TIMESTAMPTZ;
  v_minutes   INTEGER;
  v_diff      SMALLINT;
  v_xp        INTEGER := 0;
  v_coins     INTEGER := 0;
  v_attempt_id UUID;
  v_now       TIMESTAMPTZ := NOW();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다'; END IF;
  IF p_selected NOT IN ('O','X') THEN RAISE EXCEPTION 'selected 는 O 또는 X'; END IF;

  SELECT * INTO v_q FROM game_questions WHERE id = p_question_id;
  IF NOT FOUND OR v_q.review_status <> 'approved' OR NOT v_q.is_active THEN
    RAISE EXCEPTION '출제 가능한 문항이 아닙니다';
  END IF;
  SELECT * INTO v_ver FROM game_question_versions WHERE id = v_q.current_version_id;

  v_correct := (p_selected = v_ver.answer);

  SELECT * INTO v_sched FROM game_review_schedules
   WHERE user_id = v_uid AND question_id = p_question_id FOR UPDATE;
  v_has_sched := FOUND;
  v_first := NOT v_has_sched;
  v_was_review := v_has_sched AND v_sched.next_review_at <= v_now;

  v_wrong    := COALESCE(v_sched.wrong_count, 0) + CASE WHEN v_correct THEN 0 ELSE 1 END;
  v_review   := COALESCE(v_sched.review_count, 0) + CASE WHEN v_was_review THEN 1 ELSE 0 END;
  v_attempts := COALESCE(v_sched.attempt_count, 0) + 1;

  IF v_correct THEN
    v_streak := COALESCE(v_sched.streak, 0) + 1;
    v_box := CASE WHEN v_first THEN 2 ELSE LEAST(v_sched.box + 1, 5) END;
  ELSE
    v_streak := 0;
    v_box := CASE WHEN v_first THEN 0 ELSE GREATEST(v_sched.box - 2, 0) END;
  END IF;

  SELECT interval_minutes INTO v_minutes FROM game_srs_intervals WHERE box = v_box;
  v_next := v_now + make_interval(mins => v_minutes);
  v_mastery := LEAST(100, v_box * 20);

  -- 보상 (정답 + 신규/복습 예정일 때만)
  IF v_correct AND (v_first OR v_was_review) THEN
    SELECT difficulty_initial INTO v_diff FROM game_question_metadata WHERE question_id = p_question_id;
    v_xp    := 10 + 5 * (COALESCE(v_diff, 1) - 1) + CASE WHEN v_was_review THEN 5 ELSE 0 END;
    v_coins := 2 + COALESCE(v_diff, 1);
  END IF;

  INSERT INTO game_answer_attempts(
    user_id, question_id, question_version_id, attempted_at, selected, is_correct, elapsed_ms,
    attempt_no, was_review, wrong_count_after, review_count_after, streak_after,
    mastery_after, next_review_after)
  VALUES (v_uid, p_question_id, v_ver.id, v_now, p_selected, v_correct, p_elapsed_ms,
    v_attempts, v_was_review, v_wrong, v_review, v_streak, v_mastery, v_next)
  RETURNING id INTO v_attempt_id;

  INSERT INTO game_review_schedules(
    user_id, question_id, box, attempt_count, wrong_count, review_count, streak,
    mastery, last_attempt_id, last_attempted_at, next_review_at)
  VALUES (v_uid, p_question_id, v_box, v_attempts, v_wrong, v_review, v_streak,
    v_mastery, v_attempt_id, v_now, v_next)
  ON CONFLICT (user_id, question_id) DO UPDATE SET
    box = EXCLUDED.box, attempt_count = EXCLUDED.attempt_count,
    wrong_count = EXCLUDED.wrong_count, review_count = EXCLUDED.review_count,
    streak = EXCLUDED.streak, mastery = EXCLUDED.mastery,
    last_attempt_id = EXCLUDED.last_attempt_id, last_attempted_at = EXCLUDED.last_attempted_at,
    next_review_at = EXCLUDED.next_review_at;

  IF v_q.unit_id IS NOT NULL THEN
    INSERT INTO game_mastery_stats(user_id, unit_id, attempts, correct, first_attempts, first_correct,
      review_attempts, review_correct, total_elapsed_ms, updated_at)
    VALUES (v_uid, v_q.unit_id, 1, v_correct::int, v_first::int, (v_first AND v_correct)::int,
      v_was_review::int, (v_was_review AND v_correct)::int, COALESCE(p_elapsed_ms,0), v_now)
    ON CONFLICT (user_id, unit_id) DO UPDATE SET
      attempts = game_mastery_stats.attempts + 1,
      correct = game_mastery_stats.correct + EXCLUDED.correct,
      first_attempts = game_mastery_stats.first_attempts + EXCLUDED.first_attempts,
      first_correct = game_mastery_stats.first_correct + EXCLUDED.first_correct,
      review_attempts = game_mastery_stats.review_attempts + EXCLUDED.review_attempts,
      review_correct = game_mastery_stats.review_correct + EXCLUDED.review_correct,
      total_elapsed_ms = game_mastery_stats.total_elapsed_ms + EXCLUDED.total_elapsed_ms,
      updated_at = v_now;
  END IF;

  INSERT INTO game_progress(user_id, xp, coins, updated_at) VALUES (v_uid, v_xp, v_coins, v_now)
  ON CONFLICT (user_id) DO UPDATE SET
    xp = game_progress.xp + EXCLUDED.xp, coins = game_progress.coins + EXCLUDED.coins,
    updated_at = v_now;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt_id, 'is_correct', v_correct,
    'correct_answer', v_ver.answer, 'explanation', v_ver.explanation,
    'box', v_box, 'next_review_at', v_next, 'wrong_count', v_wrong,
    'streak', v_streak, 'mastery', v_mastery,
    'was_review', v_was_review, 'first_attempt', v_first,
    'xp_gained', v_xp, 'coins_gained', v_coins);
END $$;

-- 오늘 복습할 문항 (본인 것만, 정답은 노출하지 않음)
CREATE OR REPLACE FUNCTION game_due_reviews(p_limit INTEGER DEFAULT 20)
RETURNS TABLE(question_id UUID, statement TEXT, box SMALLINT, wrong_count INTEGER, next_review_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.question_id, v.statement, s.box, s.wrong_count, s.next_review_at
    FROM game_review_schedules s
    JOIN game_questions q ON q.id = s.question_id AND q.review_status='approved' AND q.is_active
    JOIN game_question_versions v ON v.id = q.current_version_id
   WHERE s.user_id = auth.uid() AND s.next_review_at <= NOW()
   ORDER BY s.wrong_count DESC, s.next_review_at
   LIMIT p_limit;
$$;

-- 학생에게 정답을 노출하지 않고 문항 본문만 제공
CREATE OR REPLACE VIEW game_playable_questions AS
SELECT q.id, q.subject_id, q.unit_id, v.statement, m.difficulty_initial, m.importance
  FROM game_questions q
  JOIN game_question_versions v ON v.id = q.current_version_id
  LEFT JOIN game_question_metadata m ON m.question_id = q.id
 WHERE q.review_status = 'approved' AND q.is_active;

-- ============================================================
-- RLS
--   학생: 정답이 든 원본 테이블 직접 조회 불가 (view/RPC 로만 접근)
--   본인 기록만 조회, 쓰기는 RPC(SECURITY DEFINER)로만
--   관리자: current_user_role() = 'admin' 전체 관리
-- ============================================================
ALTER TABLE game_subjects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_units             ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_import_batches    ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_questions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_question_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_question_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_question_sources  ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_question_reports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_player_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_answer_attempts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_srs_intervals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_review_schedules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_mastery_stats     ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_progress          ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_inventory         ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_assessment_results ENABLE ROW LEVEL SECURITY;

-- 공개 참조 데이터 (로그인 사용자 읽기)
CREATE POLICY game_subjects_read ON game_subjects FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY game_units_read    ON game_units    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY game_items_read    ON game_items    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY game_srs_read      ON game_srs_intervals FOR SELECT USING (auth.role() = 'authenticated');

-- 관리자 전용 (정답 포함 원본)
CREATE POLICY game_batches_admin   ON game_import_batches    FOR ALL USING (current_user_role() = 'admin');
CREATE POLICY game_questions_admin ON game_questions         FOR ALL USING (current_user_role() = 'admin');
CREATE POLICY game_versions_admin  ON game_question_versions FOR ALL USING (current_user_role() = 'admin');
CREATE POLICY game_metadata_admin  ON game_question_metadata FOR ALL USING (current_user_role() = 'admin');
CREATE POLICY game_sources_admin   ON game_question_sources  FOR ALL USING (current_user_role() = 'admin');
CREATE POLICY game_subjects_admin  ON game_subjects          FOR ALL USING (current_user_role() = 'admin');
CREATE POLICY game_units_admin     ON game_units             FOR ALL USING (current_user_role() = 'admin');
CREATE POLICY game_items_admin     ON game_items             FOR ALL USING (current_user_role() = 'admin');
CREATE POLICY game_srs_admin       ON game_srs_intervals     FOR ALL USING (current_user_role() = 'admin');

-- 오류 신고: 본인 작성/조회, 관리자 전체
CREATE POLICY game_reports_own_ins ON game_question_reports FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY game_reports_read    ON game_question_reports FOR SELECT
  USING (auth.uid() = user_id OR current_user_role() = 'admin');
CREATE POLICY game_reports_admin   ON game_question_reports FOR UPDATE USING (current_user_role() = 'admin');

-- 본인 데이터
CREATE POLICY game_pp_own        ON game_player_profiles FOR ALL
  USING (auth.uid() = user_id OR current_user_role() = 'admin') WITH CHECK (auth.uid() = user_id);
CREATE POLICY game_attempts_read ON game_answer_attempts  FOR SELECT
  USING (auth.uid() = user_id OR current_user_role() = 'admin');
CREATE POLICY game_sched_read    ON game_review_schedules FOR SELECT
  USING (auth.uid() = user_id OR current_user_role() = 'admin');
CREATE POLICY game_mastery_read  ON game_mastery_stats    FOR SELECT
  USING (auth.uid() = user_id OR current_user_role() = 'admin');
CREATE POLICY game_progress_read ON game_progress         FOR SELECT
  USING (auth.uid() = user_id OR current_user_role() = 'admin');
CREATE POLICY game_inventory_own ON game_inventory        FOR SELECT
  USING (auth.uid() = user_id OR current_user_role() = 'admin');
CREATE POLICY game_assess_read   ON game_assessment_results FOR SELECT
  USING (auth.uid() = user_id OR current_user_role() = 'admin');

-- 권한: view 는 소유자 권한으로 동작하므로 승인된 문항 본문만 노출됨(정답 컬럼 없음)
REVOKE ALL ON game_playable_questions FROM PUBLIC;
GRANT SELECT ON game_playable_questions TO authenticated;
REVOKE ALL ON FUNCTION game_submit_attempt(UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION game_submit_attempt(UUID, TEXT, INTEGER) TO authenticated;
REVOKE ALL ON FUNCTION game_due_reviews(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION game_due_reviews(INTEGER) TO authenticated;
