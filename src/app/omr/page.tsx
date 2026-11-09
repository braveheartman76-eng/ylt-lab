'use client'

import { useMemo, useState } from 'react'

interface Sheet {
  id: string
  label: string
  kind: 'mcq' | 'ox'
  questions: number
  columns: number
  choices: string[]
}

// 인쇄 순서대로 정의 (형법/형소법은 4지선다 80문항, 교정학/형사정책은 OX 300문항)
const SHEETS: Sheet[] = [
  { id: 'criminal', label: '형법', kind: 'mcq', questions: 80, columns: 4, choices: ['①', '②', '③', '④'] },
  { id: 'procedure', label: '형사소송법', kind: 'mcq', questions: 80, columns: 4, choices: ['①', '②', '③', '④'] },
  { id: 'corrections', label: '교정학', kind: 'ox', questions: 300, columns: 6, choices: ['O', 'X'] },
  { id: 'policy', label: '형사정책', kind: 'ox', questions: 300, columns: 6, choices: ['O', 'X'] },
]

function OmrSheet({ sheet }: { sheet: Sheet }) {
  const { kind, questions, columns, choices, label } = sheet
  const rows = questions / columns
  return (
    <section className={`omr-sheet omr-${kind}`}>
      <header className="omr-title">
        <p className="omr-lab">이윤탁 형사법 연구실 · 모의고사 스터디</p>
        <h2>
          {kind === 'mcq'
            ? <>{label} 모의고사 제 <span className="omr-round" /> 회 답안지</>
            : <>{label} OX 답안지 ({questions}문항)</>}
        </h2>
      </header>

      <div className="omr-info">
        <div><span>이름</span><i /></div>
        <div><span>{kind === 'mcq' ? '응시일' : '범위/회차'}</span><i /></div>
        <div className="omr-info-score"><span>점수</span><i /> <b>/ {questions}</b></div>
      </div>

      <p className="omr-guide">
        답안은 컴퓨터용 사인펜(또는 검정 볼펜)으로 {kind === 'mcq' ? '보기 번호' : 'O/X'}의 원을 완전히 칠하십시오.
        수정할 때는 두 줄(=)을 긋고 다시 표기하십시오.
      </p>

      <div className="omr-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {Array.from({ length: columns }, (_, col) => (
          <div key={col} className="omr-col">
            {Array.from({ length: rows }, (_, row) => {
              const no = col * rows + row + 1
              return (
                <div key={no} className="omr-row">
                  <span className="omr-no">{no}</span>
                  {choices.map((c) => (
                    <span key={c} className="omr-bubble">{c}</span>
                  ))}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <footer className="omr-foot">
        {kind === 'mcq'
          ? '※ 문제 수가 80문항 미만인 회차는 남는 번호를 비워 두십시오.'
          : `※ 문항 수가 ${questions}문항 미만이면 남는 번호를 비워 두십시오.`}
      </footer>
    </section>
  )
}

export default function OmrPage() {
  const [selected, setSelected] = useState<string>('all')

  const sheets = useMemo(
    () => (selected === 'all' ? SHEETS : SHEETS.filter((x) => x.id === selected)),
    [selected],
  )

  return (
    <div className="omr-page">
      <style>{css}</style>

      <div className="omr-controls print:hidden">
        <h1 className="text-xl font-bold text-[#1a2a4a]">OMR 답안지</h1>
        <p className="text-sm text-gray-500 mt-1">
          형법·형사소송법(80문항 4지선다) 각 1장, 교정학·형사정책(300문항 OX) 각 1장. 회차는 인쇄 후 직접 적고, 필요한 만큼 복사해서 사용하세요.
        </p>

        <div className="flex flex-wrap items-center gap-3 mt-4">
          <label className="text-sm text-gray-600">
            과목{' '}
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="ml-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white"
            >
              <option value="all">전체</option>
              {SHEETS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-[#1a2a4a] text-white hover:bg-[#243558] transition-colors"
          >
            인쇄 / PDF 저장 ({sheets.length}장)
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          인쇄 설정에서 용지 A4, 배율 100%(실제 크기), 머리글/바닥글 해제를 권장합니다.
        </p>
      </div>

      <div className="omr-sheets">
        {sheets.map((x) => <OmrSheet key={x.id} sheet={x} />)}
      </div>
    </div>
  )
}

const css = `
.omr-page { padding: 2rem; }
.omr-controls { max-width: 48rem; margin-bottom: 1.5rem; }
.omr-sheets { display: flex; flex-direction: column; align-items: center; gap: 1.5rem; }

.omr-sheet {
  width: 210mm; height: 297mm; box-sizing: border-box; padding: 12mm 12mm 10mm;
  background: #fff; color: #111; box-shadow: 0 1px 6px rgba(0,0,0,.18);
  display: flex; flex-direction: column; flex-shrink: 0;
  break-after: page; page-break-after: always;
}
.omr-title { text-align: center; border-bottom: 2px solid #111; padding-bottom: 3mm; }
.omr-lab { font-size: 9pt; color: #444; margin: 0 0 1mm; }
.omr-title h2 { font-size: 18pt; font-weight: 700; margin: 0; letter-spacing: .02em; }
.omr-round { display: inline-block; min-width: 1.6em; height: 1em; vertical-align: bottom; border-bottom: 1.5px solid #111; }

.omr-info { display: flex; gap: 6mm; margin-top: 4mm; font-size: 10pt; }
.omr-info > div { display: flex; align-items: flex-end; gap: 2mm; flex: 1; }
.omr-info span { font-weight: 600; white-space: nowrap; }
.omr-info i { flex: 1; border-bottom: 1px solid #111; height: 6mm; }
.omr-info-score { flex: 0 0 38mm !important; }
.omr-info-score i { max-width: 14mm; }

.omr-guide { font-size: 8pt; color: #444; margin: 4mm 0 3mm; line-height: 1.4; }

.omr-grid {
  display: grid; gap: 0;
  border: 1.5px solid #111; flex: 1; max-height: 196mm;
}
.omr-col { display: flex; flex-direction: column; justify-content: space-around; padding: 2mm 0; }
.omr-col + .omr-col { border-left: 1px solid #111; }
.omr-row { display: flex; align-items: center; justify-content: center; gap: 1.6mm; }
.omr-row:nth-child(5n) { margin-bottom: 1.5mm; }
.omr-no { width: 6mm; text-align: right; font-size: 9.5pt; font-weight: 700; margin-right: .8mm; font-variant-numeric: tabular-nums; }
.omr-bubble {
  width: 5.6mm; height: 5.6mm; border: .6mm solid #111; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 7pt; line-height: 1; color: #111;
}
.omr-ox .omr-grid { max-height: 226mm; }
.omr-ox .omr-col { padding: 1.5mm 0; }
.omr-ox .omr-row { gap: 1.2mm; }
.omr-ox .omr-row:nth-child(5n) { margin-bottom: .8mm; }
.omr-ox .omr-row:last-child { margin-bottom: 0; }
.omr-ox .omr-no { width: 7mm; font-size: 7pt; margin-right: .5mm; }
.omr-ox .omr-bubble { width: 3.5mm; height: 3.5mm; border-width: .4mm; font-size: 5.5pt; font-weight: 600; }
.omr-foot { margin-top: auto; padding-top: 3mm; font-size: 8pt; color: #555; text-align: center; }

@page { size: A4 portrait; margin: 0; }
@media print {
  html, body { height: auto !important; background: #fff !important; }
  .omr-page { padding: 0; }
  .omr-sheets { display: block; }
  .omr-sheet { box-shadow: none; margin: 0; }
  .omr-sheet:last-child { break-after: auto; page-break-after: auto; }
}
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
`
