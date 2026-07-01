'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'

type OverallStats = {
  total_sessions: number
  avg_score: number
  stddev_score: number
  median_score: number
  max_score: number
  min_score: number
  total_points: number
}

type QuestionStat = {
  order: number
  points: number
  content: string
  total_answers: number
  correct_count: number
  correct_rate: number | null
}

function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function RateBar({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-gray-300 text-xs">-</span>
  const color = rate >= 70 ? 'bg-green-400' : rate >= 40 ? 'bg-yellow-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${rate}%` }} />
      </div>
      <span className="text-xs text-gray-600 w-10 text-right">{rate}%</span>
    </div>
  )
}

export default function ExamStatsPage() {
  const params = useParams()
  const examId = params.examId as string
  const router = useRouter()
  const { profile, isLoading: authLoading } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [endAt, setEndAt] = useState<string | null>(null)
  const [examTitle, setExamTitle] = useState('')
  const [overall, setOverall] = useState<OverallStats | null>(null)
  const [questions, setQuestions] = useState<QuestionStat[]>([])

  const getToken = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!profile) {
      router.push(`/login?redirect=/exams/${examId}/stats`)
      return
    }

    async function load() {
      const token = await getToken()
      const res = await fetch(`/api/exams/${examId}/stats`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const data = await res.json()

      if (!res.ok) {
        if (res.status === 403) {
          setEndAt(data.end_at ?? null)
          setError(data.error ?? '아직 공개되지 않은 통계입니다.')
        } else {
          setError(data.error ?? '통계를 불러오지 못했습니다.')
        }
        setLoading(false)
        return
      }

      setExamTitle(data.exam?.title ?? '')
      setEndAt(data.exam?.end_at ?? null)
      setOverall(data.overall ?? null)
      setQuestions(data.questions ?? [])
      setLoading(false)
    }

    load().catch(e => {
      setError(e instanceof Error ? e.message : '통계를 불러오지 못했습니다.')
      setLoading(false)
    })
  }, [authLoading, profile, examId, router, getToken])

  if (authLoading || loading) {
    return <div className="flex justify-center items-center h-64"><Spinner className="h-6 w-6 text-gray-400" /></div>
  }

  if (error) {
    return (
      <div className="p-8 max-w-xl">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-8 text-center">
          <div className="text-4xl mb-3">🔒</div>
          <p className="text-gray-700 font-semibold mb-1">통계 비공개</p>
          <p className="text-sm text-gray-500">{error}</p>
          {endAt && (
            <p className="text-xs text-gray-400 mt-2">
              공개 일시: {new Date(endAt).toLocaleString('ko-KR')}
            </p>
          )}
          <a href={`/exams/${examId}/result`} className="mt-4 inline-block text-sm text-[#1a2a4a] underline">
            내 결과 보기
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
          <a href="/exams" className="hover:text-gray-600">모의고사</a>
          <span>›</span>
          <span>{examTitle}</span>
          <span>›</span>
          <span>통계</span>
        </div>
        <h1 className="text-xl font-bold text-[#1a2a4a]">{examTitle} — 전체 통계</h1>
        {endAt && <p className="text-xs text-gray-400 mt-1">응시 기간 종료: {new Date(endAt).toLocaleString('ko-KR')}</p>}
      </div>

      {/* 전체 통계 카드 */}
      {overall ? (
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: '응시자 수', value: `${overall.total_sessions}명` },
            { label: '평균 점수', value: `${overall.avg_score ?? '-'}점` },
            { label: '표준편차', value: `${overall.stddev_score ?? '-'}` },
            { label: '중앙값', value: `${overall.median_score ?? '-'}점` },
            { label: '최고점', value: `${overall.max_score ?? '-'}점` },
            { label: '최저점', value: `${overall.min_score ?? '-'}점` },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-400 mb-1">{label}</p>
              <p className="text-lg font-bold text-[#1a2a4a]">{value}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6 text-center text-sm text-gray-400">
          아직 집계된 응시 데이터가 없습니다.
        </div>
      )}

      {/* 문항별 정답률 */}
      {questions.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-[#1a2a4a] text-sm">문항별 정답률</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500">
                <th className="text-left px-5 py-2.5 font-medium w-12">번호</th>
                <th className="text-left px-3 py-2.5 font-medium">문제</th>
                <th className="text-left px-3 py-2.5 font-medium w-20">응답 수</th>
                <th className="text-left px-3 py-2.5 font-medium w-36">정답률</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {questions.map(q => (
                <tr key={q.order} className="hover:bg-gray-50">
                  <td className="px-5 py-3 text-xs text-gray-400 font-medium">{q.order}</td>
                  <td className="px-3 py-3 text-xs text-gray-700 line-clamp-2 max-w-xs">{q.content}</td>
                  <td className="px-3 py-3 text-xs text-gray-500">{q.total_answers}</td>
                  <td className="px-3 py-3 w-36">
                    <RateBar rate={q.correct_rate} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4">
        <a href={`/exams/${examId}/result`} className="text-sm text-[#1a2a4a] underline">
          ← 내 결과로 돌아가기
        </a>
      </div>
    </div>
  )
}
