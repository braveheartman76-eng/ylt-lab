'use client'

import { useState, useRef, useCallback } from 'react'

type Mode = 'korean' | 'legal'

interface ProofreadError {
  id: number
  type: string
  original: string
  corrected: string
  location?: string
  explanation: string
  questionNumber?: string
}

interface ProofreadResult {
  errors: ProofreadError[]
  summary: {
    total: number
    byType: Record<string, number>
  }
  mode: Mode
  subject?: string
}

const SUBJECTS = ['형사소송법', '형법', '노동법', '교정학', '행정법']

const TYPE_COLORS: Record<string, string> = {
  '오탈자':   'bg-red-100 text-red-700',
  '띄어쓰기': 'bg-orange-100 text-orange-700',
  '맞춤법':   'bg-yellow-100 text-yellow-700',
  '답안오류': 'bg-red-100 text-red-700',
  '법리오류': 'bg-purple-100 text-purple-700',
  '문제오류': 'bg-blue-100 text-blue-700',
  '지문오류': 'bg-orange-100 text-orange-700',
}

function UploadIcon() {
  return (
    <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg className="w-10 h-10 text-[#1a2a4a] mx-auto mb-2" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

export default function ProofreadingPage() {
  const [file, setFile]       = useState<File | null>(null)
  const [mode, setMode]       = useState<Mode | null>(null)
  const [subject, setSubject] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<ProofreadResult | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const acceptFile = (f: File) => {
    const ok = f.name.toLowerCase().endsWith('.pdf') || f.name.toLowerCase().endsWith('.hwpx')
    if (ok) {
      setFile(f)
      setError(null)
      setResult(null)
    } else {
      setError('hwpx 또는 pdf 파일만 업로드할 수 있습니다.')
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) acceptFile(f)
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) acceptFile(f)
  }

  const handleSubmit = async () => {
    if (!file || !mode) return
    if (mode === 'legal' && !subject) {
      setError('과목을 선택해주세요.')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('mode', mode)
      if (subject) fd.append('subject', subject)

      const res = await fetch('/api/proofread', { method: 'POST', body: fd })
      const data = await res.json()

      if (!res.ok || data.error) throw new Error(data.error || '오류가 발생했습니다.')

      setResult(data as ProofreadResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = () => {
    if (!result) return
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `proofread_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const canSubmit = file && mode && !loading && (mode === 'korean' || (mode === 'legal' && subject))

  return (
    <div className="p-8 max-w-4xl">
      {/* 헤더 */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[#1a2a4a]">오탈자검수</h1>
        <p className="text-sm text-gray-500 mt-1">
          hwpx·pdf 파일을 업로드하고 검수 모드를 선택한 뒤 검수를 시작하세요.
        </p>
      </div>

      {/* 1. 파일 업로드 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Step 1 · 파일 업로드</p>
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors select-none ${
            dragOver
              ? 'border-[#1a2a4a] bg-[#f0f3f8]'
              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.hwpx"
            onChange={handleFileChange}
            className="hidden"
          />
          {file ? (
            <>
              <FileIcon />
              <p className="text-sm font-semibold text-[#1a2a4a]">{file.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{(file.size / 1024).toFixed(1)} KB</p>
              <button
                onClick={(e) => { e.stopPropagation(); setFile(null); setResult(null) }}
                className="mt-3 text-xs text-red-400 hover:text-red-600 transition-colors"
              >
                파일 제거
              </button>
            </>
          ) : (
            <>
              <UploadIcon />
              <p className="text-sm text-gray-500">파일을 드래그하거나 클릭하여 업로드</p>
              <p className="text-xs text-gray-400 mt-1">지원 형식: hwpx, pdf</p>
            </>
          )}
        </div>
      </div>

      {/* 2. 검수 모드 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Step 2 · 검수 모드 선택</p>
        <div className="grid grid-cols-2 gap-3 mb-4">
          {([
            { key: 'korean' as Mode, label: '국어검수', sub: '오탈자 · 띄어쓰기 · 맞춤법' },
            { key: 'legal'  as Mode, label: '법리검수', sub: '객관식 · OX 문제 오류' },
          ] as const).map(({ key, label, sub }) => (
            <button
              key={key}
              onClick={() => { setMode(key); if (key === 'korean') setSubject('') }}
              className={`py-4 px-5 rounded-xl border-2 text-left transition-all ${
                mode === key
                  ? 'border-[#1a2a4a] bg-[#1a2a4a] text-white'
                  : 'border-gray-200 text-gray-700 hover:border-gray-300'
              }`}
            >
              <p className="font-semibold text-sm">{label}</p>
              <p className={`text-xs mt-0.5 ${mode === key ? 'text-blue-200' : 'text-gray-400'}`}>{sub}</p>
            </button>
          ))}
        </div>

        {mode === 'legal' && (
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">과목 선택</label>
            <select
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-[#1a2a4a] bg-white"
            >
              <option value="">과목을 선택하세요</option>
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* 에러 메시지 */}
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-600 mb-4">
          {error}
        </div>
      )}

      {/* 검수 시작 버튼 */}
      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full py-3.5 rounded-xl text-sm font-semibold text-white bg-[#1a2a4a] hover:bg-[#243558] disabled:opacity-40 disabled:cursor-not-allowed transition-all mb-8 flex items-center justify-center gap-2"
      >
        {loading ? <><Spinner /> 검수 중...</> : '검수 시작'}
      </button>

      {/* 결과 */}
      {result && (
        <div>
          {/* 요약 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">검수 결과 요약</p>
              <button
                onClick={handleDownload}
                className="text-xs text-[#1a2a4a] border border-[#1a2a4a] px-3 py-1.5 rounded-full hover:bg-[#1a2a4a] hover:text-white transition-colors font-medium"
              >
                JSON 다운로드
              </button>
            </div>

            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-4xl font-bold text-[#1a2a4a]">{result.summary.total}</span>
              <span className="text-sm text-gray-500">건의 오류가 발견되었습니다.</span>
            </div>

            <div className="flex flex-wrap gap-2">
              {Object.entries(result.summary.byType).map(([type, count]) =>
                count > 0 ? (
                  <span key={type} className={`text-xs px-3 py-1 rounded-full font-medium ${TYPE_COLORS[type] ?? 'bg-gray-100 text-gray-600'}`}>
                    {type} {count}건
                  </span>
                ) : null
              )}
            </div>
          </div>

          {/* 오류 목록 */}
          {result.errors.length === 0 ? (
            <div className="bg-green-50 border border-green-100 rounded-xl p-10 text-center">
              <svg className="w-10 h-10 text-green-400 mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-semibold text-green-700">오류가 발견되지 않았습니다.</p>
              <p className="text-xs text-green-500 mt-1">원고가 검수 기준을 충족합니다.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {result.errors.map((err) => (
                <div key={err.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-300">#{String(err.id).padStart(2, '0')}</span>
                      <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${TYPE_COLORS[err.type] ?? 'bg-gray-100 text-gray-600'}`}>
                        {err.type}
                      </span>
                      {err.questionNumber && (
                        <span className="text-xs text-gray-500 font-medium">{err.questionNumber}</span>
                      )}
                    </div>
                    {err.location && (
                      <span className="text-xs text-gray-400">{err.location}</span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="bg-red-50 rounded-lg p-3">
                      <p className="text-[10px] text-red-400 font-semibold mb-1.5 uppercase tracking-wide">원본</p>
                      <p className="text-sm text-red-700 font-medium leading-relaxed">{err.original}</p>
                    </div>
                    <div className="bg-green-50 rounded-lg p-3">
                      <p className="text-[10px] text-green-400 font-semibold mb-1.5 uppercase tracking-wide">수정</p>
                      <p className="text-sm text-green-700 font-medium leading-relaxed">{err.corrected}</p>
                    </div>
                  </div>

                  <p className="text-xs text-gray-500 leading-relaxed">{err.explanation}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
