import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params

    const { data: material, error: fetchErr } = await supabaseServer
      .from('materials')
      .select('file_url, file_type')
      .eq('id', id)
      .single()

    if (fetchErr || !material) {
      return NextResponse.json({ error: '자료를 찾을 수 없습니다.' }, { status: 404 })
    }

    // Storage에서 파일 경로 추출
    // URL 형식: https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
    try {
      const url   = new URL(material.file_url)
      const match = url.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)/)
      if (match) {
        const [, bucket, filePath] = match
        await supabaseServer.storage.from(bucket).remove([filePath])
      }
    } catch {
      // Storage 삭제 실패해도 DB 삭제는 진행
    }

    const { error: dbErr } = await supabaseServer.from('materials').delete().eq('id', id)
    if (dbErr) return NextResponse.json({ error: `DB 삭제 실패: ${dbErr.message}` }, { status: 500 })

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '알 수 없는 오류'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
