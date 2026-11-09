"""가상 OX 문제집 픽스처로 SQL 시드를 만들어 stdout 에 출력 (DB 테스트에서 호출)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import ox_book_import as ob
from test_ox_book import TXT

qs = ob.parse([(i, l) for i, l in enumerate(TXT.splitlines())])
sys.stdout.write(ob.build_sql(qs, "TEST-OX", "criminal_procedure", "e" * 64, "fixture.txt", True))
