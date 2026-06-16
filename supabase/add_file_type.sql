-- ============================================================
-- Supabase Dashboard > SQL Editor 에서 실행
-- ============================================================

-- 1. materials 테이블에 file_type 컬럼 추가
--    기존 데이터는 DEFAULT 'open' 으로 자동 설정됨
ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS file_type TEXT NOT NULL DEFAULT 'open';

-- 2. CHECK 제약 조건 추가 (이미 존재하면 무시)
DO $$
BEGIN
  ALTER TABLE materials
    ADD CONSTRAINT materials_file_type_check
    CHECK (file_type IN ('open', 'study'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3. 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_materials_file_type ON materials(file_type);

-- 4. Storage 버킷 생성 (이미 존재하면 무시)
INSERT INTO storage.buckets (id, name, public)
VALUES
  ('open-files',  'open-files',  true),
  ('study-files', 'study-files', true)
ON CONFLICT (id) DO NOTHING;

-- 5. open-files 공개 읽기 정책 (이미 존재하면 무시)
DO $$
BEGIN
  CREATE POLICY "open-files 공개 읽기" ON storage.objects
    FOR SELECT USING (bucket_id = 'open-files');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 6. study-files 로그인 유저 읽기 정책 (이미 존재하면 무시)
DO $$
BEGIN
  CREATE POLICY "study-files 인증 읽기" ON storage.objects
    FOR SELECT USING (
      bucket_id = 'study-files' AND auth.role() = 'authenticated'
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
