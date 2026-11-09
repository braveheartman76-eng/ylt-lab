import type { Attempt, GameQuestion, ScheduleState } from './types.ts'
import { isDue, isOpenWrong } from './srs.ts'
import { recentAccuracy } from './stats.ts'

/** critical = 미처리 오답(불시 공격/크리티컬), review = 복습 예정 문항(이미 처리된 것의 장기 확인), new = 처음 보는 문제 */
export type PickKind = 'critical' | 'review' | 'new' | 'challenge' | 'any'
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
  reviewOnly?: boolean // 미처리 오답 + 복습 예정만 출제
  forceCritical?: boolean // 접속 직후: 미처리 오답이 있으면 무조건 먼저 출제
}

/**
 * 출제 혼합: 미처리 오답(크리티컬) 35% / 복습 예정(처리 완료분의 장기 확인) 20% / 처음 보는 문제 35% / 고난도 도전 10%.
 * 접속 직후(forceCritical)에는 미처리 오답을 먼저 낸다. 풀이 비어 있으면 다른 풀로 넘어간다.
 * 미처리 오답은 복습 시각과 무관하게 연속 2회 정답으로 처리될 때까지 계속 나온다.
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

  const open = pool
    .filter(q => isOpenWrong(schedules[q.id]))
    .sort((a, b) => schedules[b.id].wrongCount - schedules[a.id].wrongCount || schedules[a.id].lastAttemptedAt - schedules[b.id].lastAttemptedAt)
  const due = pool
    .filter(q => schedules[q.id] && !isOpenWrong(schedules[q.id]) && isDue(schedules[q.id], opt.now))
    .sort((a, b) => schedules[a.id].nextReviewAt - schedules[b.id].nextReviewAt)
  if (opt.reviewOnly) {
    if (open.length) return { question: open[0], kind: 'critical' }
    return due.length ? { question: due[0], kind: 'review' } : null
  }
  if (opt.forceCritical && open.length) return { question: open[0], kind: 'critical' }

  const target = targetDifficulty(opt.attempts)
  const dist = (q: GameQuestion) => Math.abs((q.difficulty ?? 3) - target)
  const unseen = pool.filter(q => !schedules[q.id]).sort((a, b) => dist(a) - dist(b) || rng() - 0.5)
  const challenge = pool
    .filter(q => (q.difficulty ?? 0) >= 4 && (!schedules[q.id] || (isDue(schedules[q.id], opt.now) && !isOpenWrong(schedules[q.id]))))
    .filter(() => target >= 4)

  const r = rng()
  const order: [PickKind, GameQuestion[]][] =
    r < 0.35 ? [['critical', open], ['review', due], ['new', unseen], ['challenge', challenge]]
    : r < 0.55 ? [['review', due], ['new', unseen], ['critical', open], ['challenge', challenge]]
    : r < 0.9 ? [['new', unseen], ['critical', open], ['review', due], ['challenge', challenge]]
    : [['challenge', challenge], ['new', unseen], ['critical', open], ['review', due]]
  for (const [kind, list] of order) {
    if (list.length) return { question: kind === 'new' ? list[0] : list[Math.floor(rng() * Math.min(list.length, 3))], kind }
  }
  // 전부 소진: 예정이 가장 가까운 문항을 다시 보여준다(장기 기억 확인)
  const rest = [...pool].sort((a, b) => (schedules[a.id]?.nextReviewAt ?? 0) - (schedules[b.id]?.nextReviewAt ?? 0))
  return rest.length ? { question: rest[0], kind: 'any' } : null
}
