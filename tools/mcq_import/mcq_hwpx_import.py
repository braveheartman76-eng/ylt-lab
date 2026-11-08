#!/usr/bin/env python3
"""4지선다 기출원문 모의고사(HWPX 2종: 문제편 + 정답 및 해설편) → 게임 문제은행 가져오기.

PDF 판(mcq_pdf_import.py)과 같은 검수 기준·파생 OX·SQL 을 쓰고 읽기만 HWPX 로 바꾼 것이다.
HWPX 는 문단 단위로 깨끗하게 읽혀 PDF 의 줄바꿈 띄어쓰기 소실/2단 편집 문제가 없다.

  python3 mcq_hwpx_import.py --exam 문제1.hwpx 해설1.hwpx --exam 문제2.hwpx 해설2.hwpx --out OUT/
회차/단원 라벨은 해설편 머리말의 '제N회  범위' 문단에서 읽는다. 문제편/해설편 판별은 파일 내용으로 확인한다.
원칙: 정답·○×·해설은 원본 값만 사용(추정·생성 금지) / 원본 모순·표시 누락은 경고 + OX 변환 제외 / DB 직접 쓰기 없음.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "ox_import"))
sys.path.insert(0, str(HERE))
from hwpx_reader import read_hwpx  # noqa: E402
import mcq_pdf_import as m  # noqa: E402

CIRCLED = m.CIRCLED
HEADER_RE = re.compile(r"^제\s*(\d+)\s*회\s+(.+)$")
ASCII_NUM = re.compile(r"^[0-9]+$")
BOOK_FMT = "이윤탁 형사소송법 기출원문 모의고사 제{n}회"


def paragraphs(path: Path) -> list[str]:
    return [m.norm(p.text) for p in read_hwpx(path) if p.text.strip()]


def is_solution_file(paras: list[str]) -> bool:
    return any(p == "■ 정답 모아보기" for p in paras[:40])


def split_problem(paras: list[str]) -> tuple[dict[int, list[str]], str | None]:
    """문제편: 전역 단서 문단 뒤부터가 본문. 그 앞의 '01' 은 회차 배너이므로 문항 번호가 아니다."""
    note = next((p for p in paras if m.GLOBAL_NOTE_RE.match(p)), None)
    start = paras.index(note) + 1 if note else 0
    return m.split_blocks(paras[start:]), note


def split_solution(paras: list[str]) -> tuple[dict[int, list[str]], dict[int, list[str]], dict[int, str], tuple[int | None, str | None]]:
    """해설편: [머리말][정답 모아보기 표(번호/정답 문단 쌍)] 이후 '문항번호' 가 문항당 2번 나온다.
    1번째=문제 재수록, 2번째=선지별 ○×·근거·정답."""
    exam_no, chapter = None, None
    for p in paras[:12]:
        h = HEADER_RE.match(p)
        if h:
            exam_no, chapter = int(h.group(1)), h.group(2).strip()
            break
    i = next(k for k, p in enumerate(paras) if p == "■ 정답 모아보기") + 1
    table, i = parse_answer_table(paras, i)
    qcopy: dict[int, list[str]] = {}
    expl: dict[int, list[str]] = {}
    cur: dict[int, list[str]] | None = None
    for p in paras[i:]:
        mm = m.NUM_RE.match(p)
        if mm:
            n = int(mm.group(1))
            cur = expl if n in qcopy else qcopy
            cur[n] = []
            continue
        if cur is not None:
            cur[last_key(cur)].append(p)
    return qcopy, expl, table, (exam_no, chapter)


def parse_answer_table(paras: list[str], i: int) -> tuple[dict[int, str], int]:
    """정답 모아보기 표. 번호 문단('1'…)과 정답 문단('②'…)이 (번호,정답) 쌍으로 이어지는 형식과
    '번호 20개 → 정답 20개' 행 형식을 모두 읽는다. 문항 번호는 '01' 처럼 0 으로 시작하므로 거기서 표가 끝난다."""
    toks = []
    while i < len(paras) and (paras[i] in CIRCLED or (ASCII_NUM.match(paras[i]) and not paras[i].startswith("0"))):
        toks.append(paras[i])
        i += 1
    table: dict[int, str] = {}
    nums: list[int] = []
    ans: list[str] = []
    def flush():
        nonlocal nums, ans
        if nums and len(nums) == len(ans):
            for n, a in zip(nums, ans):
                table[n] = str(CIRCLED.index(a) + 1)
        nums, ans = [], []
    prev_is_num = None
    for t in toks:
        is_num = t not in CIRCLED  # ②③ 같은 원 숫자는 str.isdigit() 이 True 라서 쓰지 않는다
        if is_num and prev_is_num is False:
            flush()  # 정답 run 이 끝나고 새 번호 run 시작 → 한 행(또는 한 쌍) 완료
        (nums if is_num else ans).append(int(t) if is_num else t)
        prev_is_num = is_num
    flush()
    return table, i


def last_key(d: dict) -> int:
    return next(reversed(d))


def import_exam(prob_path: Path, sol_path: Path) -> dict:
    pp, sp = paragraphs(prob_path), paragraphs(sol_path)
    if is_solution_file(pp) and not is_solution_file(sp):
        pp, sp = sp, pp  # 순서를 바꿔 넣어도 내용으로 판별
    if is_solution_file(pp) or not is_solution_file(sp):
        raise SystemExit(f"문제편/해설편을 구분할 수 없습니다: {prob_path.name}, {sol_path.name}")
    prob, note = split_problem(pp)
    qcopy, expl, table, (exam_no, chapter) = split_solution(sp)
    qs = m.assemble(prob, qcopy, expl, table, {}, note)
    for q in qs:
        q.page = None  # HWPX 에는 확정된 쪽번호가 없다(추정하지 않음)
        if q.no not in qcopy:
            q.warnings.append("해설편에 문제 재수록 없음")
    book = BOOK_FMT.format(n=exam_no) if exam_no else prob_path.stem
    derived = [d for q in qs for d in m.derive_ox(q, book)]
    rep = m.report(qs, derived, len(table) or None)
    rep["exam_no"] = exam_no
    rep["chapter"] = chapter
    rep["answers_in_table"] = len(table)
    rep["problem_file"], rep["solution_file"] = prob_path.name, sol_path.name
    rep["note"] = "HWPX 입력: 문단 단위 추출(줄바꿈 띄어쓰기 소실 없음)"
    rep.pop("ambiguous_line_breaks_in_question_text", None)
    rep.pop("ambiguous_line_breaks_in_explanations", None)
    return dict(book=book, unit=f"{book}: {chapter}" if chapter else book, qs=qs, derived=derived, report=rep,
                sha=m.sha(prob_path, sol_path), src=f"{prob_path.name} + {sol_path.name}", exam_no=exam_no, chapter=chapter)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--exam", nargs=2, action="append", metavar=("문제편.hwpx", "해설편.hwpx"), required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--subject", default="criminal_procedure")
    ap.add_argument("--test-data", action="store_true")
    ap.add_argument("--version-no", type=int, default=1, help="2 이상: 기존 문항에 새 버전만 추가(PDF→HWPX 재가져오기 등)")
    a = ap.parse_args(argv)

    exams = sorted((import_exam(Path(p), Path(s)) for p, s in a.exam), key=lambda e: e["exam_no"] or 0)
    a.out.mkdir(parents=True, exist_ok=True)
    sql, reports = [], {}
    with (a.out / "questions.jsonl").open("w", encoding="utf-8") as f:
        for e in exams:
            for q in e["qs"]:
                f.write(json.dumps({**asdict(q), "type": "mcq", "book": e["book"], "unit": e["unit"], "is_test_data": a.test_data}, ensure_ascii=False) + "\n")
            for d in e["derived"]:
                f.write(json.dumps({**d, "type": "ox_derived", "book": e["book"], "unit": e["unit"], "is_test_data": a.test_data}, ensure_ascii=False) + "\n")
            sql.append(m.build_sql(e["qs"], e["derived"], e["book"], a.subject, e["sha"], e["src"], e["unit"], a.test_data, a.version_no))
            reports[f"제{e['exam_no']}회"] = e["report"]
    (a.out / "seed.sql").write_text("\n".join(sql), encoding="utf-8")
    (a.out / "report.json").write_text(json.dumps(reports, ensure_ascii=False, indent=2), encoding="utf-8")
    for k, r in reports.items():
        short = {x: r[x] for x in ("exam_no", "chapter", "total_mcq", "answers_in_table", "with_answer", "answer_table_agrees", "with_4_choices",
                                    "verdict_ok_questions", "derived_ox_candidates", "questions_with_warnings")}
        print(k, json.dumps(short, ensure_ascii=False))
        for no, ws in r["warnings"].items():
            print(f"   {no}: " + " / ".join(w[:90] for w in ws))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
