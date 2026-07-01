-- ============================================================
-- 이윤탁 형사법 연구실 — CBT 모의고사 스키마
-- 기존 schema.sql 이 먼저 실행된 뒤 이 파일을 실행하세요.
-- ============================================================

-- ============================================================
-- 1. exams — 시험 정의
-- ============================================================
CREATE TABLE IF NOT EXISTS exams (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT        NOT NULL,
  subject           TEXT        NOT NULL,
  time_limit_minutes INTEGER    NOT NULL DEFAULT 60 CHECK (time_limit_minutes > 0),
  start_at          TIMESTAMPTZ NOT NULL,
  end_at            TIMESTAMPTZ NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'published', 'closed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT exams_period_check CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS idx_exams_status    ON exams(status);
CREATE INDEX IF NOT EXISTS idx_exams_start_at  ON exams(start_at);
CREATE INDEX IF NOT EXISTS idx_exams_end_at    ON exams(end_at);


-- ============================================================
-- 2. exam_questions — 시험별 문항 구성
--    기존 quiz_questions 재사용, 순서/배점만 별도 관리
-- ============================================================
CREATE TABLE IF NOT EXISTS exam_questions (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id     UUID    NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  question_id UUID    NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  "order"     INTEGER NOT NULL DEFAULT 0,
  points      INTEGER NOT NULL DEFAULT 1 CHECK (points > 0),
  UNIQUE (exam_id, question_id),
  UNIQUE (exam_id, "order")
);

CREATE INDEX IF NOT EXISTS idx_exam_questions_exam_id ON exam_questions(exam_id);


-- ============================================================
-- 3. exam_sessions — 학생별 응시 세션
--    UNIQUE(exam_id, user_id)      → 1계정 1회
--    UNIQUE(exam_id, phone_number) → 1번호 1회
-- ============================================================
CREATE TABLE IF NOT EXISTS exam_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id      UUID        NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  phone_number TEXT        NOT NULL,            -- 숫자만 정규화해서 저장 (예: 01012345678)
  status       TEXT        NOT NULL DEFAULT 'in_progress'
                           CHECK (status IN ('in_progress', 'submitted', 'expired')),
  score        INTEGER,                          -- 채점 후 기록
  total_points INTEGER,                          -- 만점
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  UNIQUE (exam_id, user_id),
  UNIQUE (exam_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_exam_sessions_exam_id  ON exam_sessions(exam_id);
CREATE INDEX IF NOT EXISTS idx_exam_sessions_user_id  ON exam_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_exam_sessions_status   ON exam_sessions(status);


-- ============================================================
-- 4. exam_answers — 세션별 문항 답안
-- ============================================================
CREATE TABLE IF NOT EXISTS exam_answers (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID    NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  exam_question_id    UUID    NOT NULL REFERENCES exam_questions(id) ON DELETE CASCADE,
  selected            TEXT,                      -- 선택한 답 (미답변이면 NULL)
  is_correct          BOOLEAN,                   -- 채점 후 기록
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, exam_question_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_answers_session_id ON exam_answers(session_id);


-- ============================================================
-- 5. exam_statistics 뷰 — 시험 전체 통계 (end_at 지난 시험만)
-- ============================================================
CREATE OR REPLACE VIEW exam_statistics AS
SELECT
  e.id                            AS exam_id,
  e.title,
  e.subject,
  e.end_at,
  COUNT(s.id)                     AS total_sessions,
  ROUND(AVG(s.score), 2)          AS avg_score,
  ROUND(STDDEV(s.score), 2)       AS stddev_score,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.score) AS median_score,
  MAX(s.score)                    AS max_score,
  MIN(s.score)                    AS min_score,
  MAX(s.total_points)             AS total_points
FROM exams e
JOIN exam_sessions s ON s.exam_id = e.id
WHERE
  e.end_at < NOW()
  AND s.status IN ('submitted', 'expired')
  AND s.score IS NOT NULL
GROUP BY e.id, e.title, e.subject, e.end_at;


-- ============================================================
-- 6. exam_question_statistics 뷰 — 문항별 정답률 (end_at 지난 시험만)
-- ============================================================
CREATE OR REPLACE VIEW exam_question_statistics AS
SELECT
  eq.exam_id,
  eq.id                           AS exam_question_id,
  eq."order",
  eq.points,
  qq.content,
  qq.subject,
  COUNT(ea.id)                    AS total_answers,
  COUNT(ea.id) FILTER (WHERE ea.is_correct = TRUE)  AS correct_count,
  CASE
    WHEN COUNT(ea.id) = 0 THEN NULL
    ELSE ROUND(
      COUNT(ea.id) FILTER (WHERE ea.is_correct = TRUE)::NUMERIC
      / COUNT(ea.id) * 100, 1
    )
  END                             AS correct_rate
FROM exam_questions eq
JOIN quiz_questions qq ON qq.id = eq.question_id
JOIN exams e ON e.id = eq.exam_id
LEFT JOIN exam_answers ea ON ea.exam_question_id = eq.id
LEFT JOIN exam_sessions es ON es.id = ea.session_id AND es.status IN ('submitted', 'expired')
WHERE e.end_at < NOW()
GROUP BY eq.exam_id, eq.id, eq."order", eq.points, qq.content, qq.subject;


-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

ALTER TABLE exams           ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_questions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_answers    ENABLE ROW LEVEL SECURITY;

-- exams: 학생은 published 만 / 관리자는 전체
CREATE POLICY "시험 읽기 (학생)" ON exams
  FOR SELECT USING (
    status = 'published'
    OR current_user_role() = 'admin'
  );
CREATE POLICY "시험 관리 (admin)" ON exams
  FOR ALL USING (current_user_role() = 'admin');

-- exam_questions: 로그인 유저 읽기 / admin 관리
CREATE POLICY "시험문항 읽기" ON exam_questions
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "시험문항 관리 (admin)" ON exam_questions
  FOR ALL USING (current_user_role() = 'admin');

-- exam_sessions: 본인 세션만 / admin 전체
CREATE POLICY "내 세션 읽기" ON exam_sessions
  FOR SELECT USING (auth.uid() = user_id OR current_user_role() = 'admin');
CREATE POLICY "내 세션 생성" ON exam_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "내 세션 수정" ON exam_sessions
  FOR UPDATE USING (auth.uid() = user_id OR current_user_role() = 'admin');

-- exam_answers: 본인 세션의 답안만 / admin 전체
CREATE POLICY "내 답안 읽기" ON exam_answers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM exam_sessions s
      WHERE s.id = exam_answers.session_id
        AND (s.user_id = auth.uid() OR current_user_role() = 'admin')
    )
  );
CREATE POLICY "내 답안 쓰기" ON exam_answers
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM exam_sessions s
      WHERE s.id = exam_answers.session_id AND s.user_id = auth.uid()
    )
  );
CREATE POLICY "내 답안 수정" ON exam_answers
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM exam_sessions s
      WHERE s.id = exam_answers.session_id AND s.user_id = auth.uid()
    )
  );
