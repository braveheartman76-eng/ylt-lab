import type { Attempt, GameQuestion, ScheduleState } from './types.ts'
import { isDue } from './srs.ts'
import { recentAccuracy } from './stats.ts'

export type PickKind = 'review' | 'new' | 'past_wrong' | 'challenge' | 'any'
export interface Pick {
  question: GameQuestion
  kind: PickKind
}

/** 학생 실력에 맞는 목표 난이도(1~5). 문제 난이도와 학생 숙련도를 분리해 실제 학습 성과로만 조절한다. */
export function targetDifficulty(attempts: Attempt[]): number {
  const acc = recentAccuracy(attempts)
  if (acc === null) return 2 // 데이터가 부족하면 기초부터
  if (acc < 0.5) return 1
  if (acc < 0.7) return 2
  if (acc < 0.85) return 3
  if (acc < 0.95) return 4
  return 5
}

export interface PickOptions {
  now: number
  attempts: Attempt[]
  rng?: () => number
  recentIds?: string[] // 방금 나온 문항(연속 중복 방지)
  unitId?: string // 단원 집중훈련
  reviewOnly?: boolean
}

/**
 * 출제 혼합: 오늘 복습 예정 40% / 처음 보는 문제 35% / 과거 오답(아직 예정 전) 10% / 고난도 도전 15%.
 * 비율대로 뽑되 해당 풀이 비어 있으면 다른 풀로 넘어간다. reviewOnly 면 복습 예정 문항만 출제.
 */
export function pickNext(
  questions: GameQuestion[],
  schedules: Record<string, ScheduleState>,
  opt: PickOptions,
): Pick | null {
  const rng = opt.rng ?? Math.random
  const recent = new Set(opt.recentIds ?? [])
  let pool = questions.filter(q => !opt.unitId || q.unitId === opt.unitId)
  const fresh = pool.filter(q => !recent.has(q.id))
  if (fresh.length) pool = fresh

  const due = pool
    .filter(q => schedules[q.id] && isDue(schedules[q.id], opt.now))
    .sort((a, b) => schedules[b.id].wrongCount - schedules[a.id].wrongCount || schedules[a.id].nextReviewAt - schedules[b.id].nextReviewAt)
  if (opt.reviewOnly) return due.length ? { question: due[0], kind: 'review' } : null

  const target = targetDifficulty(opt.attempts)
  const dist = (q: GameQuestion) => Math.abs((q.difficulty ?? 3) - target)
  const unseen = pool.filter(q => !schedules[q.id]).sort((a, b) => dist(a) - dist(b) || rng() - 0.5)
  const pastWrong = pool.filter(q => schedules[q.id] && !isDue(schedules[q.id], opt.now) && schedules[q.id].wrongCount > 0 && schedules[q.id].box < 3)
  const challenge = pool
    .filter(q => (q.difficulty ?? 0) >= 4 && (!schedules[q.id] || isDue(schedules[q.id], opt.now)))
    .filter(() => target >= 4)

  const r = rng()
  const order: [PickKind, GameQuestion[]][] =
    r < 0.4 ? [['review', due], ['new', unseen], ['past_wrong', pastWrong], ['challenge', challenge]]
    : r < 0.75 ? [['new', unseen], ['review', due], ['past_wrong', pastWrong], ['challenge', challenge]]
    : r < 0.85 ? [['past_wrong', pastWrong], ['review', due], ['new', unseen], ['challenge', challenge]]
    : [['challenge', challenge], ['new', unseen], ['review', due], ['past_wrong', pastWrong]]
  for (const [kind, list] of order) if (list.length) return { question: kind === 'new' ? list[0] : list[Math.floor(rng() * Math.min(list.length, 3))], kind }
  // 전부 소진: 예정이 가장 가까운 문항을 다시 보여준다(장기 기억 확인)
  const rest = [...pool].sort((a, b) => (schedules[a.id]?.nextReviewAt ?? 0) - (schedules[b.id]?.nextReviewAt ?? 0))
  return rest.length ? { question: rest[0], kind: 'any' } : null
}
