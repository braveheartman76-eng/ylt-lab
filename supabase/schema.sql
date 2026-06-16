-- ============================================================
-- 이윤탁 형사법 연구실 — Supabase Schema
-- Supabase 대시보드 > SQL Editor 에 전체 붙여넣고 실행
-- ============================================================

-- UUID 확장 (기본 활성화돼 있으나 명시)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ============================================================
-- 1. profiles — 수강생 프로필
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  role        TEXT        NOT NULL DEFAULT 'student'
                          CHECK (role IN ('admin', 'student')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 신규 유저 가입 시 profiles 자동 생성 트리거
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    'student'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ============================================================
-- 2. materials — 자료실
-- ============================================================
CREATE TABLE IF NOT EXISTS materials (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL,
  file_url    TEXT        NOT NULL,
  category    TEXT        NOT NULL
                          CHECK (category IN ('형법', '형사소송법', '교정학', '노동법')),
  file_size   INTEGER,    -- bytes
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_materials_category ON materials(category);
CREATE INDEX IF NOT EXISTS idx_materials_created_at ON materials(created_at DESC);


-- ============================================================
-- 3. notices — 히어로 배너 공지
-- ============================================================
CREATE TABLE IF NOT EXISTS notices (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL,
  content     TEXT,
  link_url    TEXT,
  "order"     INTEGER     NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notices_active_order ON notices(is_active, "order");


-- ============================================================
-- 4. quiz_questions — CBT 문제
-- ============================================================
CREATE TABLE IF NOT EXISTS quiz_questions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type          TEXT        NOT NULL CHECK (type IN ('MCQ', 'OX')),
  subject       TEXT        NOT NULL,   -- 예: '형법', '형사소송법'
  chapter       TEXT,                   -- 예: '제1장 서론'
  content       TEXT        NOT NULL,   -- 문제 본문
  option_1      TEXT,                   -- MCQ 보기 (OX는 NULL)
  option_2      TEXT,
  option_3      TEXT,
  option_4      TEXT,
  answer        TEXT        NOT NULL,   -- MCQ: '1'~'4' / OX: 'O'|'X'
  explanation   TEXT,                   -- 해설
  source        TEXT,                   -- 출처 (예: 2024년 경찰공무원)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quiz_questions_type    ON quiz_questions(type);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_subject ON quiz_questions(subject);


-- ============================================================
-- 5. quiz_attempts — 풀이기록
-- ============================================================
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  question_id  UUID        NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  selected     TEXT        NOT NULL,   -- 선택한 답
  is_correct   BOOLEAN     NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attempts_user_id     ON quiz_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_question_id ON quiz_attempts(question_id);
CREATE INDEX IF NOT EXISTS idx_attempts_created_at  ON quiz_attempts(created_at DESC);


-- ============================================================
-- 6. daily_quiz — 일일 출제 스케줄
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_quiz (
  id           UUID  PRIMARY KEY DEFAULT gen_random_uuid(),
  date         DATE  NOT NULL,
  question_id  UUID  NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  "order"      INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (date, question_id),
  UNIQUE (date, "order")
);

CREATE INDEX IF NOT EXISTS idx_daily_quiz_date ON daily_quiz(date);


-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

ALTER TABLE profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_questions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_attempts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_quiz      ENABLE ROW LEVEL SECURITY;

-- helper: 현재 유저 role 조회
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

-- profiles
CREATE POLICY "본인 프로필 조회" ON profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "관리자 전체 조회" ON profiles
  FOR SELECT USING (current_user_role() = 'admin');
CREATE POLICY "본인 프로필 수정" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- materials (읽기: 로그인 유저 전체 / 쓰기: admin만)
CREATE POLICY "자료 읽기" ON materials
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "자료 쓰기 (admin)" ON materials
  FOR ALL USING (current_user_role() = 'admin');

-- notices (읽기: 전체 / 쓰기: admin만)
CREATE POLICY "공지 읽기" ON notices
  FOR SELECT USING (is_active = TRUE OR current_user_role() = 'admin');
CREATE POLICY "공지 쓰기 (admin)" ON notices
  FOR ALL USING (current_user_role() = 'admin');

-- quiz_questions (읽기: 로그인 유저 / 쓰기: admin)
CREATE POLICY "문제 읽기" ON quiz_questions
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "문제 쓰기 (admin)" ON quiz_questions
  FOR ALL USING (current_user_role() = 'admin');

-- quiz_attempts (본인 기록만)
CREATE POLICY "풀이기록 읽기" ON quiz_attempts
  FOR SELECT USING (auth.uid() = user_id OR current_user_role() = 'admin');
CREATE POLICY "풀이기록 쓰기" ON quiz_attempts
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- daily_quiz (읽기: 로그인 유저 / 쓰기: admin)
CREATE POLICY "일일퀴즈 읽기" ON daily_quiz
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "일일퀴즈 쓰기 (admin)" ON daily_quiz
  FOR ALL USING (current_user_role() = 'admin');


-- ============================================================
-- 샘플 데이터 (선택 사항 — 확인용)
-- ============================================================

INSERT INTO notices (title, content, link_url, "order", is_active) VALUES
  ('2026년 하반기 형사법 세미나 일정 안내', '7월~12월 세미나 일정이 확정되었습니다. 참가 신청은 6월 30일까지.', NULL, 1, TRUE),
  ('형사소송법 개정안 분석 자료 업로드', '2026년 형사소송법 주요 개정 사항을 정리한 분석 자료를 자료실에 등록했습니다.', '/resources', 2, TRUE),
  ('오탈자 검수 시스템 정식 오픈', '원고 오탈자 검수 요청을 온라인으로 접수할 수 있습니다.', '/proofreading', 3, TRUE);
