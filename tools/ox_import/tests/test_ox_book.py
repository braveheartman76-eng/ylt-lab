"""OX 문제집(■ 대제목 / ▸ 소제목) 가져오기 테스트. 문항은 모두 가상 테스트 데이터."""
import json, sys, tempfile, unittest, zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ox_book_import as ob  # noqa: E402

TXT = "\n".join([
    "■ [테스트] 가상 대제목 A",
    "▸ [테스트] 가상 소제목 1",
    "Ⓒ 1  [테스트] 가상 문장 하나는 참이라고 정의한다.\t24년 가상시험",
    "정답 ○   [테스트] 가상 해설 하나",
    "1-1  [테스트] 가상 문장 둘은 거짓이라고 정의한다.\t19년 일경2차 / 23·25년 경승",
    "정답 ×   [테스트] 가상 해설 둘 첫 줄",
    "이어지는 해설 둘째 줄",
    "▸ [테스트] 가상 소제목 2",
    "Ⓐ 2  [테스트] 가상 문장 셋은 참이라고 정의한다.\t17·18·19년 해승",
    "정답 ○   [테스트] 가상 해설 셋 ※ 2026. 8. 4. 개정 반영: 하위법령 개정 여부 확인 요망.",
    "■ [테스트] 가상 대제목 B",
    "Ⓑ 1  [테스트] 다른 대제목에서 번호가 다시 1부터 시작한다.\t20년 가상",
    "정답 ×   [테스트] 가상 해설 넷",
])


class OxBookTest(unittest.TestCase):
    def parse(self, text=TXT):
        return ob.parse([(i, l) for i, l in enumerate(text.splitlines())])

    def test_headings_and_numbering(self):
        qs = self.parse()
        self.assertEqual([(q.no, q.section[-1], q.topic and q.topic[-1]) for q in qs],
                         [("1", "A", "1"), ("1-1", "A", "1"), ("2", "A", "2"), ("1", "B", None)])

    def test_answers_explanation_and_continuation(self):
        qs = self.parse()
        self.assertEqual([q.answer for q in qs], ["O", "X", "O", "X"])
        self.assertIn("둘째 줄", qs[1].explanation)

    def test_source_exams_split_not_computed_as_frequency(self):
        qs = self.parse()
        self.assertEqual(qs[0].source_exams, ["24년 가상시험"])
        self.assertEqual(qs[1].source_exams, ["19년 일경2차", "23·25년 경승"])
        self.assertNotIn("가상시험", qs[0].statement)  # 출처가 지문에 섞여 들어가지 않음

    def test_source_split_without_tab(self):
        """HWPX→텍스트 변환에서 탭이 공백으로 바뀐 경우에도 문장 끝 출제 정보를 분리."""
        qs = self.parse(TXT.replace("\t", " "))
        self.assertEqual(qs[1].source_exams, ["19년 일경2차", "23·25년 경승"])
        self.assertTrue(qs[1].statement.endswith("정의한다."))

    def test_markers_preserved_meaning_only_as_confirmed(self):
        qs = self.parse()
        self.assertEqual([q.marker for q in qs], ["Ⓒ", None, "Ⓐ", "Ⓑ"])
        rep = ob.validate(qs)
        self.assertEqual(rep["unconfirmed_marker_symbols"], [])  # Ⓐ/Ⓑ/Ⓒ 는 사용자가 '반복빈도'라고 확인
        sql = ob.build_sql(qs, "B", "criminal_procedure", "e" * 64, "t", True)
        self.assertIn("반복빈도 등급(저자 표시)", sql)
        self.assertNotIn("높음", sql)  # 등급의 방향은 확인받지 않았으므로 추정해 쓰지 않는다
        self.assertIn("'unverified'", sql)  # 반복빈도 표시를 출제빈도 숫자로 바꾸지 않는다

    def test_revision_note_flagged_and_law_date_from_note_only(self):
        qs = self.parse()
        self.assertEqual(qs[2].law_basis_date, "2026-08-04")
        self.assertTrue(any("개정 반영" in w for w in qs[2].warnings))
        self.assertIsNone(qs[0].law_basis_date)
        self.assertEqual(qs[0].warnings, [])

    def test_sql_pending_units_sources_and_scoped_numbers(self):
        qs = self.parse()
        sql = ob.build_sql(qs, "TEST-OX", "criminal_procedure", "e" * 64, "t.txt", True)
        self.assertNotIn("'approved'", sql)
        self.assertEqual(sql.count("INSERT INTO game_questions("), 4)  # 번호 '1' 이 두 대제목에 있어도 충돌 없음
        self.assertEqual(sql.count("INSERT INTO game_question_sources("), 1 + 2 + 1 + 1)
        self.assertIn("'past_exam'", sql)
        self.assertIn("FALSE) ON CONFLICT", sql)  # 출처는 미검증
        self.assertIn("exam_frequency_status", sql)
        self.assertIn("'unverified'", sql)
        self.assertEqual(sql.count("INSERT INTO game_units("), 4)  # 대제목 A, A/소제목1, A/소제목2, 대제목 B

    def test_hwpx_tab_is_preserved_through_reader(self):
        from hwpx_reader import read_paragraphs
        sec = ('<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">'
               '<hp:p><hp:run><hp:t>Ⓒ 1  문장<hp:tab width="1" leader="0" type="1"/>24년 가상</hp:t></hp:run></hp:p></hs:sec>')
        f = Path(tempfile.mkdtemp()) / "x.hwpx"
        with zipfile.ZipFile(f, "w") as z:
            z.writestr("Contents/section0.xml", sec)
        text = read_paragraphs(f)[0].text
        stmt, srcs = ob.split_source(ob.Q_RE.match(text).group("body"))
        self.assertEqual((stmt, srcs), ("문장", ["24년 가상"]))


if __name__ == "__main__":
    unittest.main()
