-- ============================================================
-- 노량진 형사법 헌터 — 새(개발용) Supabase 프로젝트 준비 (000)
-- 기존 사이트의 테이블이 없는 '새 프로젝트'에서 001_game_schema.sql 보다 먼저 한 번 실행한다.
-- (기존 운영 프로젝트에는 실행하지 말 것. 운영 DB 변경은 사전 승인 필요)
--
-- 기존 사이트 schema.sql 과 다른 점(보안): 사용자가 자기 프로필의 role 을 바꿀 수 없다.
--   - 일반 사용자는 profiles.name 만 수정 가능 (컬럼 권한으로 제한)
--   - role 변경은 SQL Editor(관리자)에서만
-- ============================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  name       TEXT NOT NULL DEFAULT '학생',
  role       TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'student')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 현재 로그인 사용자의 role (RLS 재귀를 피하려고 SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

DROP POLICY IF EXISTS profiles_select_own   ON public.profiles;
DROP POLICY IF EXISTS profiles_select_admin ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own   ON public.profiles;
CREATE POLICY profiles_select_own   ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY profiles_select_admin ON public.profiles FOR SELECT USING (public.current_user_role() = 'admin');
CREATE POLICY profiles_update_own   ON public.profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 컬럼 권한: 로그인 사용자는 name 만 수정할 수 있다(role 승격 방지). INSERT/DELETE 는 불가.
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (name) ON public.profiles TO authenticated;

-- 신규 가입 시 profiles 자동 생성 (항상 student)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (NEW.id, NEW.email, COALESCE(NULLIF(NEW.raw_user_meta_data->>'name', ''), '학생'), 'student')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 관리자 지정(선생님 계정): 가입 후 아래를 이메일만 바꿔 SQL Editor 에서 실행
--   UPDATE public.profiles SET role = 'admin', name = '선생님' WHERE email = '여기에-선생님-이메일';
