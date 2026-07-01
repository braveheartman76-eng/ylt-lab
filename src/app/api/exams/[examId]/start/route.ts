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

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
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

  // 시험 조회
  const { data: exam, error: examErr } = await db
    .from('exams')
    .select('id, title, time_limit_minutes, start_at, end_at, status')
    .eq('id', examId)
    .single()

  if (examErr || !exam) {
    return NextResponse.json({ error: '시험을 찾을 수 없습니다.' }, { status: 404 })
  }
  if (exam.status !== 'published') {
    return NextResponse.json({ error: '응시할 수 없는 시험입니다.' }, { status: 403 })
  }

  const now = new Date()
  const startAt = new Date(exam.start_at)
  const endAt = new Date(exam.end_at)

  if (now < startAt) {
    return NextResponse.json({ error: '아직 응시 기간이 아닙니다.' }, { status: 403 })
  }
  if (now > endAt) {
    return NextResponse.json({ error: '응시 기간이 종료되었습니다.' }, { status: 403 })
  }

  // 기존 세션 확인
  const { data: existing } = await db
    .from('exam_sessions')
    .select('id, status, started_at, score, total_points')
    .eq('exam_id', examId)
    .eq('user_id', userId)
    .single()

  if (existing) {
    if (existing.status !== 'in_progress') {
      return NextResponse.json({
        session_id: existing.id,
        status: existing.status,
        score: existing.score,
        total_points: existing.total_points,
        already_submitted: true,
      })
    }

    // in_progress 세션 — 남은 시간 계산
    const elapsedSeconds = Math.floor((now.getTime() - new Date(existing.started_at).getTime()) / 1000)
    const totalSeconds = exam.time_limit_minutes * 60
    const remainingSeconds = totalSeconds - elapsedSeconds

    if (remainingSeconds <= 0) {
      // 시간 초과 → 자동 채점 후 expired 처리
      await expireSession(db, existing.id, examId)
      return NextResponse.json({
        session_id: existing.id,
        status: 'expired',
        remaining_seconds: 0,
        already_submitted: true,
      })
    }

    return NextResponse.json({
      session_id: existing.id,
      status: 'in_progress',
      remaining_seconds: remainingSeconds,
      started_at: existing.started_at,
    })
  }

  // 신규 세션 시작
  let body: { phone_number?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  const raw = body.phone_number ?? ''
  const phone = normalizePhone(raw)
  if (!/^01[016789]\d{7,8}$/.test(phone)) {
    return NextResponse.json({ error: '올바른 휴대폰번호를 입력해주세요. (010-XXXX-XXXX 형식)' }, { status: 400 })
  }

  const { data: newSession, error: insertErr } = await db
    .from('exam_sessions')
    .insert({
      exam_id: examId,
      user_id: userId,
      phone_number: phone,
      status: 'in_progress',
    })
    .select('id, started_at')
    .single()

  if (insertErr) {
    if (insertErr.code === '23505') {
      if (insertErr.message.includes('phone_number')) {
        return NextResponse.json(
          { error: '이미 다른 계정으로 응시한 휴대폰번호입니다.' },
          { status: 409 },
        )
      }
      return NextResponse.json(
        { error: '이미 응시한 시험입니다.' },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: '세션 생성에 실패했습니다.' }, { status: 500 })
  }

  return NextResponse.json({
    session_id: newSession!.id,
    status: 'in_progress',
    remaining_seconds: exam.time_limit_minutes * 60,
    started_at: newSession!.started_at,
  })
}

async function expireSession(
  db: ReturnType<typeof makeServerClient>,
  sessionId: string,
  examId: string,
) {
  // 현재까지의 답안으로 채점
  const { data: eqs } = await db
    .from('exam_questions')
    .select('id, question_id, points')
    .eq('exam_id', examId)

  if (!eqs?.length) {
    await db
      .from('exam_sessions')
      .update({ status: 'expired', submitted_at: new Date().toISOString(), score: 0, total_points: 0 })
      .eq('id', sessionId)
    return
  }

  const { data: answers } = await db
    .from('exam_answers')
    .select('exam_question_id, selected')
    .eq('session_id', sessionId)

  const answerMap = new Map((answers ?? []).map(a => [a.exam_question_id, a.selected]))

  const { data: questions } = await db
    .from('quiz_questions')
    .select('id, answer')
    .in('id', eqs.map(eq => eq.question_id))

  const correctMap = new Map((questions ?? []).map(q => [q.id, q.answer]))

  let score = 0
  let totalPoints = 0
  const updates: { exam_question_id: string; is_correct: boolean }[] = []

  for (const eq of eqs) {
    totalPoints += eq.points
    const selected = answerMap.get(eq.id)
    const correct = correctMap.get(eq.question_id)
    const isCorrect = selected !== undefined && selected !== null && selected === correct
    if (isCorrect) score += eq.points
    if (selected !== undefined) {
      updates.push({ exam_question_id: eq.id, is_correct: isCorrect })
    }
  }

  // 답안 is_correct 업데이트
  for (const u of updates) {
    await db
      .from('exam_answers')
      .update({ is_correct: u.is_correct })
      .eq('session_id', sessionId)
      .eq('exam_question_id', u.exam_question_id)
  }

  await db
    .from('exam_sessions')
    .update({
      status: 'expired',
      submitted_at: new Date().toISOString(),
      score,
      total_points: totalPoints,
    })
    .eq('id', sessionId)
}
