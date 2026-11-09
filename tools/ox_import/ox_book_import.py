#!/usr/bin/env python3
"""OX 문제집(■ 대제목 / ▸ 소제목 / 문제 + 정답·해설 + 출제 정보) → 게임 문제은행 가져오기.

입력 형식 (HWPX 또는 TXT, 문단 단위)
  ■ 대제목
  ▸ 소제목
  Ⓒ 1  문제 지문 <TAB> 24년 전의경            (Ⓐ/Ⓑ/Ⓒ 기호는 선택, 번호는 1 또는 1-1)
  정답 ○   해설 …

원칙
  * 문제 원문·정답·해설은 가공하지 않는다. 정답은 원본에 적힌 ○/× 만 사용한다.
  * 문제 옆 기호(Ⓐ Ⓑ Ⓒ)는 의미를 해석하지 않고 원문 그대로 raw_markers 에 보존한다(의미는 사용자 확인 후).
  * 출제 정보(예: '19년 일경2차 / 23년 경승')는 출처 기록(past_exam, 미검증)으로만 저장하고 출제빈도는 '미확인' 유지.
  * 해설에 '개정 반영 … 확인 요망' 같은 저자 주석이 있으면 경고(검수 필요). 법령 기준일은 주석에 적힌 날짜만 사용.
  * DB 에 직접 쓰지 않는다. JSONL + 리포트 + SQL 시드만 만들고, 모든 문항은 pending.
사용: python3 ox_book_import.py FILE --book "교재명" --out OUT/ [--test-data]
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
from hwpx_reader import read_paragraphs  # noqa: E402
from ox_import import NS, sql_str  # noqa: E402

MARKER_CHARS = "ⒶⒷⒸⒹⒺ"
H1 = re.compile(r"^■\s*(.+)$")
H2 = re.compile(r"^▸\s*(.+)$")
Q_RE = re.compile(rf"^(?P<mk>[{MARKER_CHARS}])?\s*(?P<no>\d+(?:-\d+)*)\s+(?P<body>\S.*)$")
ANS_RE = re.compile(r"^정답\s*(?P<a>[○◯×✕OX])\s*(?P<exp>.*)$")
ANS_MAP = {"○": "O", "◯": "O", "O": "O", "×": "X", "✕": "X", "X": "X"}
# 한 개의 출제 정보: '24년 전의경', '23·25년 경승', '17·18·19·23·24년 해승'
ONE_SRC = r"\d{2}(?:[·,]\d{2})*년\s*[가-힣0-9A-Za-z]+"
SRC_ALL = re.compile(rf"^{ONE_SRC}(?:\s*/\s*{ONE_SRC})*$")
SRC_TAIL = re.compile(rf"\s+({ONE_SRC}(?:\s*/\s*{ONE_SRC})*)$")
REVISION_NOTE = re.compile(r"개정\s*반영")
REVISION_DATE = re.compile(r"(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*개정\s*반영")


@dataclass
class OxQ:
    no: str
    section: str
    topic: str | None
    statement: str = ""
    answer: str | None = None
    explanation: str | None = None
    marker: str | None = None
    source_exams: list[str] = field(default_factory=list)
    law_basis_date: str | None = None
    para_index: int = 0
    warnings: list[str] = field(default_factory=list)

    @property
    def group_no(self) -> str:
        return self.no.split("-")[0]


def split_source(body: str) -> tuple[str, list[str]]:
    """'문제<TAB>출처' 또는 (탭이 사라진 경우) 문장 끝의 출제 정보 패턴으로 분리."""
    if "\t" in body:
        stmt, _, tail = body.rpartition("\t")
        if SRC_ALL.match(tail.strip()):
            return stmt.strip(), [x.strip() for x in tail.split("/")]
        return re.sub(r"\s+", " ", body).strip(), []
    m = SRC_TAIL.search(body)
    if m:
        return body[: m.start()].strip(), [x.strip() for x in m.group(1).split("/")]
    return body.strip(), []


def parse(paras: list[tuple[int, str]]) -> list[OxQ]:
    out: list[OxQ] = []
    section = topic = None
    cur: OxQ | None = None
    mode = None  # 'stmt' | 'exp'
    for idx, raw in paras:
        t = raw.strip()
        if not t:
            continue
        if (m := H1.match(t)):
            section, topic, cur, mode = m.group(1).strip(), None, None, None
            continue
        if (m := H2.match(t)):
            topic, cur, mode = m.group(1).strip(), None, None
            continue
        a = ANS_RE.match(t)
        if a and cur is not None:
            cur.answer = ANS_MAP[a.group("a")]
            cur.explanation = re.sub(r"\s+", " ", a.group("exp")).strip() or None
            mode = "exp"
            continue
        q = Q_RE.match(t)
        if q and section is not None and (mode in (None, "exp") or cur is None or cur.answer is not None):
            stmt, srcs = split_source(q.group("body"))
            cur = OxQ(no=q.group("no"), section=section, topic=topic, statement=re.sub(r"\s+", " ", stmt),
                      marker=q.group("mk"), source_exams=srcs, para_index=idx)
            out.append(cur)
            mode = "stmt"
            continue
        if cur is None:
            continue
        # 줄바꿈된 이어지는 문단
        if mode == "exp":
            cur.explanation = ((cur.explanation or "") + " " + re.sub(r"\s+", " ", t)).strip()
        else:
            more, srcs = split_source(t)
            cur.statement = (cur.statement + " " + re.sub(r"\s+", " ", more)).strip()
            cur.source_exams += srcs
    for q in out:
        d = REVISION_DATE.search(q.explanation or "")
        if d:
            q.law_basis_date = f"{int(d.group(1)):04d}-{int(d.group(2)):02d}-{int(d.group(3)):02d}"
        if REVISION_NOTE.search(q.explanation or ""):
            q.warnings.append("해설에 저자의 '개정 반영' 주석(하위법령 확인 요망 등)이 있음 — 법령 기준일/내용 검수 필요")
        if not q.statement:
            q.warnings.append("문제 본문 없음")
        if q.answer is None:
            q.warnings.append("정답을 찾지 못함")
    dup = Counter((q.section, q.no) for q in out)
    for q in out:
        if dup[(q.section, q.no)] > 1:
            q.warnings.append("같은 대제목 안에서 문제번호 중복")
    return out


def validate(qs: list[OxQ]) -> dict:
    return {
        "total": len(qs),
        "sections": len({q.section for q in qs}),
        "topics": len({(q.section, q.topic) for q in qs}),
        "with_answer": sum(q.answer is not None for q in qs),
        "answer_O": sum(q.answer == "O" for q in qs),
        "answer_X": sum(q.answer == "X" for q in qs),
        "with_source_exam": sum(bool(q.source_exams) for q in qs),
        "marker_counts": dict(Counter(q.marker for q in qs if q.marker)),
        "no_marker": sum(q.marker is None for q in qs),
        "questions_with_warnings": sum(bool(q.warnings) for q in qs),
        "warnings": {f"{q.section[:12]}#{q.no}": q.warnings for q in qs if q.warnings},
        "unconfirmed_marker_symbols": sorted({q.marker for q in qs if q.marker}),
        "note": "마커(Ⓐ/Ⓑ/Ⓒ) 의미는 해석하지 않음(사용자 확인 필요). 출제빈도는 '미확인'.",
    }


def scope(book: str, section: str) -> str:
    return f"{book} ■ {section}"  # 대제목마다 문제번호가 새로 시작하므로 (교재명, 번호) 유일성을 위해 범위를 붙인다


def build_sql(qs: list[OxQ], book: str, subject_id: str, sha: str, src: str, test: bool) -> str:
    T = str(test).upper()
    L = ["-- 자동 생성: ox_book_import.py — 모든 문항은 검수 전(pending). 운영 DB 에는 사전 승인 후 적용.", "BEGIN;"]
    batch = uuid.uuid5(NS, "batch:" + sha)
    L.append("INSERT INTO game_import_batches(id,source_file,source_sha256,book_title,question_count,warning_count,is_test_data) VALUES "
             f"('{batch}',{sql_str(src)},'{sha}',{sql_str(book)},{len(qs)},{sum(bool(q.warnings) for q in qs)},{T}) ON CONFLICT DO NOTHING;")
    units: dict[tuple, str] = {}
    for q in qs:
        path = [q.section] + ([q.topic] if q.topic else [])
        parent = None
        for depth, title in enumerate(path, start=1):
            key = tuple(path[:depth])
            if key not in units:
                uid = str(uuid.uuid5(NS, f"unit:{subject_id}:" + "/".join(key)))
                units[key] = uid
                L.append(f"INSERT INTO game_units(id,subject_id,parent_id,level,title) VALUES ('{uid}','{subject_id}',{sql_str(parent)},{depth},{sql_str(title)}) ON CONFLICT DO NOTHING;")
            parent = units[key]
    for q in qs:
        if q.answer is None:
            L.append(f"-- 건너뜀(정답 미확인): {q.section} #{q.no}")
            continue
        sc = scope(book, q.section)
        qid = uuid.uuid5(NS, f"q:{sc}:{q.no}")
        vid = uuid.uuid5(NS, f"v:{sc}:{q.no}:1")
        unit = units[tuple([q.section] + ([q.topic] if q.topic else []))]
        markers = [{"symbol": q.marker, "position": "leading", "meaning": None}] if q.marker else []
        L.append("INSERT INTO game_questions(id,subject_id,unit_id,source_book,source_page,source_no,question_type,import_batch_id,current_version_id,review_status,is_test_data) VALUES "
                 f"('{qid}','{subject_id}','{unit}',{sql_str(sc)},NULL,{sql_str(q.no)},'ox','{batch}','{vid}','pending',{T}) ON CONFLICT DO NOTHING;")
        L.append("INSERT INTO game_question_versions(id,question_id,version_no,statement,answer,explanation,raw_markers,law_basis_date) VALUES "
                 f"('{vid}','{qid}',1,{sql_str(q.statement)},'{q.answer}',{sql_str(q.explanation)},{sql_str(json.dumps(markers, ensure_ascii=False))}::jsonb,"
                 f"{sql_str(q.law_basis_date)}) ON CONFLICT DO NOTHING;")
        L.append(f"INSERT INTO game_question_metadata(question_id,exam_frequency_status) VALUES ('{qid}','unverified') ON CONFLICT DO NOTHING;")
        for c in q.source_exams:
            sid = uuid.uuid5(NS, f"s:{sc}:{q.no}:{c}")
            L.append("INSERT INTO game_question_sources(id,question_id,source_type,citation,is_verified) VALUES "
                     f"('{sid}','{qid}','past_exam',{sql_str(c)},FALSE) ON CONFLICT DO NOTHING;")
    L.append("COMMIT;")
    return "\n".join(L) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", type=Path)
    ap.add_argument("--book", required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--subject", default="criminal_procedure")
    ap.add_argument("--test-data", action="store_true")
    a = ap.parse_args(argv)
    paras = [(p.index, p.text) for p in read_paragraphs(a.file)]
    qs = parse(paras)
    rep = validate(qs)
    a.out.mkdir(parents=True, exist_ok=True)
    with (a.out / "questions.jsonl").open("w", encoding="utf-8") as f:
        for q in qs:
            f.write(json.dumps({**asdict(q), "type": "ox_book", "book": a.book, "scope": scope(a.book, q.section), "is_test_data": a.test_data}, ensure_ascii=False) + "\n")
    (a.out / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=2), encoding="utf-8")
    sha = hashlib.sha256(a.file.read_bytes()).hexdigest()
    (a.out / "seed.sql").write_text(build_sql(qs, a.book, a.subject, sha, a.file.name, a.test_data), encoding="utf-8")
    print(json.dumps({k: v for k, v in rep.items() if k != "warnings"}, ensure_ascii=False, indent=2))
    for k, w in rep["warnings"].items():
        print(f"  경고 {k}: " + " / ".join(x[:70] for x in w))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
