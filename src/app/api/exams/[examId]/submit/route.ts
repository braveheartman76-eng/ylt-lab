import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase'

export const runtime = 'nodejs'

function makeServerClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

async function getUserId(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const anonClient = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  const { data: { user } } = await anonClient.auth.getUser(token)
  return user?.id ?? null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ examId: string }> },
) {
  const { examId } = await params
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const db = makeServerClient()

  // 세션 조회
  const { data: session, error: sessionErr } = await db
    .from('exam_sessions')
    .select('id, status, started_at, exam_id')
    .eq('exam_id', examId)
    .eq('user_id', userId)
    .single()

  if (sessionErr || !session) {
    return NextResponse.json({ error: '응시 세션이 없습니다.' }, { status: 404 })
  }
  if (session.status !== 'in_progress') {
    return NextResponse.json({ error: '이미 제출되었거나 만료된 세션입니다.' }, { status: 409 })
  }

  // 시험 정보 조회
  const { data: exam } = await db
    .from('exams')
    .select('time_limit_minutes')
    .eq('id', examId)
    .single()

  if (!exam) {
    return NextResponse.json({ error: '시험을 찾을 수 없습니다.' }, { status: 404 })
  }

  const now = new Date()
  const elapsedSeconds = Math.floor((now.getTime() - new Date(session.started_at).getTime()) / 1000)
  const totalSeconds = exam.time_limit_minutes * 60

  const isExpired = elapsedSeconds > totalSeconds + 30 // 30초 여유

  // 시험 문항 조회
  const { data: eqs } = await db
    .from('exam_questions')
    .select('id, question_id, points, order')
    .eq('exam_id', examId)

  if (!eqs?.length) {
    return NextResponse.json({ error: '시험 문항이 없습니다.' }, { status: 400 })
  }

  // 답안 조회 (이미 저장된 것들)
  const { data: savedAnswers } = await db
    .from('exam_answers')
    .select('exam_question_id, selected')
    .eq('session_id', session.id)

  const answerMap = new Map((savedAnswers ?? []).map(a => [a.exam_question_id, a.selected]))

  // 정답 조회
  const { data: questions } = await db
    .from('quiz_questions')
    .select('id, answer')
    .in('id', eqs.map(eq => eq.question_id))

  const correctMap = new Map((questions ?? []).map(q => [q.id, q.answer]))

  // 채점
  let score = 0
  let totalPoints = 0
  const answerUpdates: Array<{
    exam_question_id: string
    is_correct: boolean
    selected: string | null
  }> = []

  for (const eq of eqs) {
    totalPoints += eq.points
    const selected = answerMap.get(eq.id) ?? null
    const correct = correctMap.get(eq.question_id)
    const isCorrect = selected !== null && selected === correct
    if (isCorrect) score += eq.points
    answerUpdates.push({ exam_question_id: eq.id, is_correct: isCorrect, selected })
  }

  // 답안 is_correct 업데이트 (upsert)
  for (const u of answerUpdates) {
    if (u.selected !== null) {
      await db
        .from('exam_answers')
        .update({ is_correct: u.is_correct })
        .eq('session_id', session.id)
        .eq('exam_question_id', u.exam_question_id)
    }
  }

  // 세션 완료 처리
  const finalStatus = isExpired ? 'expired' : 'submitted'
  await db
    .from('exam_sessions')
    .update({
      status: finalStatus,
      submitted_at: now.toISOString(),
      score,
      total_points: totalPoints,
    })
    .eq('id', session.id)

  // 결과 데이터 구성 (answer, explanation 포함해서 반환 — 제출 후이므로 OK)
  const { data: fullQuestions } = await db
    .from('quiz_questions')
    .select('id, content, option_1, option_2, option_3, option_4, answer, explanation, type')
    .in('id', eqs.map(eq => eq.question_id))

  const questionDetailMap = new Map((fullQuestions ?? []).map(q => [q.id, q]))

  const results = eqs
    .sort((a, b) => a.order - b.order)
    .map(eq => {
      const q = questionDetailMap.get(eq.question_id)
      const selected = answerMap.get(eq.id) ?? null
      return {
        order: eq.order,
        points: eq.points,
        content: q?.content,
        type: q?.type,
        option_1: q?.option_1,
        option_2: q?.option_2,
        option_3: q?.option_3,
        option_4: q?.option_4,
        answer: q?.answer,
        explanation: q?.explanation,
        selected,
        is_correct: selected !== null && selected === q?.answer,
      }
    })

  return NextResponse.json({
    session_id: session.id,
    status: finalStatus,
    score,
    total_points: totalPoints,
    results,
  })
}
