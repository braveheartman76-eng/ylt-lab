"""HWPX / TXT 에서 문단 목록을 뽑는 최소 리더 (표준 라이브러리만 사용).

HWPX 는 ZIP 안의 Contents/section*.xml 에 <hp:p> 문단과 <hp:t> 텍스트가 들어 있다.
표 안의 문단도 <hp:p> 이므로 문서 순서대로 평탄화한다.
페이지 번호는 HWPX 에 확정 저장되어 있지 않으므로 추정하지 않는다.
(원고에 '- 12 -' 같은 쪽번호 문단이 있을 때만 page_hint 로 기록)
"""
from __future__ import annotations

import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET


@dataclass
class Para:
    text: str
    index: int  # 문서 내 문단 순번 (원본 추적용)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _para_text(p: ET.Element) -> str:
    parts: list[str] = []
    for el in p.iter():
        name = _local(el.tag)
        if name == "t" and el.text:
            parts.append(el.text)
        elif name == "lineBreak" or name == "tab":
            parts.append(" ")
    return "".join(parts).strip()


def _section_key(name: str) -> int:
    m = re.search(r"section(\d+)\.xml$", name)
    return int(m.group(1)) if m else 0


def read_hwpx(path: Path) -> list[Para]:
    paras: list[Para] = []
    with zipfile.ZipFile(path) as z:
        sections = sorted(
            (n for n in z.namelist() if re.search(r"Contents/section\d+\.xml$", n)),
            key=_section_key,
        )
        if not sections:
            raise ValueError(f"{path.name}: Contents/section*.xml 이 없습니다 (HWPX 가 아닐 수 있음)")
        for name in sections:
            root = ET.fromstring(z.read(name))
            for el in root.iter():
                if _local(el.tag) == "p":
                    # 표 셀 안에 중첩된 p 의 텍스트가 바깥 p 에 중복되지 않도록 직계 t 만 취한다
                    text = _direct_para_text(el)
                    if text:
                        paras.append(Para(text, len(paras)))
    return paras


def _t_text(t: ET.Element) -> str:
    """<hp:t> 의 텍스트. <hp:tab/> 같은 인라인 요소 '뒤에 이어지는 글자(tail)'도 포함해야 한다.
    예) <hp:t>① 가<hp:tab/>② 나</hp:t> → '① 가 ② 나'  (tail 을 버리면 ② 선지가 사라진다)"""
    parts = [t.text or ""]
    for c in t:
        parts.append(" " if _local(c.tag) in ("tab", "lineBreak") else "")
        parts.append(c.tail or "")
    return "".join(parts)


def _direct_para_text(p: ET.Element) -> str:
    parts: list[str] = []

    def walk(node: ET.Element) -> None:
        for ch in node:
            name = _local(ch.tag)
            if name == "p":  # 중첩 문단은 별도 문단으로 처리
                continue
            if name == "t":
                parts.append(_t_text(ch))
            elif name in ("lineBreak", "tab"):
                parts.append(" ")
            else:
                walk(ch)

    walk(p)
    return "".join(parts).strip()


def read_txt(path: Path) -> list[Para]:
    lines = path.read_text(encoding="utf-8").splitlines()
    return [Para(l.strip(), i) for i, l in enumerate(lines) if l.strip()]


def read_paragraphs(path: Path) -> list[Para]:
    suffix = path.suffix.lower()
    if suffix == ".hwpx":
        return read_hwpx(path)
    if suffix in (".txt", ".md"):
        return read_txt(path)
    if suffix == ".pdf":
        raise NotImplementedError(
            "PDF 는 아직 지원하지 않습니다. 원본 PDF 샘플을 받은 뒤 레이아웃에 맞춰 추가합니다. "
            "당장은 pdftotext 결과(.txt)를 넣거나 HWPX 를 사용하세요."
        )
    raise ValueError(f"지원하지 않는 형식: {suffix}")
