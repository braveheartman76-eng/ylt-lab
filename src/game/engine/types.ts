// 게임 학습 엔진 공용 타입. React/브라우저 의존 없음(순수 TS).

export type QType = 'ox' | 'mcq'

export interface GameQuestion {
  id: string
  type: QType
  unitId: string
  unitTitle: string
  statement: string
  stemNote?: string | null
  bogi?: { label: string; text: string }[]
  choices?: { no: string; text: string }[]
  /** ox: 'O'|'X', mcq: '1'~'4'. 로컬(데모) 모드에서만 클라이언트가 가진다. 서버 모드에서는 RPC가 채점한다. */
  answer: string
  explanation?: string | null
  difficulty?: number | null // 1~5, 미정이면 null
  importance?: number | null
  isTestData?: boolean
  /** OX 변형 문항이면 원 문항 id */
  derivedFrom?: string | null
}

/** 학생 x 문항 복습 상태 (DB: game_review_schedules 와 동일 의미) */
export interface ScheduleState {
  questionId: string
  box: number // 0~5
  attemptCount: number
  wrongCount: number // 누적 오답 (감소하지 않음)
  reviewCount: number
  streak: number
  mastery: number // 0~100
  lastAttemptedAt: number // epoch ms
  nextReviewAt: number // epoch ms
}

/** 풀이 기록 — append-only (DB: game_answer_attempts) */
export interface Attempt {
  id: string
  questionId: string
  unitId: string
  at: number
  selected: string
  isCorrect: boolean
  elapsedMs: number
  attemptNo: number
  wasReview: boolean
  isFirst: boolean
  boxAfter: number
}

export interface Reward {
  xp: number
  coins: number
}
