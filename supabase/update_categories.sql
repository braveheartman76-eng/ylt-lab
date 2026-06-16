-- ============================================================
-- materials 테이블 category 값 및 CHECK 제약 업데이트
-- Supabase 대시보드 > SQL Editor 에서 실행하세요.
-- ============================================================

-- 1. 기존 데이터 카테고리 이름 변환 (데이터가 있을 경우)
UPDATE materials SET category = '형법'      WHERE category = '형법자료';
UPDATE materials SET category = '형사소송법' WHERE category = '형사소송법자료';
-- '판례', '논문저서' → 새 분류 체계에 없으므로 삭제하거나 수동 재분류 필요
-- DELETE FROM materials WHERE category IN ('판례', '논문저서');

-- 2. 기존 CHECK 제약 제거 후 새 제약 추가
ALTER TABLE materials DROP CONSTRAINT IF EXISTS materials_category_check;

ALTER TABLE materials
  ADD CONSTRAINT materials_category_check
  CHECK (category IN ('형법', '형사소송법', '교정학', '노동법'));
