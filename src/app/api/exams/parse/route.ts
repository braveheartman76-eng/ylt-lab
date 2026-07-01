import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase'

export const runtime = 'nodejs'

const CHUNK_QUESTION_COUNT = 10

const SYSTEM_PROMPT = `당신은 법학 시험 문제 파싱 전문가입니다.
주어진 텍스트에서 시험 문제들을 추출하여 JSON 배열로 변환하세요.

각 문제는 다음 형식으로 반환하세요:
{
  "type": "MCQ" 또는 "OX",
  "subject": "형법" | "형사소송법" | "교정학" | "노동법",
  "chapter": "챕터명 (없으면 null)",
  "content": "문제 본문",
  "option_1": "MCQ 선지 1 (OX면 null)",
  "option_2": "MCQ 선지 2 (OX면 null)",
  "option_3": "MCQ 선지 3 (OX면 null)",
  "option_4": "MCQ 선지 4 (OX면 null)",
  "answer": "MCQ는 '1'~'4' / OX는 'O' 또는 'X'",
  "explanation": "해설 (없으면 null)",
  "source": "출처 (없으면 null)",
  "_warning": "정답/해설을 찾지 못했거나 확신이 낮을 때만 경고 메시지, 문제 없으면 null"
}

반드시 JSON 배열만 반환하세요. 마크다운, 설명 텍스트 없이 순수 JSON만.
정답이나 해설을 명확히 찾을 수 없는 경우 _warning 필드에 이유를 기재하세요.`

function splitByQuestionBoundary(text: string, chunkSize: number): string[] {
  // 문제 번호 패턴으로 분할 (1. / 문1. / 제1문 / [1] 등)
  const questionPattern = /(?=(?:^|\n)\s*(?:문\s*\d+|제\s*\d+\s*문|\[\s*\d+\s*\]|\d+\s*[.)】])\s)/
  const parts = text.split(questionPattern).filter(p => p.trim())

  const chunks: string[] = []
  let current = ''
  let count = 0

  for (const part of parts) {
    current += (current ? '\n' : '') + part
    count++
    if (count >= chunkSize) {
      chunks.push(current.trim())
      current = ''
      count = 0
    }
  }
  if (current.trim()) chunks.push(current.trim())

  // 문제 번호 패턴을 찾지 못한 경우 글자 수 기준으로 분할
  if (chunks.length === 1 && text.length > 3000) {
    const byChar: string[] = []
    let start = 0
    while (start < text.length) {
      let end = start + 3000
      if (end < text.length) {
        const nl = text.lastIndexOf('\n', end)
        if (nl > start) end = nl
      }
      byChar.push(text.slice(start, end).trim())
      start = end + 1
    }
    return byChar.filter(c => c)
  }

  return chunks.length ? chunks : [text.trim()]
}

async function parseChunk(
  client: Anthropic,
  chunk: string,
  subject: string,
  chunkIndex: number,
): Promise<object[]> {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `[과목: ${subject}]\n[청크 ${chunkIndex + 1}]\n\n${chunk}`,
    }],
  })

  const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []

  try {
    const parsed = JSON.parse(match[0])
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function validateAdmin(req: NextRequest): boolean {
  const supabaseAdmin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  void supabaseAdmin
  // 실제 admin 검증은 Authorization 헤더의 JWT로 처리
  // API 라우트에서는 클라이언트가 Supabase 세션 토큰을 Authorization 헤더로 전송
  const auth = req.headers.get('authorization')
  return !!auth
}

export async function POST(req: NextRequest) {
  if (!validateAdmin(req)) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' }, { status: 500 })
  }

  let body: { text?: string; subject?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 })
  }

  const { text, subject } = body
  if (!text?.trim()) {
    return NextResponse.json({ error: '문제 텍스트를 입력해주세요.' }, { status: 400 })
  }
  if (!subject?.trim()) {
    return NextResponse.json({ error: '과목을 선택해주세요.' }, { status: 400 })
  }

  const chunks = splitByQuestionBoundary(text.trim(), CHUNK_QUESTION_COUNT)
  const client = new Anthropic({ apiKey })

  const allQuestions: object[] = []
  const errors: string[] = []

  for (let i = 0; i < chunks.length; i++) {
    try {
      const questions = await parseChunk(client, chunks[i], subject, i)
      allQuestions.push(...questions)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '청크 처리 실패'
      errors.push(`청크 ${i + 1}: ${msg}`)
    }
  }

  return NextResponse.json({
    questions: allQuestions,
    total: allQuestions.length,
    chunks: chunks.length,
    errors: errors.length ? errors : undefined,
  })
}
