"""가져오기 도구 테스트. 모든 문항은 가상 테스트 데이터이며 실제 법률 내용이 아니다."""
import io, json, sys, tempfile, unittest, zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ox_import  # noqa: E402

SECTION = """<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
%s
</hs:sec>"""


def para(text):
    return f'<hp:p><hp:run><hp:t>{text}</hp:t></hp:run></hp:p>'


LINES = [
    "제1편 [테스트] 가상 단원 A",
    "제1장 [테스트] 가상 장",
    "1. ★ [테스트] 가상 문항 1: 이 문장은 참이라고 정의한다. ( O )",
    "해설: [테스트] 가상 해설 1",
    "2. [테스트] 가상 문항 2: 이 문장은 거짓이라고 정의한다. (X)",
    "해설: [테스트] 가상 해설 2",
    "그리고 이어지는 해설 둘째 줄",
    "- 7 -",
    "3. ※ [테스트] 가상 문항 3: 정답은 별도 줄에 있다.",
    "정답: ○",
    "해설: [테스트] 가상 해설 3",
    "제2장 [테스트] 가상 장 B",
    "5. [테스트] 가상 문항 5 (번호 4 누락)",
    "해설: 정답 줄이 없는 케이스",
]


def make_hwpx(path: Path, lines):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/hwp+zip")
        z.writestr("Contents/section0.xml", SECTION % "\n".join(para(l) for l in lines))


class ImportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.f = self.tmp / "t.hwpx"
        make_hwpx(self.f, LINES)
        self.qs = ox_import.parse(ox_import.read_paragraphs(self.f), ox_import.load_profile(None))

    def test_count_and_numbers(self):
        self.assertEqual([q.source_no for q in self.qs], ["1", "2", "3", "5"])

    def test_answers_and_inline_stripped(self):
        a = [q.answer for q in self.qs]
        self.assertEqual(a, ["O", "X", "O", None])
        self.assertNotIn("( O )", self.qs[0].statement)

    def test_explanation_multiline(self):
        self.assertIn("둘째 줄", self.qs[1].explanation)

    def test_markers_preserved_not_interpreted(self):
        m = self.qs[0].raw_markers
        self.assertEqual([x["symbol"] for x in m], ["★"])
        self.assertIsNone(m[0]["meaning"])  # 사용자 확인 전에는 의미를 붙이지 않는다

    def test_units_and_page(self):
        self.assertEqual(len(self.qs[0].unit_path), 2)
        self.assertEqual(self.qs[3].unit_path[1], "제2장 [테스트] 가상 장 B")
        self.assertEqual(self.qs[2].page_hint, 7)

    def test_validation_flags(self):
        r = ox_import.validate(self.qs)
        self.assertEqual(r["number_gaps"], [4])
        self.assertEqual(r["with_answer"], 3)
        self.assertIn("정답을 찾지 못함", self.qs[3].warnings)
        self.assertEqual(r["unconfirmed_marker_symbols"], ["※", "★"])

    def test_cli_outputs_and_skips_unanswered(self):
        out = self.tmp / "out"
        ox_import.main([str(self.f), "--book", "TEST-FIXTURE", "--out", str(out), "--test-data"])
        sql = (out / "seed.sql").read_text(encoding="utf-8")
        self.assertEqual(sql.count("INSERT INTO game_questions"), 3)  # 정답 미확인 1건 제외
        self.assertIn("건너뜀(정답 미확인)", sql)
        self.assertIn("'pending'", sql)
        self.assertNotIn("'approved'", sql)
        rows = [json.loads(l) for l in (out / "questions.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertTrue(all(r["is_test_data"] for r in rows))

    def test_ids_are_deterministic(self):
        o1, o2 = self.tmp / "o1", self.tmp / "o2"
        for o in (o1, o2):
            ox_import.main([str(self.f), "--book", "B", "--out", str(o)])
        self.assertEqual((o1 / "seed.sql").read_text(encoding="utf-8"), (o2 / "seed.sql").read_text(encoding="utf-8"))

    def test_pdf_not_silently_faked(self):
        with self.assertRaises(NotImplementedError):
            ox_import.read_paragraphs(Path("x.pdf"))


if __name__ == "__main__":
    unittest.main()
