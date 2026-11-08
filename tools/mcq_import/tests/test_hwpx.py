"""HWPX 4지선다 가져오기 테스트. 문항은 모두 가상 테스트 데이터(fixtures.py)."""
import subprocess, sys, tempfile, unittest, zipfile, json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import mcq_hwpx_import as h
import mcq_pdf_import as m
import fixtures as f

SECTION = """<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">%s</hs:sec>"""


def para(t):
    # 탭 뒤에 이어지는 글자(tail)까지 포함해 실제 HWPX 와 같은 형태로 만든다
    t = t.replace(" ② ", '<hp:tab width="1" leader="0" type="1"/>② ') if t.startswith("① ㄱ") or t.startswith("③ ㄴ") else t
    return f'<hp:p><hp:run><hp:t>{t}</hp:t></hp:run></hp:p>'


def write(path, paras):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/hwp+zip")
        z.writestr("Contents/section0.xml", SECTION % "".join(para(p) for p in paras))


def problem_paras():
    return ["[테스트] 모의고사", "09", "[테스트] 배너", "지문의 내용에 대해 학설의 대립 등 다툼이 있는 경우 판례에 의함"] + f.PROBLEM_LINES


def solution_paras(table_style):
    left, right = m.split_blocks(f.SOL_LEFT_LINES), m.split_blocks(f.SOL_RIGHT_LINES)
    head = ["[테스트] 정답 및 해설", "09", "[테스트] 배너", "제9회  [테스트] 가상 범위", "■ 정답 모아보기"]
    if table_style == "pairs":
        head += ["1", "③", "2", "②", "3", "①"]
    else:  # 번호 행 → 정답 행
        head += ["1", "2", "3", "③", "②", "①"]
    body = []
    for n in sorted(left):
        body += [f"{n:02d}"] + left[n] + [f"{n:02d}"] + right[n]
    return head + body


class HwpxTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def run_exam(self, style="pairs"):
        p, s = self.tmp / "p.hwpx", self.tmp / "s.hwpx"
        write(p, problem_paras())
        write(s, solution_paras(style))
        return h.import_exam(p, s)

    def test_both_answer_table_layouts(self):
        for style in ("pairs", "rows"):
            e = self.run_exam(style)
            self.assertEqual(e["report"]["answers_in_table"], 3, style)
            self.assertEqual(e["report"]["answer_table_agrees"], 3, style)

    def test_exam_label_and_banner_not_a_question(self):
        e = self.run_exam()
        self.assertEqual((e["exam_no"], e["chapter"]), (9, "[테스트] 가상 범위"))
        self.assertEqual([q.no for q in e["qs"]], [1, 2, 3])  # 배너의 '09'/'01' 이 문항으로 잡히지 않음
        self.assertEqual(e["qs"][0].stem_note, "지문의 내용에 대해 학설의 대립 등 다툼이 있는 경우 판례에 의함")

    def test_tab_separated_choices_both_kept(self):
        q = self.run_exam().get("qs")[1]
        self.assertEqual([c["text"] for c in q.choices], ["ㄱ, ㄴ", "ㄱ, ㄷ", "ㄴ, ㄷ", "ㄱ, ㄴ, ㄷ"])

    def test_same_checks_as_pdf_version(self):
        e = self.run_exam()
        q1, q2, q3 = e["qs"]
        self.assertTrue(q1.verdict_ok and q2.verdict_ok)
        self.assertFalse(q3.verdict_ok)  # 원본 모순은 변환 제외, 정답은 원본 값 유지
        self.assertEqual(q3.answer, "1")
        self.assertEqual({d["derived_from_no"] for d in e["derived"]}, {"01", "02"})
        self.assertEqual(e["qs"][0].ambiguous_breaks, 0)  # HWPX 는 줄바꿈 모호성 없음

    def test_argument_order_does_not_matter(self):
        p, s = self.tmp / "p.hwpx", self.tmp / "s.hwpx"
        write(p, problem_paras()); write(s, solution_paras("pairs"))
        e = h.import_exam(s, p)  # 일부러 뒤집어서 전달
        self.assertEqual(len(e["qs"]), 3)

    def test_cli_writes_pending_sql_for_multiple_exams(self):
        p, s = self.tmp / "p.hwpx", self.tmp / "s.hwpx"
        write(p, problem_paras()); write(s, solution_paras("rows"))
        out = self.tmp / "out"
        h.main(["--exam", str(p), str(s), "--out", str(out), "--test-data"])
        sql = (out / "seed.sql").read_text(encoding="utf-8")
        self.assertNotIn("'approved'", sql)
        self.assertIn("'mcq'", sql)
        rows = [json.loads(l) for l in (out / "questions.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertTrue(all(r["is_test_data"] and r["unit"].startswith("이윤탁 형사소송법 기출원문 모의고사 제9회") for r in rows))


if __name__ == "__main__":
    unittest.main()
