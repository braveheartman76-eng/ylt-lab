import { createClient, SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// 도메인 타입
// ============================================================

export type Role = 'admin' | 'student'
export type MaterialCategory = '형법' | '형사소송법' | '교정학' | '노동법'
export type QuizType = 'MCQ' | 'OX'

// ============================================================
// Database 타입 — supabase-js v2 GenericSchema 구조 준수
// ============================================================

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          email: string
          name: string
          role: Role
          created_at: string
        }
        Insert: {
          id: string
          email: string
          name: string
          role?: Role
          created_at?: string
        }
        Update: {
          email?: string
          name?: string
          role?: Role
        }
        Relationships: []
      }
      materials: {
        Row: {
          id: string
          title: string
          file_url: string
          category: MaterialCategory
          file_size: number | null
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          file_url: string
          category: MaterialCategory
          file_size?: number | null
          created_at?: string
        }
        Update: {
          title?: string
          file_url?: string
          category?: MaterialCategory
          file_size?: number | null
        }
        Relationships: []
      }
      notices: {
        Row: {
          id: string
          title: string
          content: string | null
          link_url: string | null
          order: number
          is_active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          content?: string | null
          link_url?: string | null
          order?: number
          is_active?: boolean
          created_at?: string
        }
        Update: {
          title?: string
          content?: string | null
          link_url?: string | null
          order?: number
          is_active?: boolean
        }
        Relationships: []
      }
      quiz_questions: {
        Row: {
          id: string
          type: QuizType
          subject: string
          chapter: string | null
          content: string
          option_1: string | null
          option_2: string | null
          option_3: string | null
          option_4: string | null
          answer: string
          explanation: string | null
          source: string | null
          created_at: string
        }
        Insert: {
          id?: string
          type: QuizType
          subject: string
          chapter?: string | null
          content: string
          option_1?: string | null
          option_2?: string | null
          option_3?: string | null
          option_4?: string | null
          answer: string
          explanation?: string | null
          source?: string | null
          created_at?: string
        }
        Update: {
          type?: QuizType
          subject?: string
          chapter?: string | null
          content?: string
          option_1?: string | null
          option_2?: string | null
          option_3?: string | null
          option_4?: string | null
          answer?: string
          explanation?: string | null
          source?: string | null
        }
        Relationships: []
      }
      quiz_attempts: {
        Row: {
          id: string
          user_id: string
          question_id: string
          selected: string
          is_correct: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          question_id: string
          selected: string
          is_correct: boolean
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: [
          {
            foreignKeyName: 'quiz_attempts_user_id_fkey'
            columns: ['user_id']
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quiz_attempts_question_id_fkey'
            columns: ['question_id']
            referencedRelation: 'quiz_questions'
            referencedColumns: ['id']
          }
        ]
      }
      daily_quiz: {
        Row: {
          id: string
          date: string
          question_id: string
          order: number
          created_at: string
        }
        Insert: {
          id?: string
          date: string
          question_id: string
          order?: number
          created_at?: string
        }
        Update: {
          date?: string
          question_id?: string
          order?: number
        }
        Relationships: [
          {
            foreignKeyName: 'daily_quiz_question_id_fkey'
            columns: ['question_id']
            referencedRelation: 'quiz_questions'
            referencedColumns: ['id']
          }
        ]
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

// ============================================================
// 클라이언트 (싱글턴)
// ============================================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase: SupabaseClient<Database> = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey
)

// ============================================================
// 테이블별 Row 타입 (편의 re-export)
// ============================================================

export type Profile      = Database['public']['Tables']['profiles']['Row']
export type Material     = Database['public']['Tables']['materials']['Row']
export type Notice       = Database['public']['Tables']['notices']['Row']
export type QuizQuestion = Database['public']['Tables']['quiz_questions']['Row']
export type QuizAttempt  = Database['public']['Tables']['quiz_attempts']['Row']
export type DailyQuiz    = Database['public']['Tables']['daily_quiz']['Row']
