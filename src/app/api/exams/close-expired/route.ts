import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase'

export const runtime = 'nodejs'

// Vercel Cron 또는 CRON_SECRET으로 보호
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    return auth === `Bearer ${secret}`
  }
  // 개발환경 fallback: 서비스롤 키 헤더로 접근 가능
  return req.headers.get('x-cron-key') === process.env.SUPABASE_SERVICE_ROLE_KEY
}

function makeServerClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = makeServerClient()
  const now = new Date().toISOString()

  // end_at이 지난 published 시험 ID 목록
  const { data: closedExams } = await db
    .from('exams')
    .select('id, time_limit_minutes')
    .eq('status', 'published')
    .lt('end_at', now)

  if (!closedExams?.length) {
    return NextResponse.json({ processed: 0, message: '처리할 시험 없음' })
  }

  let totalExpired = 0

  for (const exam of closedExams) {
    // in_progress 세션 조회
    const { data: sessions } = await db
      .from('exam_sessions')
      .select('id')
      .eq('exam_id', exam.id)
      .eq('status', 'in_progress')

    if (!sessions?.length) {
      await db.from('exams').update({ status: 'closed' }).eq('id', exam.id)
      continue
    }

    // 시험 문항 조회
    const { data: eqs } = await db
      .from('exam_questions')
      .select('id, question_id, points')
      .eq('exam_id', exam.id)

    const questionIds = (eqs ?? []).map(eq => eq.question_id)
    const { data: questions } = await db
      .from('quiz_questions')
      .select('id, answer')
      .in('id', questionIds)

    const correctMap = new Map((questions ?? []).map(q => [q.id, q.answer]))
    const totalPoints = (eqs ?? []).reduce((sum, eq) => sum + eq.points, 0)

    for (const session of sessions) {
      const { data: answers } = await db
        .from('exam_answers')
        .select('exam_question_id, selected')
        .eq('session_id', session.id)

      const answerMap = new Map((answers ?? []).map(a => [a.exam_question_id, a.selected]))

      let score = 0
      for (const eq of eqs ?? []) {
        const selected = answerMap.get(eq.id)
        const correct = correctMap.get(eq.question_id)
        const isCorrect = selected !== undefined && selected !== null && selected === correct
        if (isCorrect) score += eq.points

        if (selected !== undefined && selected !== null) {
          await db
            .from('exam_answers')
            .update({ is_correct: isCorrect })
            .eq('session_id', session.id)
            .eq('exam_question_id', eq.id)
        }
      }

      await db
        .from('exam_sessions')
        .update({
          status: 'expired',
          submitted_at: now,
          score,
          total_points: totalPoints,
        })
        .eq('id', session.id)

      totalExpired++
    }

    // 시험 상태를 closed로
    await db.from('exams').update({ status: 'closed' }).eq('id', exam.id)
  }

  return NextResponse.json({
    processed: closedExams.length,
    expired_sessions: totalExpired,
    message: `${closedExams.length}개 시험, ${totalExpired}개 세션 마감 처리 완료`,
  })
}
