'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import type { Exam } from '@/lib/supabase'

function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function ExamCard({ exam }: { exam: Exam }) {
  const now = new Date()
  const startAt = new Date(exam.start_at)
  const endAt = new Date(exam.end_at)

  let periodLabel = ''
  let periodColor = 'text-gray-500'
  if (now < startAt) {
    periodLabel = `${startAt.toLocaleDateString('ko-KR')} 시작 예정`
    periodColor = 'text-blue-500'
  } else if (now > endAt) {
    periodLabel = '응시 기간 종료'
    periodColor = 'text-gray-400'
  } else {
    const remaining = Math.ceil((endAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    periodLabel = `${endAt.toLocaleDateString('ko-KR')} 종료 · 잔여 ${remaining}일`
    periodColor = 'text-green-600'
  }

  const canApply = now >= startAt && now <= endAt

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-xs text-gray-400 font-medium">{exam.subject}</span>
          <h3 className="font-semibold text-[#1a2a4a] mt-0.5">{exam.title}</h3>
        </div>
        <span className="shrink-0 text-xs bg-blue-50 text-blue-700 rounded-full px-2.5 py-1 font-medium">
          {exam.time_limit_minutes}분
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-xs">
        <span className={`font-medium ${periodColor}`}>{periodLabel}</span>
      </div>
      <a
        href={`/exams/${exam.id}`}
        className={`w-full text-center py-2.5 rounded-xl text-sm font-semibold transition-colors ${
          canApply
            ? 'bg-[#1a2a4a] text-white hover:bg-[#243558]'
            : 'bg-gray-100 text-gray-400 pointer-events-none'
        }`}
      >
        {now < startAt ? '응시 예정' : now > endAt ? '기간 종료' : '응시하기'}
      </a>
    </div>
  )
}

export default function ExamsPage() {
  const [exams, setExams] = useState<Exam[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('exams')
        .select('*')
        .eq('status', 'published')
        .order('start_at', { ascending: false })

      if (error) {
        setError('시험 목록을 불러오지 못했습니다.')
      } else {
        setExams(data ?? [])
      }
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[#1a2a4a]">CBT 모의고사</h1>
        <p className="text-sm text-gray-500 mt-1">응시 가능한 모의고사 목록입니다.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-gray-400" />
        </div>
      ) : error ? (
        <p className="text-sm text-red-500 text-center py-16">{error}</p>
      ) : exams.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-400 text-sm">현재 응시 가능한 모의고사가 없습니다.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {exams.map(exam => <ExamCard key={exam.id} exam={exam} />)}
        </div>
      )}
    </div>
  )
}
