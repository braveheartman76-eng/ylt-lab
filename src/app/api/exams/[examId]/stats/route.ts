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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ examId: string }> },
) {
  const { examId } = await params
  const userId = await getUserId(req)
  if (!userId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const db = makeServerClient()

  // 시험 end_at 확인
  const { data: exam } = await db
    .from('exams')
    .select('id, title, subject, end_at')
    .eq('id', examId)
    .single()

  if (!exam) {
    return NextResponse.json({ error: '시험을 찾을 수 없습니다.' }, { status: 404 })
  }

  if (new Date(exam.end_at) > new Date()) {
    return NextResponse.json(
      { error: '통계는 응시 기간 종료 후 공개됩니다.', end_at: exam.end_at },
      { status: 403 },
    )
  }

  // 전체 통계 뷰 조회 (exam_statistics 뷰 사용)
  const { data: stats } = await db
    .rpc('get_exam_statistics' as never, { p_exam_id: examId } as never)
    .single()

  // 뷰에서 직접 조회 (RPC 대신 raw SQL은 뷰 조회로)
  const { data: overallStats } = await db
    .from('exam_statistics' as never)
    .select('*')
    .eq('exam_id', examId)
    .single() as { data: Record<string, unknown> | null }

  const { data: questionStats } = await db
    .from('exam_question_statistics' as never)
    .select('*')
    .eq('exam_id', examId)
    .order('order' as never, { ascending: true }) as { data: Record<string, unknown>[] | null }

  void stats

  return NextResponse.json({
    exam: { id: exam.id, title: exam.title, subject: exam.subject, end_at: exam.end_at },
    overall: overallStats ?? null,
    questions: questionStats ?? [],
  })
}
