import { createClient } from '@supabase/supabase-js'
import type { Database } from './supabase'

// 모듈 레벨 싱글턴 대신 함수로 감싸서 호출 시점에 env 읽기
export function createServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL 환경변수가 설정되지 않았습니다.')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.')

  return createClient<Database>(url, key, {
    auth: { persistSession: false },
  })
}

// 기존 코드와의 호환을 위해 named export 유지
export const supabaseServer = createServerClient()
