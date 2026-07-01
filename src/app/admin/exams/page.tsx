'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
import type { Exam, MaterialCategory } from '@/lib/supabase'

const SUBJECTS: MaterialCategory[] = ['형법', '형사소송법', '교정학', '노동법']

type ParsedQuestion = {
  _id?: string         // 클라이언트 임시 ID
  type: 'MCQ' | 'OX'
  subject: string
  chapter: string | null
  content: string
  option_1: string | null
  option_2: string | null
  option_3: string | null
  option_4: string | null
  answer: string
  explanation: string | null
  source: string | null
  _warning: string | null
}

function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function emptyQuestion(subject: string): ParsedQuestion {
  return {
    _id: Math.random().toString(36).slice(2),
    type: 'MCQ', subject, chapter: null, content: '',
    option_1: null, option_2: null, option_3: null, option_4: null,
    answer: '1', explanation: null, source: null, _warning: null,
  }
}

export default function AdminExamsPage() {
  const { isAdmin, isLoading, profile } = useAuth()
  const router = useRouter()

  // 기존 시험 목록
  const [exams, setExams] = useState<Exam[]>([])
  const [examsLoading, setExamsLoading] = useState(true)

  // 시험 기본정보
  const [title, setTitle]       = useState('')
  const [subject, setSubject]   = useState<MaterialCategory | ''>('')
  const [timeLimit, setTimeLimit] = useState(60)
  const [startAt, setStartAt]   = useState('')
  const [endAt, setEndAt]       = useState('')

  // 문제 파싱
  const [rawText, setRawText]     = useState('')
  const [parseSubject, setParseSubject] = useState<MaterialCategory | ''>('')
  const [parsing, setParsing]     = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [questions, setQuestions] = useState<ParsedQuestion[]>([])

  // 저장
  const [saving, setSaving]       = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const fetchExams = useCallback(async () => {
    setExamsLoading(true)
    const { data } = await supabase
      .from('exams')
      .select('*')
      .order('created_at', { ascending: false })
    setExams(data ?? [])
    setExamsLoading(false)
  }, [])

  useEffect(() => { fetchExams() }, [fetchExams])

  const getToken = async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }

  const handleParse = async () => {
    if (!rawText.trim()) { setParseError('문제 텍스트를 입력해주세요.'); return }
    if (!parseSubject) { setParseError('과목을 선택해주세요.'); return }
    setParsing(true)
    setParseError(null)
    try {
      const token = await getToken()
      const res = await fetch('/api/exams/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ text: rawText, subject: parseSubject }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'AI 변환 실패')
      const parsed: ParsedQuestion[] = (data.questions as ParsedQuestion[]).map(q => ({
        ...q,
        _id: Math.random().toString(36).slice(2),
      }))
      setQuestions(parsed)
      if (!parsed.length) setParseError('문제를 추출하지 못했습니다. 텍스트 형식을 확인해주세요.')
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'AI 변환 중 오류가 발생했습니다.')
    } finally {
      setParsing(false)
    }
  }

  const updateQuestion = (idx: number, field: keyof ParsedQuestion, value: string | null) => {
    setQuestions(prev => prev.map((q, i) => i === idx ? { ...q, [field]: value } : q))
  }

  const removeQuestion = (idx: number) => {
    setQuestions(prev => prev.filter((_, i) => i !== idx))
  }

  const addQuestion = () => {
    setQuestions(prev => [...prev, emptyQuestion(parseSubject || subject || '형법')])
  }

  const handleSave = async () => {
    if (!title.trim()) { setSaveError('시험 제목을 입력해주세요.'); return }
    if (!subject) { setSaveError('과목을 선택해주세요.'); return }
    if (!startAt || !endAt) { setSaveError('응시 기간을 설정해주세요.'); return }
    if (new Date(endAt) <= new Date(startAt)) { setSaveError('종료 일시는 시작 일시 이후여야 합니다.'); return }
    if (!questions.length) { setSaveError('최소 1개 이상의 문제가 필요합니다.'); return }

    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      // 1. quiz_questions bulk insert
      const questionsToInsert = questions.map(q => ({
        type: q.type,
        subject: q.subject,
        chapter: q.chapter,
        content: q.content,
        option_1: q.option_1,
        option_2: q.option_2,
        option_3: q.option_3,
        option_4: q.option_4,
        answer: q.answer,
        explanation: q.explanation,
        source: q.source,
      }))

      const { data: insertedQs, error: qErr } = await supabase
        .from('quiz_questions')
        .insert(questionsToInsert)
        .select('id')

      if (qErr) throw new Error(`문제 저장 실패: ${qErr.message}`)

      // 2. exams insert
      const { data: exam, error: examErr } = await supabase
        .from('exams')
        .insert({
          title: title.trim(),
          subject,
          time_limit_minutes: timeLimit,
          start_at: new Date(startAt).toISOString(),
          end_at: new Date(endAt).toISOString(),
          status: 'draft',
        })
        .select('id')
        .single()

      if (examErr || !exam) throw new Error(`시험 생성 실패: ${examErr?.message}`)

      // 3. exam_questions insert
      const examQs = (insertedQs ?? []).map((q, i) => ({
        exam_id: exam.id,
        question_id: q.id,
        order: i + 1,
        points: 1,
      }))

      const { error: eqErr } = await supabase.from('exam_questions').insert(examQs)
      if (eqErr) throw new Error(`시험-문항 매핑 실패: ${eqErr.message}`)

      setSaveSuccess(true)
      setTitle(''); setSubject(''); setTimeLimit(60); setStartAt(''); setEndAt('')
      setQuestions([]); setRawText('')
      await fetchExams()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : '저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handlePublish = async (examId: string, current: string) => {
    const next = current === 'published' ? 'draft' : 'published'
    const label = next === 'published' ? '공개' : '비공개'
    if (!confirm(`이 시험을 ${label} 상태로 변경하시겠습니까?`)) return
    await supabase.from('exams').update({ status: next as 'draft' | 'published' | 'closed' }).eq('id', examId)
    await fetchExams()
  }

  const handleDeleteExam = async (examId: string, examTitle: string) => {
    if (!confirm(`「${examTitle}」을(를) 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.`)) return
    await supabase.from('exams').delete().eq('id', examId)
    await fetchExams()
  }

  if (isLoading) return <div className="flex justify-center items-center h-64"><Spinner className="h-6 w-6 text-gray-400" /></div>

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-gray-500 font-medium">관리자만 접근할 수 있습니다.</p>
        <button onClick={() => router.push('/login')} className="text-sm text-[#1a2a4a] underline">로그인 페이지로 이동</button>
      </div>
    )
  }

  void profile

  const STATUS_LABEL: Record<string, string> = { draft: '임시저장', published: '공개', closed: '마감' }
  const STATUS_COLOR: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    published: 'bg-green-100 text-green-700',
    closed: 'bg-red-100 text-red-600',
  }

  return (
    <div className="p-8 max-w-5xl">
      {/* 헤더 */}
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
          <a href="/admin" className="hover:text-gray-600">관리자</a>
          <span>›</span>
          <span>모의고사 관리</span>
        </div>
        <h1 className="text-xl font-bold text-[#1a2a4a]">모의고사 관리</h1>
        <p className="text-sm text-gray-500 mt-1">CBT 모의고사를 생성하고 관리합니다.</p>
      </div>

      {/* 기존 시험 목록 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-8">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-[#1a2a4a] text-sm">시험 목록</h2>
          {!examsLoading && <span className="text-xs text-gray-400">{exams.length}개</span>}
        </div>
        {examsLoading ? (
          <div className="flex justify-center py-10"><Spinner className="h-5 w-5 text-gray-400" /></div>
        ) : exams.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">등록된 시험이 없습니다.</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500">
                <th className="text-left px-6 py-2.5 font-medium">제목</th>
                <th className="text-left px-3 py-2.5 font-medium w-20">과목</th>
                <th className="text-left px-3 py-2.5 font-medium w-20">상태</th>
                <th className="text-left px-3 py-2.5 font-medium w-32">응시 기간</th>
                <th className="px-3 py-2.5 w-32"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {exams.map(exam => (
                <tr key={exam.id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 text-sm text-gray-800">{exam.title}</td>
                  <td className="px-3 py-3 text-xs text-gray-500">{exam.subject}</td>
                  <td className="px-3 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[exam.status] ?? ''}`}>
                      {STATUS_LABEL[exam.status] ?? exam.status}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-400">
                    {new Date(exam.start_at).toLocaleDateString('ko-KR')} ~<br/>
                    {new Date(exam.end_at).toLocaleDateString('ko-KR')}
                  </td>
                  <td className="px-3 py-3 text-right flex justify-end gap-2 items-center">
                    <button
                      onClick={() => handlePublish(exam.id, exam.status)}
                      disabled={exam.status === 'closed'}
                      className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 transition-colors"
                    >
                      {exam.status === 'published' ? '비공개' : '공개'}
                    </button>
                    <button
                      onClick={() => handleDeleteExam(exam.id, exam.title)}
                      className="text-xs px-2.5 py-1 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 새 시험 생성 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">새 시험 만들기</p>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="col-span-2">
            <label className="text-xs text-gray-500 mb-1 block">시험 제목</label>
            <input
              type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="예: 2026년 1회 형법 모의고사"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#1a2a4a]"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">과목</label>
            <select
              value={subject} onChange={e => setSubject(e.target.value as MaterialCategory)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:border-[#1a2a4a]"
            >
              <option value="">과목 선택</option>
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">제한시간 (분)</label>
            <input
              type="number" value={timeLimit} min={5} max={300}
              onChange={e => setTimeLimit(Number(e.target.value))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#1a2a4a]"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">응시 시작 일시</label>
            <input
              type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#1a2a4a]"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">응시 종료 일시</label>
            <input
              type="datetime-local" value={endAt} onChange={e => setEndAt(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#1a2a4a]"
            />
          </div>
        </div>

        {/* AI 문제 변환 */}
        <div className="border border-gray-100 rounded-xl p-4 mb-4 bg-gray-50">
          <p className="text-xs font-semibold text-gray-500 mb-3">AI 문제 자동 변환</p>
          <div className="flex gap-2 mb-2">
            <select
              value={parseSubject} onChange={e => setParseSubject(e.target.value as MaterialCategory)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-[#1a2a4a] w-36 shrink-0"
            >
              <option value="">과목 선택</option>
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              onClick={handleParse}
              disabled={parsing || !rawText.trim() || !parseSubject}
              className="px-4 py-2 bg-[#1a2a4a] text-white text-sm rounded-lg hover:bg-[#243558] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 shrink-0"
            >
              {parsing ? <><Spinner /> 변환 중...</> : 'AI로 변환'}
            </button>
          </div>
          <textarea
            value={rawText} onChange={e => setRawText(e.target.value)}
            placeholder="문제/정답/해설이 포함된 텍스트를 붙여넣으세요..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#1a2a4a] bg-white"
            rows={6}
          />
          {parseError && <p className="text-xs text-red-500 mt-1">{parseError}</p>}
        </div>

        {/* 문제 미리보기 */}
        {questions.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500">{questions.length}개 문제</p>
              <button
                onClick={addQuestion}
                className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
              >
                + 문제 추가
              </button>
            </div>
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
              {questions.map((q, idx) => (
                <div
                  key={q._id ?? idx}
                  className={`border rounded-xl p-4 ${q._warning ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <span className="text-xs font-semibold text-gray-400">{idx + 1}번</span>
                    <div className="flex items-center gap-2">
                      <select
                        value={q.type}
                        onChange={e => updateQuestion(idx, 'type', e.target.value)}
                        className="text-xs border border-gray-200 rounded px-2 py-1 bg-white"
                      >
                        <option value="MCQ">객관식</option>
                        <option value="OX">OX</option>
                      </select>
                      <button
                        onClick={() => removeQuestion(idx)}
                        className="text-xs text-red-400 hover:text-red-600 px-2 py-1"
                      >
                        삭제
                      </button>
                    </div>
                  </div>

                  {q._warning && (
                    <p className="text-xs text-red-600 bg-red-100 rounded px-2 py-1 mb-2">
                      ⚠ {q._warning}
                    </p>
                  )}

                  <div className="space-y-2">
                    <div>
                      <label className="text-xs text-gray-400 mb-0.5 block">문제 본문</label>
                      <textarea
                        value={q.content}
                        onChange={e => updateQuestion(idx, 'content', e.target.value)}
                        rows={2}
                        className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-[#1a2a4a]"
                      />
                    </div>
                    {q.type === 'MCQ' && (
                      <div className="grid grid-cols-2 gap-2">
                        {(['option_1', 'option_2', 'option_3', 'option_4'] as const).map((opt, oi) => (
                          <div key={opt}>
                            <label className="text-xs text-gray-400 mb-0.5 block">{oi + 1}번 선지</label>
                            <input
                              type="text"
                              value={q[opt] ?? ''}
                              onChange={e => updateQuestion(idx, opt, e.target.value || null)}
                              className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-[#1a2a4a]"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <div className="w-24">
                        <label className="text-xs text-gray-400 mb-0.5 block">정답</label>
                        {q.type === 'MCQ' ? (
                          <select
                            value={q.answer}
                            onChange={e => updateQuestion(idx, 'answer', e.target.value)}
                            className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs bg-white focus:outline-none"
                          >
                            <option value="1">1번</option>
                            <option value="2">2번</option>
                            <option value="3">3번</option>
                            <option value="4">4번</option>
                          </select>
                        ) : (
                          <select
                            value={q.answer}
                            onChange={e => updateQuestion(idx, 'answer', e.target.value)}
                            className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs bg-white focus:outline-none"
                          >
                            <option value="O">O</option>
                            <option value="X">X</option>
                          </select>
                        )}
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-gray-400 mb-0.5 block">해설</label>
                        <input
                          type="text"
                          value={q.explanation ?? ''}
                          onChange={e => updateQuestion(idx, 'explanation', e.target.value || null)}
                          className="w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-[#1a2a4a]"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {saveError && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 mb-3">{saveError}</p>}
        {saveSuccess && <p className="text-xs text-green-600 bg-green-50 rounded-lg px-3 py-2 mb-3">시험이 저장되었습니다. 시험 목록에서 공개 여부를 설정하세요.</p>}

        <button
          onClick={handleSave}
          disabled={saving || !questions.length}
          className="w-full py-2.5 rounded-xl bg-[#1a2a4a] text-white text-sm font-semibold hover:bg-[#243558] disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {saving ? <><Spinner /> 저장 중...</> : `저장 (문제 ${questions.length}개)`}
        </button>
      </div>
    </div>
  )
}
