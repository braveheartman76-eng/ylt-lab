"""가상 픽스처로 SQL 시드를 만들어 stdout 에 출력 (DB 테스트에서 호출)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import mcq_pdf_import as m
import fixtures as f

version_no = int(sys.argv[1]) if len(sys.argv) > 1 else 1
qs = m.assemble(m.split_blocks(f.PROBLEM_LINES), m.split_blocks(f.SOL_LEFT_LINES), m.split_blocks(f.SOL_RIGHT_LINES),
                f.ANSWER_TABLE, {1: 1, 2: 1, 3: 1}, "[테스트] 가상 공통 단서")
derived = [d for q in qs for d in m.derive_ox(q, "TEST-MCQ")]
sys.stdout.write(m.build_sql(qs, derived, "TEST-MCQ", "criminal_procedure", "f" * 64, "fixture", "TEST-MCQ: 가상 단원", True, version_no))
