'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'

type QuestionItem = {
  exam_question_id: string
  order: number
  points: number
  type: 'MCQ' | 'OX'
  content: string
  option_1: string | null
  option_2: string | null
  option_3: string | null
  option_4: string | null
}

type ExamInfo = {
  id: string
  title: string
  subject: string
  time_limit_minutes: number
  start_at: string
  end_at: string
}

function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}

export default function ExamPage() {
  const params = useParams()
  const examId = params.examId as string
  const router = useRouter()
  const { profile, isLoading: authLoading } = useAuth()

  const [exam, setExam] = useState<ExamInfo | null>(null)
  const [questions, setQuestions] = useState<QuestionItem[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const [currentIdx, setCurrentIdx] = useState(0)
  const [phase, setPhase] = useState<'loading' | 'phone' | 'exam' | 'submitting' | 'done'>('loading')
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const getToken = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }, [])

  const authFetch = useCallback(async (url: string, options: RequestInit = {}) => {
    const token = await getToken()
    return fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
    })
  }, [getToken])

  // 시험 기본정보 로드
  useEffect(() => {
    async function loadExam() {
      const { data } = await supabase
        .from('exams')
        .select('id, title, subject, time_limit_minutes, start_at, end_at')
        .eq('id', examId)
        .single()
      if (data) setExam(data as ExamInfo)
    }
    loadExam()
  }, [examId])

  // 인증 체크
  useEffect(() => {
    if (authLoading) return
    if (!profile) {
      router.push(`/login?redirect=/exams/${examId}`)
    }
  }, [authLoading, profile, router, examId])

  // 기존 세션 확인
  useEffect(() => {
    if (!profile || !exam) return
    async function checkSession() {
      const res = await authFetch(`/api/exams/${examId}/start`, {
        method: 'POST',
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        setPhase('phone')
        return
      }
      const data = await res.json()
      if (data.already_submitted) {
        router.push(`/exams/${examId}/result`)
        return
      }
      if (data.session_id && data.status === 'in_progress') {
        setSessionId(data.session_id)
        setRemainingSeconds(data.remaining_seconds ?? (exam?.time_limit_minutes ?? 60) * 60)
        await loadQuestionsAndAnswers(data.session_id)
        setPhase('exam')
      } else {
        setPhase('phone')
      }
    }

    async function loadQuestionsAndAnswers(sid: string) {
      // 문항 조회 (answer, explanation 제외)
      const { data: eqs } = await supabase
        .from('exam_questions')
        .select('id, order, points, question_id')
        .eq('exam_id', examId)
        .order('order', { ascending: true })

      if (!eqs?.length) return

      const { data: qs } = await supabase
        .from('quiz_questions')
        .select('id, type, content, option_1, option_2, option_3, option_4')
        .in('id', eqs.map(eq => eq.question_id))

      const qMap = new Map((qs ?? []).map(q => [q.id, q]))
      const items: QuestionItem[] = eqs.map(eq => {
        const q = qMap.get(eq.question_id)
        return {
          exam_question_id: eq.id,
          order: eq.order,
          points: eq.points,
          type: (q?.type ?? 'MCQ') as 'MCQ' | 'OX',
          content: q?.content ?? '',
          option_1: q?.option_1 ?? null,
          option_2: q?.option_2 ?? null,
          option_3: q?.option_3 ?? null,
          option_4: q?.option_4 ?? null,
        }
      })
      setQuestions(items)

      // 저장된 답안 불러오기
      const { data: savedAnswers } = await supabase
        .from('exam_answers')
        .select('exam_question_id, selected')
        .eq('session_id', sid)

      const ansMap: Record<string, string> = {}
      for (const a of savedAnswers ?? []) {
        if (a.selected) ansMap[a.exam_question_id] = a.selected
      }
      setAnswers(ansMap)
    }

    checkSession()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, exam, examId])

  // 타이머
  useEffect(() => {
    if (phase !== 'exam') return
    timerRef.current = setInterval(() => {
      setRemainingSeconds(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!)
          handleSubmit(true)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const handleStart = async () => {
    const digits = phone.replace(/\D/g, '')
    if (!/^01[016789]\d{7,8}$/.test(digits)) {
      setPhoneError('올바른 휴대폰번호를 입력해주세요.')
      return
    }
    setPhoneError(null)
    setStartError(null)

    const res = await authFetch(`/api/exams/${examId}/start`, {
      method: 'POST',
      body: JSON.stringify({ phone_number: digits }),
    })
    const data = await res.json()

    if (!res.ok) {
      setStartError(data.error ?? '응시 시작에 실패했습니다.')
      return
    }

    setSessionId(data.session_id)
    setRemainingSeconds(data.remaining_seconds ?? (exam?.time_limit_minutes ?? 60) * 60)

    // 문항 로드
    const { data: eqs } = await supabase
      .from('exam_questions')
      .select('id, order, points, question_id')
      .eq('exam_id', examId)
      .order('order', { ascending: true })

    if (!eqs?.length) { setStartError('시험 문항이 없습니다.'); return }

    const { data: qs } = await supabase
      .from('quiz_questions')
      .select('id, type, content, option_1, option_2, option_3, option_4')
      .in('id', eqs.map(eq => eq.question_id))

    const qMap = new Map((qs ?? []).map(q => [q.id, q]))
    const items: QuestionItem[] = eqs.map(eq => {
      const q = qMap.get(eq.question_id)
      return {
        exam_question_id: eq.id,
        order: eq.order,
        points: eq.points,
        type: (q?.type ?? 'MCQ') as 'MCQ' | 'OX',
        content: q?.content ?? '',
        option_1: q?.option_1 ?? null,
        option_2: q?.option_2 ?? null,
        option_3: q?.option_3 ?? null,
        option_4: q?.option_4 ?? null,
      }
    })
    setQuestions(items)
    setPhase('exam')
  }

  const saveAnswer = useCallback(async (eqId: string, selected: string, sid: string) => {
    await supabase
      .from('exam_answers')
      .upsert(
        { session_id: sid, exam_question_id: eqId, selected, updated_at: new Date().toISOString() },
        { onConflict: 'session_id,exam_question_id' },
      )
  }, [])

  const handleAnswer = (eqId: string, value: string) => {
    setAnswers(prev => ({ ...prev, [eqId]: value }))
    if (!sessionId) return

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      saveAnswer(eqId, value, sessionId)
    }, 600)
  }

  const handleSubmit = useCallback(async (forced = false) => {
    if (phase === 'submitting' || phase === 'done') return
    if (!forced && !confirm('제출하시겠습니까? 제출 후에는 수정할 수 없습니다.')) return

    setPhase('submitting')
    if (timerRef.current) clearInterval(timerRef.current)

    const res = await authFetch(`/api/exams/${examId}/submit`, {
      method: 'POST',
    })
    if (!res.ok) {
      const data = await res.json()
      setSubmitError(data.error ?? '제출에 실패했습니다.')
      setPhase('exam')
      return
    }

    router.push(`/exams/${examId}/result`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, examId, authFetch, router])

  if (authLoading || phase === 'loading') {
    return <div className="flex justify-center items-center h-64"><Spinner className="h-6 w-6 text-gray-400" /></div>
  }

  // 휴대폰번호 입력 단계
  if (phase === 'phone') {
    return (
      <div className="p-8 max-w-md mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-[#1a2a4a]">{exam?.title ?? '모의고사'}</h1>
          <p className="text-sm text-gray-500 mt-1">{exam?.subject} · {exam?.time_limit_minutes}분</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <p className="text-sm font-semibold text-[#1a2a4a] mb-4">응시 전 본인 확인</p>
          <p className="text-xs text-gray-500 mb-4">
            1계정 · 1번호 각 1회만 응시할 수 있습니다. 응시 후에는 취소할 수 없습니다.
          </p>
          <label className="text-xs text-gray-500 mb-1 block">휴대폰번호</label>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(formatPhone(e.target.value))}
            placeholder="010-0000-0000"
            maxLength={13}
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#1a2a4a] mb-1"
          />
          {phoneError && <p className="text-xs text-red-500 mb-2">{phoneError}</p>}
          {startError && <p className="text-xs text-red-500 mb-2">{startError}</p>}
          <button
            onClick={handleStart}
            className="w-full mt-3 py-2.5 rounded-xl bg-[#1a2a4a] text-white text-sm font-semibold hover:bg-[#243558] transition-colors"
          >
            응시 시작
          </button>
        </div>
      </div>
    )
  }

  // 응시 단계
  const current = questions[currentIdx]
  const answered = Object.keys(answers).length
  const isTimeWarning = remainingSeconds <= 300

  return (
    <div className="p-4 max-w-3xl">
      {/* 상단 타이머 / 진행 */}
      <div className="flex items-center justify-between mb-4 bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-3">
        <div>
          <p className="text-xs text-gray-400">{exam?.title}</p>
          <p className="text-sm text-gray-600">{answered}/{questions.length}문제 답안 작성</p>
        </div>
        <div className="flex items-center gap-3">
          <div className={`font-mono text-lg font-bold ${isTimeWarning ? 'text-red-500' : 'text-[#1a2a4a]'}`}>
            {formatTime(remainingSeconds)}
          </div>
          <button
            onClick={() => handleSubmit(false)}
            disabled={phase === 'submitting'}
            className="px-4 py-2 rounded-lg bg-[#1a2a4a] text-white text-sm font-semibold hover:bg-[#243558] disabled:opacity-50 flex items-center gap-2"
          >
            {phase === 'submitting' ? <Spinner /> : '제출'}
          </button>
        </div>
      </div>

      {submitError && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 mb-3">{submitError}</p>}

      <div className="flex gap-4">
        {/* 문항 네비게이션 */}
        <div className="hidden sm:block w-28 shrink-0">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3">
            <p className="text-xs text-gray-400 mb-2 text-center">문항</p>
            <div className="grid grid-cols-4 gap-1">
              {questions.map((q, i) => (
                <button
                  key={q.exam_question_id}
                  onClick={() => setCurrentIdx(i)}
                  className={`aspect-square text-xs rounded font-medium transition-colors ${
                    i === currentIdx
                      ? 'bg-[#1a2a4a] text-white'
                      : answers[q.exam_question_id]
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 문제 본문 */}
        {current && (
          <div className="flex-1 bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-gray-400">문제 {current.order}</span>
              <span className="text-xs text-gray-300">·</span>
              <span className="text-xs text-gray-400">{current.points}점</span>
              {answers[current.exam_question_id] && (
                <span className="ml-auto text-xs text-blue-500 font-medium">답안 저장됨</span>
              )}
            </div>
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap mb-5">{current.content}</p>

            {current.type === 'MCQ' && (
              <div className="space-y-2">
                {[current.option_1, current.option_2, current.option_3, current.option_4].map((opt, i) => {
                  if (!opt) return null
                  const val = String(i + 1)
                  const selected = answers[current.exam_question_id] === val
                  return (
                    <button
                      key={i}
                      onClick={() => handleAnswer(current.exam_question_id, val)}
                      className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-all ${
                        selected
                          ? 'border-[#1a2a4a] bg-[#f0f3f8] text-[#1a2a4a] font-medium'
                          : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <span className="font-semibold mr-2">{i + 1}.</span>{opt}
                    </button>
                  )
                })}
              </div>
            )}

            {current.type === 'OX' && (
              <div className="flex gap-3">
                {['O', 'X'].map(val => {
                  const selected = answers[current.exam_question_id] === val
                  return (
                    <button
                      key={val}
                      onClick={() => handleAnswer(current.exam_question_id, val)}
                      className={`flex-1 py-4 rounded-xl border-2 text-2xl font-bold transition-all ${
                        selected
                          ? val === 'O'
                            ? 'border-green-500 bg-green-50 text-green-600'
                            : 'border-red-500 bg-red-50 text-red-500'
                          : 'border-gray-200 text-gray-400 hover:border-gray-300'
                      }`}
                    >
                      {val}
                    </button>
                  )
                })}
              </div>
            )}

            {/* 이전/다음 */}
            <div className="flex justify-between mt-5 pt-4 border-t border-gray-100">
              <button
                onClick={() => setCurrentIdx(i => Math.max(0, i - 1))}
                disabled={currentIdx === 0}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-30 transition-colors"
              >
                이전
              </button>
              <span className="text-xs text-gray-400 self-center">{currentIdx + 1} / {questions.length}</span>
              <button
                onClick={() => setCurrentIdx(i => Math.min(questions.length - 1, i + 1))}
                disabled={currentIdx === questions.length - 1}
                className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-30 transition-colors"
              >
                다음
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
