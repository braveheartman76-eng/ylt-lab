#!/usr/bin/env python3
"""OX 문제집(HWPX/TXT) → 게임 문제은행 가져오기 도구.

원칙
  * 문제 원문/정답/해설은 가공하지 않고 보존한다.
  * 문제 옆 기호는 의미를 해석하지 않는다. 원문 그대로 raw_markers 에 담고,
    프로필(profile.json)의 markers 에 사용자가 확인해 준 의미가 있을 때만 meaning 을 붙인다.
  * 정답/해설을 찾지 못하면 임의로 채우지 않고 경고로 남긴다.
  * 출력은 JSONL + 검증 리포트 + SQL 시드. DB 에 직접 쓰지 않는다 (운영 DB 보호).
  * 가져온 문항은 항상 review_status='pending' — 검수 전에는 학생에게 출제되지 않는다.

사용:
  python3 ox_import.py FILE.hwpx --book "교재명" --out out/ [--sample 100] [--test-data]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import uuid
from collections import Counter
from dataclasses import dataclass, field, asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from hwpx_reader import read_paragraphs, Para  # noqa: E402

NS = uuid.UUID("6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f")  # 결정적 UUID(재가져오기 시 동일 ID)


@dataclass
class Q:
    source_no: str
    statement: str = ""
    answer: str | None = None
    explanation: str | None = None
    raw_markers: list[dict] = field(default_factory=list)
    unit_path: list[str] = field(default_factory=list)
    page_hint: int | None = None
    para_index: int = 0
    warnings: list[str] = field(default_factory=list)


def load_profile(path: Path | None) -> dict:
    p = path or Path(__file__).with_name("profile.default.json")
    return json.loads(p.read_text(encoding="utf-8"))


def extract_markers(text: str, profile: dict) -> tuple[str, list[dict]]:
    """앞뒤에 붙은 표시 기호를 원문 그대로 분리. 의미는 프로필에 확인된 것만."""
    chars = profile["marker_chars"]
    known = profile.get("markers", {})
    found: list[dict] = []
    # 선두 기호
    m = re.match(rf"^([{re.escape(chars)}\s]+)", text)
    if m:
        for ch in m.group(1):
            if ch.strip():
                found.append({"symbol": ch, "position": "leading"})
        text = text[m.end():]
    # 말미 기호
    m = re.search(rf"([{re.escape(chars)}\s]+)$", text)
    if m:
        for ch in m.group(1):
            if ch.strip():
                found.append({"symbol": ch, "position": "trailing"})
        text = text[: m.start()]
    for f in found:
        info = known.get(f["symbol"])
        f["meaning"] = info.get("meaning") if info and info.get("confirmed_by_user") else None
    return text.strip(), found


def parse(paras: list[Para], profile: dict) -> list[Q]:
    q_re = re.compile(profile["question_regex"])
    inline_re = re.compile(profile["inline_answer_regex"])
    ans_re = re.compile(profile["answer_line_regex"])
    exp_re = re.compile(profile["explanation_regex"])
    page_re = re.compile(profile["page_marker_regex"])
    heads = [(h["level"], re.compile(h["regex"])) for h in profile["heading_patterns"]]
    amap = profile["answer_map"]

    out: list[Q] = []
    cur: Q | None = None
    mode = None  # 'stmt' | 'exp'
    path: dict[int, str] = {}
    page: int | None = None

    for p in paras:
        t = p.text
        pm = page_re.match(t)
        if pm:
            page = int(pm.group("page"))
            continue

        qm = q_re.match(t)
        em = exp_re.match(t)
        am = ans_re.match(t)

        # 문제 시작 (해설 안의 번호 목록과 혼동되지 않게 해설 모드에서는 연속번호일 때만 새 문제로 인정)
        if qm and not em and not am:
            no = qm.group("no")
            if cur is None or mode != "exp" or _is_next(cur.source_no, no):
                body = qm.group("body")
                stmt, markers = extract_markers(body, profile)
                ans = None
                im = inline_re.search(stmt)
                if im:
                    ans = amap.get(im.group("ans"))
                    stmt = stmt[: im.start()].strip()
                cur = Q(no, stmt, ans, None, markers,
                        [path[k] for k in sorted(path)], page, p.index)
                out.append(cur)
                mode = "stmt"
                continue

        # 제목(단원)
        hit = False
        if cur is None or mode != "exp" or not qm:
            for level, rx in heads:
                if rx.match(t) and len(t) < 60:
                    path[level] = t
                    for k in list(path):
                        if k > level:
                            del path[k]
                    hit = True
                    break
        if hit:
            mode = None  # 제목 뒤에는 새 문제가 와야 하므로 이어붙이기 중단
            continue

        if cur is None:
            continue
        if am:
            cur.answer = amap.get(am.group("ans"))
            continue
        if em:
            cur.explanation = em.group("exp").strip()
            mode = "exp"
            continue
        if mode == "exp":
            cur.explanation = ((cur.explanation or "") + " " + t).strip()
        elif mode == "stmt":
            stmt, mk = extract_markers(t, profile)
            cur.raw_markers += mk
            cur.statement = (cur.statement + " " + stmt).strip()
    return out


def _is_next(prev: str, no: str) -> bool:
    return prev.isdigit() and no.isdigit() and int(no) == int(prev) + 1


def validate(qs: list[Q]) -> dict:
    nums = Counter(q.source_no for q in qs)
    dup_no = sorted(n for n, c in nums.items() if c > 1)
    stmts = Counter(re.sub(r"\s+", "", q.statement) for q in qs)
    dup_stmt = sum(1 for c in stmts.values() if c > 1)
    ints = sorted(int(q.source_no) for q in qs if q.source_no.isdigit())
    gaps = [n for n in range(ints[0], ints[-1] + 1) if n not in set(ints)] if ints else []
    for q in qs:
        if not q.statement:
            q.warnings.append("문제 본문 없음")
        if q.answer is None:
            q.warnings.append("정답을 찾지 못함")
        if not q.explanation:
            q.warnings.append("해설 없음")
        if not q.unit_path:
            q.warnings.append("단원 미분류")
        if q.source_no in dup_no:
            q.warnings.append("문제번호 중복")
    return {
        "total": len(qs),
        "with_answer": sum(q.answer is not None for q in qs),
        "with_explanation": sum(bool(q.explanation) for q in qs),
        "with_unit": sum(bool(q.unit_path) for q in qs),
        "with_markers": sum(bool(q.raw_markers) for q in qs),
        "answer_O": sum(q.answer == "O" for q in qs),
        "answer_X": sum(q.answer == "X" for q in qs),
        "duplicate_numbers": dup_no,
        "duplicate_statement_groups": dup_stmt,
        "number_gaps": gaps,
        "questions_with_warnings": sum(bool(q.warnings) for q in qs),
        "marker_symbol_counts": dict(Counter(m["symbol"] for q in qs for m in q.raw_markers)),
        "unconfirmed_marker_symbols": sorted({m["symbol"] for q in qs for m in q.raw_markers if m["meaning"] is None}),
    }


def sql_str(s: str | None) -> str:
    return "NULL" if s is None else "'" + s.replace("'", "''") + "'"


def build_sql(qs: list[Q], book: str, subject_id: str, sha: str, src: str, test: bool) -> str:
    L = ["-- 자동 생성: ox_import.py — 검수 전(pending) 상태로만 적재됩니다.",
         "-- 운영 DB 에는 사전 승인 후 적용하세요.", "BEGIN;"]
    batch_id = uuid.uuid5(NS, "batch:" + sha)
    L.append(
        "INSERT INTO game_import_batches(id,source_file,source_sha256,book_title,question_count,warning_count,is_test_data)"
        f" VALUES ('{batch_id}',{sql_str(src)},'{sha}',{sql_str(book)},{len(qs)},"
        f"{sum(bool(q.warnings) for q in qs)},{str(test).upper()}) ON CONFLICT DO NOTHING;")
    unit_ids: dict[tuple, str] = {}
    for q in qs:
        parent = None
        for depth, title in enumerate(q.unit_path, start=1):
            key = tuple(q.unit_path[:depth])
            if key not in unit_ids:
                uid = str(uuid.uuid5(NS, f"unit:{subject_id}:" + "/".join(key)))
                unit_ids[key] = uid
                L.append(
                    "INSERT INTO game_units(id,subject_id,parent_id,level,title) VALUES "
                    f"('{uid}','{subject_id}',{sql_str(parent)},{depth},{sql_str(title)}) ON CONFLICT DO NOTHING;")
            parent = unit_ids[key]
    for q in qs:
        if q.answer is None:
            L.append(f"-- 건너뜀(정답 미확인): {book} #{q.source_no}")
            continue
        qid = uuid.uuid5(NS, f"q:{book}:{q.source_no}")
        vid = uuid.uuid5(NS, f"v:{book}:{q.source_no}:1")
        unit = unit_ids.get(tuple(q.unit_path)) if q.unit_path else None
        L.append(
            "INSERT INTO game_questions(id,subject_id,unit_id,source_book,source_page,source_no,import_batch_id,"
            "current_version_id,review_status,is_test_data) VALUES "
            f"('{qid}','{subject_id}',{sql_str(unit)},{sql_str(book)},{q.page_hint if q.page_hint else 'NULL'},"
            f"{sql_str(q.source_no)},'{batch_id}','{vid}','pending',{str(test).upper()}) ON CONFLICT DO NOTHING;")
        L.append(
            "INSERT INTO game_question_versions(id,question_id,version_no,statement,answer,explanation,raw_markers) VALUES "
            f"('{vid}','{qid}',1,{sql_str(q.statement)},'{q.answer}',{sql_str(q.explanation)},"
            f"{sql_str(json.dumps(q.raw_markers, ensure_ascii=False))}::jsonb) ON CONFLICT DO NOTHING;")
        # 출제빈도는 미확인 상태로 시작 (임의 산정 금지)
        L.append(
            f"INSERT INTO game_question_metadata(question_id,exam_frequency_status) VALUES ('{qid}','unverified') ON CONFLICT DO NOTHING;")
    L.append("COMMIT;")
    return "\n".join(L) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", type=Path)
    ap.add_argument("--book", required=True, help="원본 교재명")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--profile", type=Path)
    ap.add_argument("--subject", help="과목 id (criminal_law / criminal_procedure)")
    ap.add_argument("--sample", type=int, help="앞에서 N문항만 샘플 출력")
    ap.add_argument("--test-data", action="store_true", help="가상 테스트 문항임을 표시")
    a = ap.parse_args(argv)

    profile = load_profile(a.profile)
    subject = a.subject or profile["subject_id"]
    paras = read_paragraphs(a.file)
    qs = parse(paras, profile)
    report = validate(qs)
    if a.sample:
        qs = qs[: a.sample]
        report["sample_limited_to"] = a.sample
    sha = hashlib.sha256(a.file.read_bytes()).hexdigest()
    a.out.mkdir(parents=True, exist_ok=True)
    with (a.out / "questions.jsonl").open("w", encoding="utf-8") as f:
        for q in qs:
            d = asdict(q)
            d.update(book=a.book, subject_id=subject, is_test_data=a.test_data)
            f.write(json.dumps(d, ensure_ascii=False) + "\n")
    (a.out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (a.out / "seed.sql").write_text(build_sql(qs, a.book, subject, sha, a.file.name, a.test_data), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
