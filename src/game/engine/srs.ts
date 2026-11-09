import type { ScheduleState, Reward } from './types.ts'

/**
 * 복습 간격표(분). DB 의 game_srs_intervals 시드와 동일해야 한다 (tests/engine/parity.test.mjs 로 검증).
 *  box0 오답 직후(당일 재확인) / 1일 / 3일 / 7일 / 14일 / 30일
 */
export const INTERVAL_MINUTES = [30, 1440, 4320, 10080, 20160, 43200] as const
export const MAX_BOX = 5
const MIN = 60_000

export interface SrsResult {
  state: ScheduleState
  isFirst: boolean
  wasReview: boolean
  reward: Reward
}

/**
 * 한 번의 풀이를 반영해 새 복습 상태와 보상을 계산한다. (SQL game_submit_attempt 와 같은 규칙)
 *  - 첫 풀이 정답 → box2 / 첫 풀이 오답 → box0
 *  - 정답 → box+1 (최대 5) / 오답 → box-2 (최소 0), wrongCount 는 누적만 한다
 *  - 보상은 '정답 + (처음 푸는 문항 또는 복습 예정 문항)'일 때만 → 쉬운 문제 반복 파밍 방지
 */
export function applyAttempt(
  prev: ScheduleState | undefined,
  questionId: string,
  isCorrect: boolean,
  now: number,
  difficulty: number | null | undefined,
): SrsResult {
  const isFirst = !prev
  const wasReview = !!prev && prev.nextReviewAt <= now
  let box: number
  if (isCorrect) box = isFirst ? 2 : Math.min(prev!.box + 1, MAX_BOX)
  else box = isFirst ? 0 : Math.max(prev!.box - 2, 0)
  const streak = isCorrect ? (prev?.streak ?? 0) + 1 : 0
  const state: ScheduleState = {
    questionId,
    box,
    attemptCount: (prev?.attemptCount ?? 0) + 1,
    wrongCount: (prev?.wrongCount ?? 0) + (isCorrect ? 0 : 1),
    reviewCount: (prev?.reviewCount ?? 0) + (wasReview ? 1 : 0),
    streak,
    mastery: Math.min(100, box * 20),
    lastAttemptedAt: now,
    nextReviewAt: now + INTERVAL_MINUTES[box] * MIN,
  }
  return { state, isFirst, wasReview, reward: computeReward(isCorrect, isFirst, wasReview, difficulty) }
}

export function computeReward(isCorrect: boolean, isFirst: boolean, wasReview: boolean, difficulty: number | null | undefined): Reward {
  if (!isCorrect || !(isFirst || wasReview)) return { xp: 0, coins: 0 }
  const d = difficulty ?? 1
  return { xp: 10 + 5 * (d - 1) + (wasReview ? 5 : 0), coins: 2 + d }
}

/** 오답 '처리 완료'에 필요한 연속 정답 수. 이 횟수만큼 연속으로 맞히기 전까지는 미처리 오답으로 계속 출제된다. */
export const CLEAR_STREAK = 2

/** 미처리 오답: 한 번이라도 틀린 적이 있고 아직 연속 CLEAR_STREAK 회 맞히지 못한 문항. 복습 시각과 무관하게 접속할 때마다 나온다. */
export const isOpenWrong = (s: ScheduleState | undefined) => !!s && s.wrongCount > 0 && s.streak < CLEAR_STREAK

export const isDue = (s: ScheduleState, now: number) => s.nextReviewAt <= now

/** 게임 레벨: 경험치 기준(게임 성장). 학습 숙련도와는 별개다. */
export function levelFromXp(xp: number): { level: number; into: number; need: number } {
  let level = 1
  let left = xp
  let need = 50
  while (left >= need) {
    left -= need
    level++
    need = Math.round(need * 1.25)
  }
  return { level, into: left, need }
}
