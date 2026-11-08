#!/usr/bin/env python3
"""4지선다 기출원문 모의고사(PDF 2종: 문제편 + 정답 및 해설편) → 게임 문제은행 가져오기.

입력
  --problems  문제편 PDF   (2단 편집, 문제만)
  --solutions 정답 및 해설편 PDF (왼쪽 단: 문제 재수록 / 오른쪽 단: 선지별 ○× + 근거 + 정답)

원칙 (OX 가져오기와 동일)
  * 정답·○×·해설은 원본에 적힌 값만 사용한다. 추정/생성하지 않는다.
  * 문제편과 해설편의 문제 재수록 본문을 서로 대조한다. 다르면 경고.
  * PDF 줄바꿈은 글자 단위라 줄 끝의 띄어쓰기 유무가 소실된다.
    같은 문장이 두 PDF 에 재수록되어 있어 대조를 시도하지만, 실측 결과 두 PDF 의 줄바꿈 위치가 같아
    복원되는 자리가 없다(제1회 기준 0건). 복원 불가 자리는 붙여 쓰고 ambiguous_breaks 로 보고한다. (HWPX 원본이 오면 해소)
  * 선지에서 뽑은 OX 변형 문항은 원 문항과 분리된 파생 문항(pending)이며, 검수 전에는 출제되지 않는다.
  * DB 에 직접 쓰지 않는다. JSONL + 리포트 + SQL 시드만 만든다.
외부 도구: poppler 의 pdftotext
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import unicodedata
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ox_import"))
from ox_import import NS, sql_str  # noqa: E402

CIRCLED = "①②③④"
BOGI_LABELS = "㉠㉡㉢㉣㉤㉥㉦"
JAMO = "ㄱㄴㄷㄹㅁㅂㅅ"
CANON = {**{c: j for c, j in zip(BOGI_LABELS, JAMO)}, **{j: j for j in JAMO}}  # ㉠ ↔ ㄱ 같은 표기 차이 흡수
BOGI_START = re.compile(rf"^(?:[{BOGI_LABELS}]|[{JAMO}]\s*[.)])")
VERDICT = {"○": "O", "◯": "O", "O": "O", "×": "X", "✕": "X", "X": "X"}
FOOTER_Y = 785  # pt. A4(842pt) 기준 꼬리말 시작선 위까지만 읽는다
FOOTER_RE = re.compile(r"^(\d+\s+(이윤탁 형사소송법 기출원문 모의고사|정답 및 해설)|제\d+회\s+\d+)$")
GLOBAL_NOTE_RE = re.compile(r"^지문의 내용에 대해 .*다툼.*판례에 의함$")
NEG_RE = re.compile(r"옳지\s*않은|틀린|아닌\s*것|옳지\s*아니한")
POS_RE = re.compile(r"옳은\s*것|맞는\s*것")
CASE_RE = re.compile(r"사례|사안|甲|乙|丙|丁|다음|위\s*사")


# ───────────────────────── PDF → 단(column) 텍스트 ─────────────────────────
def pdf_pages(pdf: Path) -> int:
    out = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True, check=True).stdout
    return int(re.search(r"Pages:\s+(\d+)", out).group(1))


def norm(line: str) -> str:
    # PDF 가 康熙部首 변형 글자(⼄ 등)를 쓰는 경우 통상 한자로 치환. 원 글자 의미는 동일.
    line = re.sub("[\u2f00-\u2fdf]", lambda m: unicodedata.normalize("NFKC", m.group()), line)
    return re.sub(r"\s+", " ", line).strip()


def crop_lines(pdf: Path, page: int, x: int, y: int, w: int, h: int, layout: bool = False) -> list[str]:
    cmd = ["pdftotext", "-f", str(page), "-l", str(page), "-x", str(x), "-y", str(y), "-W", str(w), "-H", str(h)]
    if layout:
        cmd.append("-layout")
    cmd += [str(pdf), "-"]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    return [norm(l) for l in out.splitlines() if l.strip()]


def column_streams(pdf: Path, first_page_top: int) -> tuple[list[tuple[int, list[str]]], list[tuple[int, list[str]]]]:
    """페이지별 (왼쪽 단, 오른쪽 단) 줄 목록. 첫 쪽은 머리말 영역을 건너뛴다."""
    left, right = [], []
    for pg in range(1, pdf_pages(pdf) + 1):
        y = first_page_top if pg == 1 else 0
        h = FOOTER_Y - y  # 쪽 아래 꼬리말(쪽번호/책 제목)은 잘라낸다
        for store, x, w in ((left, 0, 298), (right, 298, 297)):
            lines = crop_lines(pdf, pg, x, y, w, h)
            # 해설이 길면 '정답 ②' 줄만 꼬리말 아래로 밀리는 경우가 있어 그 줄만 따로 주워 온다
            lines += [l for l in crop_lines(pdf, pg, x, FOOTER_Y, w, 842 - FOOTER_Y) if ANS_RE.match(l)]
            store.append((pg, lines))
    return left, right


def clean(lines: list[str]) -> list[str]:
    return [l for l in lines if not FOOTER_RE.match(l)]


# ───────────────────────── 블록 분할/파싱 (순수 함수) ─────────────────────────
NUM_RE = re.compile(r"^(\d{2})$")


def split_blocks(lines: list[str]) -> dict[int, list[str]]:
    blocks: dict[int, list[str]] = {}
    cur = None
    for l in clean(lines):
        m = NUM_RE.match(l)
        if m and (cur is None or int(m.group(1)) == cur + 1 or int(m.group(1)) not in blocks):
            cur = int(m.group(1))
            blocks.setdefault(cur, [])
            continue
        if cur is not None:
            blocks[cur].append(l)
    return blocks


@dataclass
class QBody:
    stem: list[str] = field(default_factory=list)
    bogi: list[tuple[str, list[str]]] = field(default_factory=list)       # (label, line fragments)
    choices: list[tuple[str, list[str]]] = field(default_factory=list)    # (no, line fragments)


def parse_question_body(lines: list[str]) -> QBody:
    b = QBody()
    mode = "stem"
    for l in lines:
        if GLOBAL_NOTE_RE.match(l):
            continue
        if mode != "choice" and l[:1] in CIRCLED:
            mode = "choice"
        elif mode == "stem" and BOGI_START.match(l):
            mode = "bogi"
        if mode == "stem":
            b.stem.append(l)
        elif mode == "bogi":
            m = BOGI_START.match(l)
            if m:
                b.bogi.append((l[0], [l[m.end():].strip()]))
            else:
                b.bogi[-1][1].append(l)
        else:
            # 한 줄에 선지가 2개 이상 있는 경우(① … ② …)도 마커 기준으로 쪼갠다
            for part in re.split(f"(?=[{CIRCLED}])", l):
                part = part.strip()
                if not part:
                    continue
                if part[0] in CIRCLED:
                    b.choices.append((part[0], [part[1:].strip()]))
                elif b.choices:
                    b.choices[-1][1].append(part)
                else:
                    b.stem.append(part)
    return b


ITEM_RE = re.compile(rf"^([{CIRCLED}{BOGI_LABELS}{JAMO}])\s*\(?([○◯×✕OX])\)?\s*(.*)$")
ANS_RE = re.compile(rf"^정답\s*([{CIRCLED}])$")


@dataclass
class Explanation:
    preamble: list[str] = field(default_factory=list)
    items: list[tuple[str, str, list[str]]] = field(default_factory=list)  # (label, verdict O/X, fragments)
    answer: str | None = None
    raw: list[str] = field(default_factory=list)


def parse_explanation(lines: list[str]) -> Explanation:
    e = Explanation()
    for l in clean(lines):
        e.raw.append(l)
        am = ANS_RE.match(l)
        if am:
            e.answer = str(CIRCLED.index(am.group(1)) + 1)
            continue
        im = ITEM_RE.match(l)
        if im:
            e.items.append((im.group(1), VERDICT[im.group(2)], [im.group(3).strip()]))
        elif e.items:
            e.items[-1][2].append(l)
        else:
            e.preamble.append(l)
    return e


# ───────────────────────── 줄바꿈 띄어쓰기 복원 ─────────────────────────
def join_two(a: list[str], b: list[str] | None) -> tuple[str, int, bool]:
    """줄 조각 목록 a(주) / b(같은 문장의 다른 줄바꿈)로 본문 복원.
    return (text, ambiguous_break_count, same_when_spaceless)"""
    def info(frags: list[str]):
        s, spaces, breaks, i = "", set(), set(), 0
        for k, f in enumerate(frags):
            for ch in f:
                if ch == " ":
                    spaces.add(i)  # i 번째 글자 앞에 공백
                else:
                    s += ch
                    i += 1
            if k < len(frags) - 1:
                breaks.add(i)  # i 번째 글자 앞이 줄바꿈 자리
        return s, spaces, breaks

    sa, spa, bra = info(a)
    if b is None:
        out = _render(sa, spa, set())
        return out, len(bra), True
    sb, spb, brb = info(b)
    same = sa == sb
    if not same:
        return _render(sa, spa, set()), len(bra), False
    spaces = spa | spb
    unknown = {i for i in bra if i not in spaces and i in brb}
    # 한쪽에서는 줄 중간(연속)이고 공백이 없었다면 → 붙여쓰기 확정
    return _render(sa, spaces, set()), len(unknown), True


def _render(s: str, spaces: set[int], _unused: set[int]) -> str:
    out = []
    for i, ch in enumerate(s):
        if i in spaces:
            out.append(" ")
        out.append(ch)
    return "".join(out).strip()


# ───────────────────────── 문항 조립 ─────────────────────────
@dataclass
class Q:
    no: int
    stem: str = ""
    bogi: list[dict] = field(default_factory=list)
    choices: list[dict] = field(default_factory=list)
    answer: str | None = None
    answer_table: str | None = None
    preamble: str = ""
    page: int | None = None
    stem_note: str | None = None
    verdict_ok: bool = False           # 정답과 선지/보기별 원본 ○× 가 서로 맞아떨어질 때만 True (OX 변환 허용 조건)
    warnings: list[str] = field(default_factory=list)
    ambiguous_breaks: int = 0          # 문제 본문(발문/보기/선지)의 모호한 줄바꿈 수
    ambiguous_breaks_notes: int = 0    # 해설 본문(사본 1개뿐)의 모호한 줄바꿈 수


def parse_answer_table(pdf: Path, top: int, height: int) -> dict[int, str]:
    lines = crop_lines(pdf, 1, 0, top, 595, height, layout=True)
    table: dict[int, str] = {}
    for l in lines:
        for n, a in re.findall(rf"(\d{{1,2}})\s*([{CIRCLED}])", l):
            table[int(n)] = str(CIRCLED.index(a) + 1)
    return table


def assemble(prob: dict[int, list[str]], sol_left: dict[int, list[str]], sol_right: dict[int, list[str]],
             table: dict[int, str], prob_pages: dict[int, int], global_note: str | None) -> list[Q]:
    out: list[Q] = []
    for no in sorted(set(prob) | set(sol_left) | set(sol_right)):
        q = Q(no=no, page=prob_pages.get(no), stem_note=global_note, answer_table=table.get(no))
        if no not in prob:
            q.warnings.append("문제편에 없음")
        if no not in sol_right:
            q.warnings.append("해설편 해설 없음")
        pb = parse_question_body(prob.get(no, []))
        sb = parse_question_body(sol_left.get(no, [])) if no in sol_left else None
        amb = 0
        amb_note = 0

        ambn = 0

        def fuse(a, b):
            nonlocal amb, ambn
            t, n, same = join_two(a, b)
            amb += n
            ambn = n
            return t, same

        st, same = fuse(pb.stem, sb.stem if sb else None)
        q.stem = st
        if sb and not same:
            q.warnings.append("문제편/해설편 발문 불일치")
        for i, (lab, frags) in enumerate(pb.bogi):
            other = sb.bogi[i][1] if sb and i < len(sb.bogi) else None
            t, same = fuse(frags, other)
            q.bogi.append({"label": lab, "text": t, "verdict": None, "note": None, "wrap_ambiguous": ambn})
            if sb and not same:
                q.warnings.append(f"보기 {lab} 불일치")
        for i, (cno, frags) in enumerate(pb.choices):
            other = sb.choices[i][1] if sb and i < len(sb.choices) else None
            t, same = fuse(frags, other)
            q.choices.append({"no": cno, "text": t, "verdict": None, "note": None, "wrap_ambiguous": ambn})
            if sb and not same:
                q.warnings.append(f"선지 {cno} 불일치")
        if sb and (len(sb.choices) != len(pb.choices) or len(sb.bogi) != len(pb.bogi)):
            q.warnings.append("문제편/해설편 선지·보기 개수 불일치")
        if len(q.choices) != 4:
            q.warnings.append(f"선지 {len(q.choices)}개 (4개 아님)")
        if sol_right.get(no) is not None:
            ex = parse_explanation(sol_right[no])
            q.preamble = join_two(ex.preamble, None)[0] if ex.preamble else ""
            amb_note += join_two(ex.preamble, None)[1] if ex.preamble else 0
            q.answer = ex.answer
            target = {c["no"]: c for c in q.choices} | {CANON.get(b["label"], b["label"]): b for b in q.bogi}
            for label, verdict, frags in ex.items:
                label = CANON.get(label, label)
                t, n, _ = join_two(frags, None)
                amb_note += n
                if label in target:
                    target[label]["verdict"] = verdict
                    target[label]["note"] = t
                else:
                    q.warnings.append(f"해설 항목 {label} 에 대응하는 선지/보기 없음")
            if ex.answer is None:
                q.warnings.append("해설편에 '정답' 표시 없음")
        q.ambiguous_breaks = amb
        q.ambiguous_breaks_notes = amb_note
        if q.answer and q.answer_table and q.answer != q.answer_table:
            q.warnings.append(f"정답 불일치: 모아보기 {q.answer_table} / 해설 {q.answer}")
        if q.answer is None and q.answer_table:
            q.answer = q.answer_table
            q.warnings.append("정답은 모아보기 표에서만 확인됨")
        _polarity_check(q)
        out.append(q)
    return out


def _polarity_check(q: Q) -> None:
    """정답과 항목별 원본 ○× 표시가 서로 맞는지 검사한다. 고치지 않고, 안 맞으면 경고 + verdict_ok=False.
    verdict_ok 가 False 인 문항은 OX 변환에서 제외된다(원본 표시가 깨졌거나 원본 자체가 모순)."""
    q.verdict_ok = False
    if not q.answer:
        return
    neg, pos = bool(NEG_RE.search(q.stem)), bool(POS_RE.search(q.stem))
    if neg == pos:
        if not (q.bogi and not neg):  # 보기형이면서 부정 표현이 없는 경우만 '○ 조합' 으로 검증 시도
            q.warnings.append("발문이 '옳은/옳지 않은 것' 유형이 아니거나 불명 — ○× 검증 불가, OX 변환 제외")
            return
        pos = True
    items = q.bogi if q.bogi else q.choices
    missing = [(i.get("label") or i.get("no")) for i in items if not i["verdict"]]
    if missing:
        q.warnings.append(f"원본 ○× 표시 누락/불명: {', '.join(missing)} — 원본 확인 필요, OX 변환 제외")
        return
    want = "X" if neg else "O"
    if q.bogi:
        ch = next((c for c in q.choices if c["no"] == CIRCLED[int(q.answer) - 1]), None)
        in_choice = {CANON[c] for c in re.findall(f"[{BOGI_LABELS}{JAMO}]", ch["text"])} if ch else set()
        by_verdict = {CANON.get(b["label"], b["label"]) for b in q.bogi if b["verdict"] == want}
        if in_choice != by_verdict:
            q.warnings.append(
                f"원본 모순: 정답 선지의 조합 {sorted(in_choice)} 과 항목별 {want} 표시 {sorted(by_verdict)} 불일치 — OX 변환 제외")
            return
    else:
        ch = next((c for c in q.choices if c["no"] == CIRCLED[int(q.answer) - 1]), None)
        n_want = sum(c["verdict"] == want for c in q.choices)
        if not ch or ch["verdict"] != want or n_want != 1:
            q.warnings.append(f"원본 모순: 발문 유형상 정답 선지만 '{want}' 여야 하나 표시가 맞지 않음 — OX 변환 제외")
            return
    q.verdict_ok = True


# ───────────────────────── 파생 OX ─────────────────────────
SENTENCE_END = re.compile(r"(다|음|함|됨|임|있다|없다)[.)]?$")


def derive_ox(q: Q, book: str) -> list[dict]:
    """선지/보기 중 '단독 문장' 이고 원본 ○× 표시가 있는 것만 OX 변형 문항 후보로 만든다."""
    out = []
    if not q.verdict_ok:
        return out
    pool = [("bogi", b["label"], b) for b in q.bogi] + [("choice", c["no"], c) for c in q.choices]
    for kind, label, it in pool:
        if kind == "choice" and q.bogi:
            continue  # 보기형 문항의 선지는 '㉠, ㉢' 조합이라 단독 문장이 아님
        if it["verdict"] is None or len(it["text"]) < 15 or not SENTENCE_END.search(it["text"]):
            continue
        w = []
        if it.get("wrap_ambiguous"):
            w.append(f"PDF 줄바꿈으로 띄어쓰기 모호 {it['wrap_ambiguous']}곳 (검수 필요)")
        if CASE_RE.search(q.stem):
            w.append("원 문항 발문이 사례/조건형 — 선지가 발문 맥락에 의존할 수 있음(검수 필요)")
        out.append({
            "source_no": f"{q.no:02d}-{label}",
            "statement": it["text"],
            "answer": it["verdict"],
            "explanation": it["note"],
            "derived_from_no": f"{q.no:02d}",
            "derived_from_label": label,
            "stem_note": ((q.stem_note + "\n") if q.stem_note else "") + f"[원 문항 발문] {q.stem}",
            "warnings": w,
        })
    return out


# ───────────────────────── 출력 ─────────────────────────
def report(qs: list[Q], derived: list[dict], expected: int | None) -> dict:
    nums = [q.no for q in qs]
    gaps = [n for n in range(1, max(nums) + 1) if n not in nums] if nums else []
    return {
        "total_mcq": len(qs),
        "expected_from_answer_table": expected,
        "number_gaps": gaps,
        "with_answer": sum(bool(q.answer) for q in qs),
        "answer_table_agrees": sum(bool(q.answer and q.answer == q.answer_table) for q in qs),
        "with_4_choices": sum(len(q.choices) == 4 for q in qs),
        "choices_with_original_verdict": sum(c["verdict"] is not None for q in qs for c in q.choices),
        "bogi_questions": sum(bool(q.bogi) for q in qs),
        "questions_with_warnings": sum(bool(q.warnings) for q in qs),
        "ambiguous_line_breaks_in_question_text": sum(q.ambiguous_breaks for q in qs),
        "ambiguous_line_breaks_in_explanations": sum(q.ambiguous_breaks_notes for q in qs),
        "verdict_ok_questions": sum(q.verdict_ok for q in qs),
        "verdict_not_ok": [q.no for q in qs if not q.verdict_ok],
        "not_in_answer_table": [q.no for q in qs if q.answer_table is None],
        "derived_ox_candidates": len(derived),
        "derived_ox_answer_O": sum(d["answer"] == "O" for d in derived),
        "derived_ox_answer_X": sum(d["answer"] == "X" for d in derived),
        "warnings": {f"{q.no:02d}": q.warnings for q in qs if q.warnings},
        "note": "PDF 입력: 줄바꿈 자리의 띄어쓰기는 복원되지 않고 붙여쓰기로 처리됨(두 PDF 줄바꿈이 동일). HWPX 원본 수령 시 재변환 권장.",
    }


def build_sql(qs: list[Q], derived: list[dict], book: str, subject_id: str, shas: str, src: str,
              unit_title: str | None, test: bool, version_no: int = 1) -> str:
    T = str(test).upper()
    L = ["-- 자동 생성: mcq_pdf_import.py — 모든 문항은 검수 전(pending). 운영 DB 에는 사전 승인 후 적용.", "BEGIN;"]
    batch = uuid.uuid5(NS, "batch:" + shas)
    L.append("INSERT INTO game_import_batches(id,source_file,source_sha256,book_title,question_count,warning_count,is_test_data) VALUES "
             f"('{batch}',{sql_str(src)},'{shas}',{sql_str(book)},{len(qs) + len(derived)},"
             f"{sum(bool(q.warnings) for q in qs)},{T}) ON CONFLICT DO NOTHING;")
    unit = None
    if unit_title:
        unit = str(uuid.uuid5(NS, f"unit:{subject_id}:{unit_title}"))
        L.append(f"INSERT INTO game_units(id,subject_id,parent_id,level,title) VALUES ('{unit}','{subject_id}',NULL,1,{sql_str(unit_title)}) ON CONFLICT DO NOTHING;")
    qid = {q.no: uuid.uuid5(NS, f"q:{book}:{q.no:02d}") for q in qs}

    def emit(question_id, vid, source_no, qtype, page, parent, label, stmt, answer, expl, note, bogi, choices):
        if version_no > 1:
            # 재가져오기(예: PDF → HWPX): 기존 문항 신원은 유지하고 새 버전만 추가, 현재 버전만 교체
            L.append(
                "INSERT INTO game_question_versions(id,question_id,version_no,statement,answer,explanation,stem_note,bogi,choices,change_note) VALUES "
                f"('{vid}','{question_id}',{version_no},{sql_str(stmt)},'{answer}',{sql_str(expl)},{sql_str(note)},"
                f"{sql_str(json.dumps(bogi, ensure_ascii=False) if bogi else None)}::jsonb,"
                f"{sql_str(json.dumps(choices, ensure_ascii=False))}::jsonb,{sql_str(f'재가져오기 v{version_no}: {src}')}) ON CONFLICT DO NOTHING;")
            L.append(f"UPDATE game_questions SET current_version_id='{vid}' WHERE id='{question_id}';")
            return
        L.append(
            "INSERT INTO game_questions(id,subject_id,unit_id,source_book,source_page,source_no,question_type,"
            "derived_from_question_id,derived_from_label,import_batch_id,current_version_id,review_status,is_test_data) VALUES "
            f"('{question_id}','{subject_id}',{sql_str(unit)},{sql_str(book)},{page if page else 'NULL'},{sql_str(source_no)},"
            f"'{qtype}',{sql_str(str(parent) if parent else None)},{sql_str(label)},'{batch}','{vid}','pending',{T}) ON CONFLICT DO NOTHING;")
        L.append(
            "INSERT INTO game_question_versions(id,question_id,version_no,statement,answer,explanation,stem_note,bogi,choices) VALUES "
            f"('{vid}','{question_id}',1,{sql_str(stmt)},'{answer}',{sql_str(expl)},{sql_str(note)},"
            f"{sql_str(json.dumps(bogi, ensure_ascii=False) if bogi else None)}::jsonb,"
            f"{sql_str(json.dumps(choices, ensure_ascii=False))}::jsonb) ON CONFLICT DO NOTHING;")
        L.append(f"INSERT INTO game_question_metadata(question_id,exam_frequency_status) VALUES ('{question_id}','unverified') ON CONFLICT DO NOTHING;")

    for q in qs:
        if not q.answer:
            L.append(f"-- 건너뜀(정답 미확인): {book} #{q.no:02d}")
            continue
        expl = q.preamble or None
        emit(qid[q.no], uuid.uuid5(NS, f"v:{book}:{q.no:02d}:{version_no}"), f"{q.no:02d}", "mcq", q.page, None, None,
             q.stem, q.answer, expl, q.stem_note, q.bogi, q.choices)
    for d in derived:
        src_q = qid[int(d["derived_from_no"])]
        emit(uuid.uuid5(NS, f"q:{book}:{d['source_no']}"), uuid.uuid5(NS, f"v:{book}:{d['source_no']}:{version_no}"),
             d["source_no"], "ox", None, src_q, d["derived_from_label"], d["statement"], d["answer"],
             d["explanation"], d["stem_note"], [], [])
    L.append("COMMIT;")
    return "\n".join(L) + "\n"


def sha(*paths: Path) -> str:
    h = hashlib.sha256()
    for p in paths:
        h.update(p.read_bytes())
    return h.hexdigest()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--problems", type=Path, required=True)
    ap.add_argument("--solutions", type=Path, required=True)
    ap.add_argument("--book", required=True, help="원본 교재명 (예: 이윤탁 형사소송법 기출원문 모의고사 제1회)")
    ap.add_argument("--unit", help="단원/범위 라벨 (예: 총론·수사의 개시·임의수사)")
    ap.add_argument("--subject", default="criminal_procedure")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--test-data", action="store_true")
    ap.add_argument("--version-no", type=int, default=1, help="2 이상이면 기존 문항에 새 버전만 추가 (재가져오기)")
    a = ap.parse_args(argv)

    pl, pr = column_streams(a.problems, first_page_top=124)
    sl, sr = column_streams(a.solutions, first_page_top=190)
    stream = lambda cols: [l for _, ls in cols for l in ls]
    prob_pages: dict[int, int] = {}
    for pg, ls in (x for pair in zip(pl, pr) for x in pair):
        for l in ls:
            m = NUM_RE.match(l)
            if m:
                prob_pages.setdefault(int(m.group(1)), pg)
    prob_lines = stream(pl) + stream(pr) if False else [l for (pa, la), (pb, lb) in zip(pl, pr) for l in la + lb]
    note_lines = crop_lines(a.problems, 1, 0, 105, 595, 22)  # 양 단에 걸친 전폭 안내 박스
    global_note = next((l for l in note_lines if GLOBAL_NOTE_RE.match(l)), None)
    table = parse_answer_table(a.solutions, 100, 90)
    prob = split_blocks(prob_lines)
    sol_left = split_blocks(stream(sl))
    sol_right = split_blocks(stream(sr))
    qs = assemble(prob, sol_left, sol_right, table, prob_pages, global_note)
    derived = [d for q in qs for d in derive_ox(q, a.book)]
    rep = report(qs, derived, len(table) or None)

    a.out.mkdir(parents=True, exist_ok=True)
    with (a.out / "questions.jsonl").open("w", encoding="utf-8") as f:
        for q in qs:
            f.write(json.dumps({**asdict(q), "type": "mcq", "book": a.book, "is_test_data": a.test_data}, ensure_ascii=False) + "\n")
        for d in derived:
            f.write(json.dumps({**d, "type": "ox_derived", "book": a.book, "is_test_data": a.test_data}, ensure_ascii=False) + "\n")
    (a.out / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=2), encoding="utf-8")
    title = f"{a.book}: {a.unit}" if a.unit else None
    (a.out / "seed.sql").write_text(
        build_sql(qs, derived, a.book, a.subject, sha(a.problems, a.solutions),
                  f"{a.problems.name} + {a.solutions.name}", title, a.test_data, a.version_no), encoding="utf-8")
    print(json.dumps({k: v for k, v in rep.items() if k != "warnings"}, ensure_ascii=False, indent=2))
    print("경고 문항:", ", ".join(rep["warnings"]) or "없음")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
