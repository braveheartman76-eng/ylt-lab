import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import mcq_pdf_import as m
import fixtures as f


def build():
    return m.assemble(m.split_blocks(f.PROBLEM_LINES), m.split_blocks(f.SOL_LEFT_LINES),
                      m.split_blocks(f.SOL_RIGHT_LINES), f.ANSWER_TABLE, {1: 1, 2: 1, 3: 1}, None)


class McqTest(unittest.TestCase):
    def test_blocks_and_choices(self):
        qs = build()
        self.assertEqual([q.no for q in qs], [1, 2, 3])
        self.assertEqual([c["no"] for c in qs[0].choices], list("①②③④"))
        self.assertEqual(qs[0].answer, "3")

    def test_two_choices_on_one_row_and_bogi_label_styles(self):
        q = build()[1]
        self.assertEqual([c["text"] for c in q.choices], ["ㄱ, ㄴ", "ㄱ, ㄷ", "ㄴ, ㄷ", "ㄱ, ㄴ, ㄷ"])
        # 문제편은 'ㄱ.' 해설편은 '㉠' 표기 → 같은 항목으로 연결
        self.assertEqual([(b["label"], b["verdict"]) for b in q.bogi], [("ㄱ", "O"), ("ㄴ", "X"), ("ㄷ", "O")])

    def test_parenthesized_verdict(self):
        e = m.parse_explanation(["㉡ (×) 가상", "정답 ②"])
        self.assertEqual(e.items[0][:2], ("㉡", "X"))
        self.assertEqual(e.answer, "2")

    def test_verdict_consistency_gate(self):
        q1, q2, q3 = build()
        self.assertTrue(q1.verdict_ok)
        self.assertTrue(q2.verdict_ok)
        self.assertFalse(q3.verdict_ok)  # 정답(①)이 '옳은 것'인데 원본 표시는 ○ 가 아님 → 원본 모순
        self.assertTrue(any("원본 모순" in w for w in q3.warnings))
        # 정답은 원본 값을 그대로 둔다(고치지 않음)
        self.assertEqual(q3.answer, "1")

    def test_derived_ox_only_from_verified_questions(self):
        qs = build()
        d = [x for q in qs for x in m.derive_ox(q, "B")]
        self.assertEqual({x["derived_from_no"] for x in d}, {"01", "02"})
        self.assertEqual({x["source_no"]: x["answer"] for x in d if x["derived_from_no"] == "01"},
                         {"01-①": "O", "01-②": "O", "01-③": "X", "01-④": "O"})
        # 보기형 문항에서는 보기(ㄱ ㄴ ㄷ)만 변환, '② ㄱ, ㄷ' 같은 조합 선지는 제외
        self.assertEqual({x["derived_from_label"] for x in d if x["derived_from_no"] == "02"}, {"ㄱ", "ㄴ", "ㄷ"})

    def test_join_two_reconciles_spaces(self):
        t, amb, same = m.join_two(["가나다", "라마"], ["가나다 라", "마"])
        self.assertEqual((t, same), ("가나다 라마", True))
        t, amb, same = m.join_two(["가나", "다라"], ["가나", "다라"])  # 양쪽 모두 같은 자리에서 줄바꿈 → 모호
        self.assertEqual((t, amb), ("가나다라", 1))
        t, amb, same = m.join_two(["가나다"], ["가나라"])
        self.assertFalse(same)

    def test_sql_is_pending_and_versioned(self):
        import subprocess
        out = subprocess.run([sys.executable, "-I", str(Path(__file__).with_name("make_fixture_seed.py"))],
                             capture_output=True, text=True, check=True).stdout
        self.assertNotIn("'approved'", out)
        self.assertIn("'mcq'", out)
        self.assertIn("derived_from_question_id", out)
        v2 = subprocess.run([sys.executable, "-I", str(Path(__file__).with_name("make_fixture_seed.py")), "2"],
                            capture_output=True, text=True, check=True).stdout
        self.assertIn("UPDATE game_questions SET current_version_id", v2)
        self.assertNotIn("INSERT INTO game_questions(", v2)


if __name__ == "__main__":
    unittest.main()
