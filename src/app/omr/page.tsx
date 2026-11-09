'use client'

import { useMemo, useState } from 'react'

const SUBJECTS = ['형법', '형사소송법'] as const
type Subject = (typeof SUBJECTS)[number]

const ROUNDS = 10 // 과목별 회차 수
const QUESTIONS = 80 // OMR 문항 수 (실제 문제 수는 80문제 미만)
const COLUMNS = 4
const ROWS = QUESTIONS / COLUMNS
const CHOICES = ['①', '②', '③', '④']

interface Sheet {
  subject: Subject
  round: number
}

function OmrSheet({ subject, round }: Sheet) {
  return (
    <section className="omr-sheet">
      <header className="omr-title">
        <p className="omr-lab">이윤탁 형사법 연구실 · 모의고사 스터디</p>
        <h2>
          {subject} 모의고사 제 <span className="omr-round">{round}</span> 회 답안지
        </h2>
      </header>

      <div className="omr-info">
        <div><span>이름</span><i /></div>
        <div><span>응시일</span><i /></div>
        <div className="omr-info-score"><span>점수</span><i /> <b>/ {QUESTIONS}</b></div>
      </div>

      <p className="omr-guide">
        답안은 컴퓨터용 사인펜(또는 검정 볼펜)으로 보기 번호의 원을 완전히 칠하십시오.
        수정할 때는 두 줄(=)을 긋고 다시 표기하십시오.
      </p>

      <div className="omr-grid">
        {Array.from({ length: COLUMNS }, (_, col) => (
          <div key={col} className="omr-col">
            {Array.from({ length: ROWS }, (_, row) => {
              const no = col * ROWS + row + 1
              return (
                <div key={no} className="omr-row">
                  <span className="omr-no">{no}</span>
                  {CHOICES.map((c) => (
                    <span key={c} className="omr-bubble">{c}</span>
                  ))}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <footer className="omr-foot">
        ※ 문제 수가 80문항 미만인 회차는 남는 번호를 비워 두십시오.
      </footer>
    </section>
  )
}

export default function OmrPage() {
  const [subject, setSubject] = useState<Subject | 'all'>('all')
  const [round, setRound] = useState<number | 'all'>('all')

  const sheets = useMemo<Sheet[]>(() => {
    const subjects = subject === 'all' ? SUBJECTS : [subject]
    const rounds = round === 'all'
      ? Array.from({ length: ROUNDS }, (_, i) => i + 1)
      : [round]
    return subjects.flatMap((s) => rounds.map((r) => ({ subject: s, round: r })))
  }, [subject, round])

  return (
    <div className="omr-page">
      <style>{css}</style>

      <div className="omr-controls print:hidden">
        <h1 className="text-xl font-bold text-[#1a2a4a]">OMR 답안지</h1>
        <p className="text-sm text-gray-500 mt-1">
          80문항 · 4지선다 · 형법 {ROUNDS}회 + 형사소송법 {ROUNDS}회 (총 {SUBJECTS.length * ROUNDS}장). A4 용지로 인쇄하세요.
        </p>

        <div className="flex flex-wrap items-center gap-3 mt-4">
          <label className="text-sm text-gray-600">
            과목{' '}
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value as Subject | 'all')}
              className="ml-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white"
            >
              <option value="all">전체</option>
              {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-600">
            회차{' '}
            <select
              value={round}
              onChange={(e) => setRound(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="ml-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white"
            >
              <option value="all">전체</option>
              {Array.from({ length: ROUNDS }, (_, i) => i + 1).map((r) => (
                <option key={r} value={r}>{r}회</option>
              ))}
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
        {sheets.map((s) => <OmrSheet key={`${s.subject}-${s.round}`} {...s} />)}
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
.omr-round { display: inline-block; min-width: 1.4em; border-bottom: 1.5px solid #111; }

.omr-info { display: flex; gap: 6mm; margin-top: 4mm; font-size: 10pt; }
.omr-info > div { display: flex; align-items: flex-end; gap: 2mm; flex: 1; }
.omr-info span { font-weight: 600; white-space: nowrap; }
.omr-info i { flex: 1; border-bottom: 1px solid #111; height: 6mm; }
.omr-info-score { flex: 0 0 38mm !important; }
.omr-info-score i { max-width: 14mm; }

.omr-guide { font-size: 8pt; color: #444; margin: 4mm 0 3mm; line-height: 1.4; }

.omr-grid {
  display: grid; grid-template-columns: repeat(${COLUMNS}, 1fr); gap: 0;
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
