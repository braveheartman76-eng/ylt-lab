-- ============================================================
-- materials 테이블 RLS 정책
-- Supabase 대시보드 > SQL Editor 에서 실행하세요.
-- ============================================================

-- 1. RLS 활성화
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;

-- 2. 기존 정책 초기화 (중복 방지)
DROP POLICY IF EXISTS "materials_public_read"    ON materials;
DROP POLICY IF EXISTS "materials_no_direct_write" ON materials;

-- 3. SELECT: anon / authenticated 모두 허용 (전체 공개 읽기)
CREATE POLICY "materials_public_read"
ON materials
FOR SELECT
USING (true);

-- 4. INSERT / UPDATE / DELETE: service_role 전용
--    service_role 키는 RLS 를 bypass 하므로 API Route 에서 항상 가능.
--    아래 정책으로 anon / authenticated 의 직접 쓰기를 차단합니다.
CREATE POLICY "materials_no_direct_write"
ON materials
FOR ALL
USING (false)
WITH CHECK (false);
