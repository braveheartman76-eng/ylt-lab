import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category')
  const fileType  = searchParams.get('type')

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    const missing = [!url && 'NEXT_PUBLIC_SUPABASE_URL', !key && 'SUPABASE_SERVICE_ROLE_KEY']
      .filter(Boolean).join(', ')
    return NextResponse.json({ error: `환경변수 누락: ${missing}` }, { status: 500 })
  }

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } })

  let query = supabase
    .from('materials')
    .select('*')
    .order('created_at', { ascending: false })

  if (category) query = query.eq('category', category as Database['public']['Tables']['materials']['Row']['category'])
  if (fileType === 'open' || fileType === 'study') query = query.eq('file_type', fileType)

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
