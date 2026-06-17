-- ============================================================
-- YLT-Lab Supabase Auth 설정
-- Supabase Dashboard > SQL Editor 에서 순서대로 실행하세요.
-- ============================================================


-- ============================================================
-- STEP 1. profiles 테이블 생성
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id        UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email     TEXT NOT NULL,
  name      TEXT NOT NULL DEFAULT '사용자',
  role      TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'student')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ============================================================
-- STEP 2. Row Level Security (RLS)
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 기존 정책 제거 후 재생성
DROP POLICY IF EXISTS "profiles_select_own"    ON public.profiles;
DROP POLICY IF EXISTS "profiles_service_all"   ON public.profiles;

-- 로그인한 사용자는 본인 프로필만 조회 가능
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- 서비스 역할(Service Role Key)은 전체 접근 허용
CREATE POLICY "profiles_service_all"
  ON public.profiles FOR ALL
  USING (auth.role() = 'service_role');


-- ============================================================
-- STEP 3. 신규 가입 시 profiles 자동 생성 트리거
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', '사용자'),
    'student'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- STEP 4. 관리자 계정 생성
-- ============================================================
-- 먼저 Supabase Dashboard > Authentication > Users > "Add user" 버튼으로
-- 관리자 이메일/비밀번호 계정을 생성하세요. (이메일 인증 없이 바로 생성 가능)
--
-- 계정 생성 후 아래 SQL 실행 (이메일 주소를 실제 값으로 교체):

UPDATE public.profiles
SET role = 'admin',
    name = '관리자'
WHERE email = 'admin@example.com';  -- ← 실제 관리자 이메일로 교체

-- 만약 profiles에 레코드가 없다면 아래 INSERT 사용:
-- (auth.users에서 UUID를 직접 조회하여 삽입)
-- INSERT INTO public.profiles (id, email, name, role)
-- SELECT id, email, '관리자', 'admin'
-- FROM auth.users
-- WHERE email = 'admin@example.com'
-- ON CONFLICT (id) DO UPDATE SET role = 'admin', name = '관리자';


-- ============================================================
-- STEP 5. 결과 확인
-- ============================================================
SELECT id, email, name, role, created_at
FROM public.profiles
ORDER BY created_at DESC;
