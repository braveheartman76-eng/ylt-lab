import type { Attempt, GameQuestion, ScheduleState } from './types.ts'
import { isOpenWrong } from './srs.ts'

export interface UnitStat {
  unitId: string
  unitTitle: string
  attempts: number
  accuracy: number | null // 전체 정답률 0~1
  firstAccuracy: number | null // 첫 풀이 정답률
  reviewAccuracy: number | null // 복습 정답률
  avgElapsedMs: number | null
  openWrong: number // 미처리 오답 문항 수(연속 2회 정답 전)
}

const ratio = (a: number, b: number) => (b === 0 ? null : a / b)

export function unitStats(
  attempts: Attempt[],
  questions: GameQuestion[],
  schedules: Record<string, ScheduleState>,
): UnitStat[] {
  const byUnit = new Map<string, { title: string; ids: Set<string> }>()
  for (const q of questions) {
    const u = byUnit.get(q.unitId) ?? { title: q.unitTitle, ids: new Set() }
    u.ids.add(q.id)
    byUnit.set(q.unitId, u)
  }
  const out: UnitStat[] = []
  for (const [unitId, u] of byUnit) {
    const a = attempts.filter(x => x.unitId === unitId)
    const first = a.filter(x => x.isFirst)
    const rev = a.filter(x => x.wasReview)
    out.push({
      unitId,
      unitTitle: u.title,
      attempts: a.length,
      accuracy: ratio(a.filter(x => x.isCorrect).length, a.length),
      firstAccuracy: ratio(first.filter(x => x.isCorrect).length, first.length),
      reviewAccuracy: ratio(rev.filter(x => x.isCorrect).length, rev.length),
      avgElapsedMs: a.length ? a.reduce((s, x) => s + x.elapsedMs, 0) / a.length : null,
      openWrong: [...u.ids].filter(id => isOpenWrong(schedules[id])).length,
    })
  }
  return out
}

/** 최근 N회 정답률(적응형 난이도의 입력). 풀이가 적으면 null. */
export function recentAccuracy(attempts: Attempt[], n = 20, min = 5): number | null {
  const r = attempts.slice(-n)
  return r.length < min ? null : r.filter(x => x.isCorrect).length / r.length
}

/** 취약 단원 추천 문구. 근거(풀이 수)가 부족하면 추천하지 않는다. 합격 가능성 같은 표현은 쓰지 않는다. */
export function recommend(stats: UnitStat[], minAttempts = 5): string | null {
  const weak = stats
    .filter(s => s.attempts >= minAttempts)
    .map(s => ({ s, rate: s.reviewAccuracy ?? s.accuracy ?? 1 }))
    .filter(x => x.rate < 0.7)
    .sort((a, b) => a.rate - b.rate)[0]
  if (!weak) return null
  const label = weak.s.reviewAccuracy != null ? '복습 정답률' : '정답률'
  return `「${weak.s.unitTitle}」 단원의 ${label}이 ${Math.round(weak.rate * 100)}%입니다. 오늘은 이 단원의 10문항 집중훈련을 추천합니다.`
}
