#!/usr/bin/env python3
"""mcq_pdf_import.py 의 questions.jsonl → 게임(로컬 모드)용 JSON.

  python3 tools/export_game_json.py OUT/questions.jsonl --unit "단원명" \
      --out public/game-data/questions.local.json

* 4지선다는 원본 ○×·정답이 서로 맞는 문항(verdict_ok)만 내보낸다. 원본 모순/표시 누락 문항은 제외(검수 후 포함).
* 파생 OX 는 해당 4지선다가 verdict_ok 인 경우에만 존재한다.
* 이 파일은 검수 전 데이터이므로 gitignore 대상이다. 서버(Supabase) 모드에서는 검수 승인된 문항만 출제된다.
"""
import argparse, hashlib, json
from pathlib import Path


def expl_mcq(r):
    lines = []
    if r.get("preamble"):
        lines.append(r["preamble"])
    for b in r.get("bogi") or []:
        if b.get("verdict"):
            lines.append(f"{b['label']} {'○' if b['verdict'] == 'O' else '×'} {b.get('note') or ''}".strip())
    if not r.get("bogi"):
        for c in r["choices"]:
            if c.get("verdict"):
                lines.append(f"{c['no']} {'○' if c['verdict'] == 'O' else '×'} {c.get('note') or ''}".strip())
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("jsonl", type=Path)
    ap.add_argument("--unit", help="단원명 지정(미지정이면 jsonl 의 unit/book 값을 회차별로 사용)")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--test-data", action="store_true")
    a = ap.parse_args()
    h8 = lambda t: hashlib.sha1(t.encode("utf-8")).hexdigest()[:8]  # 실행마다 같은 ID(학습 기록 유지)
    out, skipped = [], 0
    rows = [json.loads(l) for l in a.jsonl.read_text(encoding="utf-8").splitlines()]
    key = lambda r: h8(r.get("book", ""))  # 회차(교재명)별 접두 — 회차 간 문항 번호 충돌 방지
    unit_of = lambda r: a.unit or r.get("unit") or r.get("book") or "미분류"
    ok_mcq = {(key(r), f"{r['no']:02d}") for r in rows if r["type"] == "mcq" and r.get("verdict_ok")}
    for r in rows:
        if r["type"] == "mcq":
            if not r.get("verdict_ok") or not r.get("answer") or r.get("warnings"):  # 경고가 하나라도 있으면 제외(최종본 아님)
                skipped += 1
                continue
            out.append(dict(
                id=f"mcq-{key(r)}-{r['no']:02d}", type="mcq", unitId="u-" + h8(unit_of(r)), unitTitle=unit_of(r), statement=r["stem"],
                stemNote=r.get("stem_note"), bogi=[dict(label=b["label"], text=b["text"]) for b in r["bogi"]] or None,
                choices=[dict(no=str(i + 1), text=c["text"]) for i, c in enumerate(r["choices"])],
                answer=r["answer"], explanation=expl_mcq(r), isTestData=a.test_data))
        elif r["type"] == "ox_derived":
            if (key(r), r["derived_from_no"]) not in ok_mcq:
                skipped += 1
                continue
            out.append(dict(
                id=f"ox-{key(r)}-{r['source_no']}", type="ox", unitId="u-" + h8(unit_of(r)), unitTitle=unit_of(r), statement=r["statement"],
                stemNote=r.get("stem_note"), answer=r["answer"], explanation=r.get("explanation"),
                derivedFrom=f"mcq-{key(r)}-{r['derived_from_no']}", isTestData=a.test_data))
    for q in out:
        for k in [k for k, v in q.items() if v is None]:
            del q[k]
    a.out.write_text(json.dumps(dict(version=1, source="local-import", questions=out), ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"내보냄 {len(out)}문항 (mcq {sum(q['type']=='mcq' for q in out)}, ox {sum(q['type']=='ox' for q in out)}), 제외 {skipped}")


if __name__ == "__main__":
    main()
