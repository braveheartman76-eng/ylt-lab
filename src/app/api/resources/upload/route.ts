import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'
import type { MaterialCategory } from '@/lib/supabase'

const ALLOWED_EXT: Record<string, string> = {
  '.pdf':  'application/pdf',
  '.hwpx': 'application/octet-stream',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

const VALID_CATEGORIES: MaterialCategory[] = ['형법', '형사소송법', '교정학', '노동법']
const MAX_SIZE = 50 * 1024 * 1024

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file     = formData.get('file')     as File   | null
    const title    = (formData.get('title')   as string | null)?.trim()
    const category = formData.get('category') as MaterialCategory | null

    if (!file)                                   return NextResponse.json({ error: '파일이 없습니다.' },              { status: 400 })
    if (!title)                                  return NextResponse.json({ error: '제목을 입력해주세요.' },           { status: 400 })
    if (!category || !VALID_CATEGORIES.includes(category))
                                                 return NextResponse.json({ error: '올바른 카테고리를 선택해주세요.' }, { status: 400 })

    const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0]
    if (!ext || !ALLOWED_EXT[ext])               return NextResponse.json({ error: 'pdf, hwpx, docx 파일만 업로드 가능합니다.' }, { status: 400 })
    if (file.size > MAX_SIZE)                    return NextResponse.json({ error: '파일 크기는 50MB 이하여야 합니다.' }, { status: 400 })

    const buffer   = Buffer.from(await file.arrayBuffer())
    const safeName = file.name.replace(/[^a-zA-Z0-9가-힣._-]/g, '_')
    const path     = `${Date.now()}_${safeName}`

    // Supabase Storage 업로드
    const { error: storageErr } = await supabaseServer.storage
      .from('materials')
      .upload(path, buffer, {
        contentType: ALLOWED_EXT[ext],
        upsert: false,
      })

    if (storageErr) {
      return NextResponse.json({ error: `스토리지 업로드 실패: ${storageErr.message}` }, { status: 500 })
    }

    // Public URL
    const { data: { publicUrl } } = supabaseServer.storage
      .from('materials')
      .getPublicUrl(path)

    // materials 테이블 insert
    const { data: material, error: dbErr } = await supabaseServer
      .from('materials')
      .insert({ title, file_url: publicUrl, category, file_size: file.size })
      .select()
      .single()

    if (dbErr) {
      return NextResponse.json({ error: `DB 저장 실패: ${dbErr.message}` }, { status: 500 })
    }

    return NextResponse.json({ material })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '알 수 없는 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
