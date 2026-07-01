'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'

type ResultItem = {
  order: number
  points: number
  content: string
  type: 'MCQ' | 'OX'
  option_1: string | null
  option_2: string | null
  option_3: string | null
  option_4: string | null
  answer: string
  explanation: string | null
  selected: string | null
  is_correct: boolean
}

function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

export default function ExamResultPage() {
  const params = useParams()
  const examId = params.examId as string
  const router = useRouter()
  const { profile, isLoading: authLoading } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [examTitle, setExamTitle] = useState('')
  const [examEndAt, setExamEndAt] = useState('')
  const [score, setScore] = useState(0)
  const [totalPoints, setTotalPoints] = useState(0)
  const [results, setResults] = useState<ResultItem[]>([])
  const [filter, setFilter] = useState<'all' | 'wrong' | 'unanswered'>('all')

  const getToken = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!profile) {
      router.push(`/login?redirect=/exams/${examId}/result`)
      return
    }

    async function load() {
      // 세션 조회
      const { data: session } = await supabase
        .from('exam_sessions')
        .select('id, status, score, total_points, exam_id')
        .eq('exam_id', examId)
        .eq('user_id', profile!.id)
        .single()

      if (!session || session.status === 'in_progress') {
        // 아직 제출 전이면 응시 페이지로
        router.push(`/exams/${examId}`)
        return
      }

      setScore(session.score ?? 0)
      setTotalPoints(session.total_points ?? 0)

      // 시험 정보
      const { data: exam } = await supabase
        .from('exams')
        .select('title, end_at')
        .eq('id', examId)
        .single()
      setExamTitle(exam?.title ?? '')
      setExamEndAt(exam?.end_at ?? '')

      // 답안 + 문항 정보 조회 (제출 후이므로 answer, explanation 포함)
      const token = await getToken()
      const res = await fetch(`/api/exams/${examId}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })

      // 이미 제출된 경우 submit API가 409를 반환할 수 있으므로
      // 직접 DB에서 조회하는 방식으로 전환
      const { data: eqs } = await supabase
        .from('exam_questions')
        .select('id, order, points, question_id')
        .eq('exam_id', examId)
        .order('order', { ascending: true })

      if (!eqs?.length) { setLoading(false); return }

      const { data: qs } = await supabase
        .from('quiz_questions')
        .select('id, type, content, option_1, option_2, option_3, option_4, answer, explanation')
        .in('id', eqs.map(eq => eq.question_id))

      const qMap = new Map((qs ?? []).map(q => [q.id, q]))

      const { data: savedAnswers } = await supabase
        .from('exam_answers')
        .select('exam_question_id, selected, is_correct')
        .eq('session_id', session.id)

      const ansMap = new Map((savedAnswers ?? []).map(a => [a.exam_question_id, a]))

      const items: ResultItem[] = eqs.map(eq => {
        const q = qMap.get(eq.question_id)
        const a = ansMap.get(eq.id)
        return {
          order: eq.order,
          points: eq.points,
          content: q?.content ?? '',
          type: (q?.type ?? 'MCQ') as 'MCQ' | 'OX',
          option_1: q?.option_1 ?? null,
          option_2: q?.option_2 ?? null,
          option_3: q?.option_3 ?? null,
          option_4: q?.option_4 ?? null,
          answer: q?.answer ?? '',
          explanation: q?.explanation ?? null,
          selected: a?.selected ?? null,
          is_correct: a?.is_correct ?? false,
        }
      })
      setResults(items)
      void res
      setLoading(false)
    }

    load().catch(e => {
      setError(e instanceof Error ? e.message : '결과를 불러오지 못했습니다.')
      setLoading(false)
    })
  }, [authLoading, profile, examId, router, getToken])

  if (authLoading || loading) {
    return <div className="flex justify-center items-center h-64"><Spinner className="h-6 w-6 text-gray-400" /></div>
  }
  if (error) return <p className="text-red-500 text-center p-8">{error}</p>

  const pct = totalPoints > 0 ? Math.round(score / totalPoints * 100) : 0
  const wrongCount = results.filter(r => !r.is_correct).length
  const unansweredCount = results.filter(r => r.selected === null).length

  const filtered = results.filter(r => {
    if (filter === 'wrong') return !r.is_correct
    if (filter === 'unanswered') return r.selected === null
    return true
  })

  return (
    <div className="p-8 max-w-3xl">
      {/* 헤더 */}
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
          <a href="/exams" className="hover:text-gray-600">모의고사</a>
          <span>›</span>
          <span>{examTitle}</span>
          <span>›</span>
          <span>결과</span>
        </div>
        <h1 className="text-xl font-bold text-[#1a2a4a]">{examTitle} — 결과</h1>
      </div>

      {/* 점수 카드 */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
        <div className="flex items-center gap-6">
          <div className="relative w-24 h-24">
            <svg className="w-24 h-24 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#f3f4f6" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="15.9155" fill="none"
                stroke={pct >= 70 ? '#16a34a' : pct >= 50 ? '#d97706' : '#ef4444'}
                strokeWidth="3"
                strokeDasharray={`${pct} ${100 - pct}`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xl font-bold text-[#1a2a4a]">{pct}%</span>
            </div>
          </div>
          <div>
            <p className="text-3xl font-bold text-[#1a2a4a]">{score} <span className="text-base font-normal text-gray-400">/ {totalPoints}점</span></p>
            <div className="flex gap-4 mt-2 text-sm text-gray-500">
              <span>정답 <b className="text-green-600">{results.filter(r => r.is_correct).length}</b>개</span>
              <span>오답 <b className="text-red-500">{wrongCount}</b>개</span>
              {unansweredCount > 0 && <span>미응답 <b className="text-gray-400">{unansweredCount}</b>개</span>}
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <a
            href={new Date(examEndAt) <= new Date() ? `/exams/${examId}/stats` : '#'}
            className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              new Date(examEndAt) <= new Date()
                ? 'border-gray-200 text-gray-600 hover:bg-gray-100'
                : 'border-gray-100 text-gray-300 cursor-not-allowed'
            }`}
          >
            {new Date(examEndAt) <= new Date() ? '전체 통계 보기' : '통계는 기간 종료 후 공개'}
          </a>
        </div>
      </div>

      {/* 오답 필터 */}
      <div className="flex gap-2 mb-4">
        {(['all', 'wrong', 'unanswered'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
              filter === f ? 'bg-[#1a2a4a] text-white' : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            {f === 'all' ? `전체 (${results.length})` : f === 'wrong' ? `오답 (${wrongCount})` : `미응답 (${unansweredCount})`}
          </button>
        ))}
      </div>

      {/* 문항별 결과 */}
      <div className="space-y-3">
        {filtered.map((r, i) => (
          <div
            key={i}
            className={`bg-white rounded-xl border shadow-sm p-5 ${
              r.is_correct ? 'border-gray-100' : 'border-red-100'
            }`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-gray-400">문제 {r.order}</span>
              <span className={`text-xs font-semibold ${r.is_correct ? 'text-green-600' : 'text-red-500'}`}>
                {r.is_correct ? '정답' : r.selected === null ? '미응답' : '오답'}
              </span>
              <span className="ml-auto text-xs text-gray-400">{r.points}점</span>
            </div>
            <p className="text-sm text-gray-800 whitespace-pre-wrap mb-3">{r.content}</p>

            {r.type === 'MCQ' && (
              <div className="space-y-1 mb-3">
                {[r.option_1, r.option_2, r.option_3, r.option_4].map((opt, oi) => {
                  if (!opt) return null
                  const val = String(oi + 1)
                  const isCorrect = r.answer === val
                  const isSelected = r.selected === val
                  return (
                    <div
                      key={oi}
                      className={`text-xs px-3 py-2 rounded-lg ${
                        isCorrect
                          ? 'bg-green-50 text-green-700 font-medium'
                          : isSelected && !isCorrect
                            ? 'bg-red-50 text-red-600'
                            : 'text-gray-600'
                      }`}
                    >
                      {isCorrect ? '✓ ' : isSelected ? '✗ ' : ''}<span className="font-semibold">{oi + 1}.</span> {opt}
                    </div>
                  )
                })}
              </div>
            )}

            {r.type === 'OX' && (
              <div className="flex gap-2 mb-3">
                {['O', 'X'].map(val => (
                  <div
                    key={val}
                    className={`flex-1 py-2 text-center rounded-lg text-sm font-bold ${
                      r.answer === val
                        ? 'bg-green-50 text-green-600'
                        : r.selected === val
                          ? 'bg-red-50 text-red-500'
                          : 'text-gray-300'
                    }`}
                  >
                    {val}
                    {r.answer === val && ' ✓'}
                    {r.selected === val && r.answer !== val && ' ✗'}
                  </div>
                ))}
              </div>
            )}

            {r.explanation && (
              <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 mt-2">
                <span className="font-semibold text-gray-600">해설</span> {r.explanation}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
