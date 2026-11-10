import { test } from 'node:test'
import assert from 'node:assert/strict'
import { weekStartOf, weekKey, weeklyAssessment, gradeOf, claimReward, nextWeekGoals, MIN_SOLVED, WEEKLY_TARGET, GRADE_REWARD, ASSESSMENT_DISCLAIMER } from '../../src/game/engine/assessment.ts'
import type { Attempt, GameQuestion, ScheduleState } from '../../src/game/engine/types.ts'

const KST = 9 * 3600 * 1000
const H = 3600 * 1000
const MON = Date.UTC(2026, 10, 9) - KST // 2026-11-09(월) 00:00 KST
const WEEK = 7 * 24 * H

let seq = 0
const A = (q: string, ok: boolean, at: number, extra: Partial<Attempt> = {}): Attempt =>
  ({ id: String(seq++), questionId: q, unitId: 'u1', at, selected: 'O', isCorrect: ok, elapsedMs: 3000, attemptNo: 1, wasReview: false, isFirst: true, boxAfter: 0, ...extra })
const Q = (id: string, unit = 'u1'): GameQuestion => ({ id, type: 'ox', unitId: unit, unitTitle: unit === 'u1' ? '단원1' : '단원2', statement: id, answer: 'O' })
const sched = (id: string, mastery: number): ScheduleState => ({ questionId: id, box: mastery / 20, attemptCount: 1, wrongCount: 0, reviewCount: 0, streak: 1, mastery, lastAttemptedAt: 0, nextReviewAt: 0 })
// 이번 주에 n 번 푼 기록(서로 다른 문항, 모두 같은 정오)
const many = (n: number, ok: boolean, start = MON + H) => Array.from({ length: n }, (_, i) => A(`q${i}`, ok, start + i * 60_000))

test('주의 시작은 한국 시간 월요일 00:00', () => {
  assert.equal(weekStartOf(MON), MON)
  assert.equal(weekStartOf(MON + 30 * 60_000), MON) // 월 00:30 KST (UTC로는 일요일 15:30)
  assert.equal(weekStartOf(MON + WEEK - 1), MON) // 일요일 23:59:59.999 KST
  assert.equal(weekStartOf(MON + WEEK), MON + WEEK)
  assert.equal(weekStartOf(MON - 1), MON - WEEK) // 월요일 직전 = 지난주
  assert.equal(weekKey(MON), '2026-11-09')
})

test('등급 경계: 90 S / 80 A / 65 B / 50 C / 그 미만 D', () => {
  assert.deepEqual([90, 89.9, 80, 79.9, 65, 64.9, 50, 49.9, 0].map(gradeOf), ['S', 'A', 'A', 'B', 'B', 'C', 'C', 'D', 'D'])
})

test('풀이가 적으면 평가를 보류하고 보상도 없다(근거 부족)', () => {
  const r = weeklyAssessment(many(MIN_SOLVED - 1, true), {}, [], MON)
  assert.equal(r.grade, null); assert.equal(r.score, null); assert.equal(r.reward, 0)
  assert.match(r.holdReason ?? '', /보류/)
})

test('목표량을 모두 정답으로 풀면 S, 정답률이 낮으면 낮은 등급', () => {
  const qs = Array.from({ length: WEEKLY_TARGET }, (_, i) => Q(`q${i}`))
  const sc = Object.fromEntries(qs.map(q => [q.id, sched(q.id, 100)]))
  const top = weeklyAssessment(many(WEEKLY_TARGET, true), sc, qs, MON)
  assert.equal(top.grade, 'S'); assert.equal(top.accuracy, 100); assert.equal(top.reward, GRADE_REWARD.S)
  const lowAtt = many(12, true).map((a, i) => ({ ...a, isCorrect: i < 4 })) // 12문제 중 4개 정답
  const low = weeklyAssessment(lowAtt, {}, [], MON)
  assert.ok(low.grade === 'D' || low.grade === 'C', String(low.grade))
  assert.ok((low.score ?? 100) < (top.score ?? 0))
})

test('오답 복습 완료율: 틀렸다가 연속 2번 맞힌 문항만 처리 완료, 지난주부터 남은 미처리도 포함', () => {
  const t = MON + H
  const attempts = [
    A('old', false, MON - 2 * 24 * H),            // 지난주에 틀림 → 주 시작 시점에 미처리
    A('a', false, t), A('a', true, t + 1000), A('a', true, t + 2000),    // 이번 주에 틀리고 → 처리 완료
    A('b', false, t + 3000),                       // 이번 주에 틀리고 → 아직 미처리
    A('old', true, t + 4000), A('old', true, t + 5000), // 지난주 오답을 이번 주에 처리 완료
    ...many(10, true, t + 10_000).map((x, i) => ({ ...x, questionId: `n${i}` })),
  ]
  const r = weeklyAssessment(attempts, {}, [], MON)
  assert.equal(r.reviewTotal, 3) // old, a, b
  assert.equal(r.reviewCleared, 2) // old, a
  assert.equal(r.reviewCompletion, 66.7)
})

test('실력 상승 추세: 지난주 대비 정답률 변화, 지난주 풀이가 10개 미만이면 계산하지 않음', () => {
  const lastWeek = (n: number, okN: number) => Array.from({ length: n }, (_, i) => A(`p${i}`, i < okN, MON - 3 * 24 * H + i * 1000))
  const thisWeek = Array.from({ length: 20 }, (_, i) => A(`q${i}`, i < 16, MON + H + i * 1000)) // 80%
  const up = weeklyAssessment([...lastWeek(20, 10), ...thisWeek], {}, [], MON) // 지난주 50%
  assert.equal(up.trend, 30)
  const none = weeklyAssessment([...lastWeek(9, 9), ...thisWeek], {}, [], MON)
  assert.equal(none.trend, null)
})

test('값이 없는 항목(오답 없음/추세 없음)은 빼고 나머지로 공정하게 계산', () => {
  const qs = Array.from({ length: WEEKLY_TARGET }, (_, i) => Q(`q${i}`))
  const sc = Object.fromEntries(qs.map(q => [q.id, sched(q.id, 100)]))
  const r = weeklyAssessment(many(WEEKLY_TARGET, true), sc, qs, MON)
  assert.equal(r.reviewCompletion, null); assert.equal(r.trend, null)
  assert.equal(r.score, 100) // 있는 항목이 모두 만점이면 만점
})

test('보상: 주가 끝난 뒤에만, 한 번만, 보류 상태는 없음', () => {
  const qs = Array.from({ length: 30 }, (_, i) => Q(`q${i}`))
  const r = weeklyAssessment(many(30, true), Object.fromEntries(qs.map(q => [q.id, sched(q.id, 60)])), qs, MON)
  assert.ok(r.grade)
  const during = claimReward({}, r, MON + 2 * 24 * H)
  assert.equal(during.coins, 0); assert.match(during.reason ?? '', /끝난 뒤/)
  const ok = claimReward({}, r, MON + WEEK + H)
  assert.equal(ok.coins, r.reward); assert.ok(ok.claims[r.key])
  const again = claimReward(ok.claims, r, MON + WEEK + 2 * H)
  assert.equal(again.coins, 0); assert.match(again.reason ?? '', /이미/)
  const hold = weeklyAssessment(many(3, true), {}, [], MON)
  assert.equal(claimReward({}, hold, MON + WEEK + H).coins, 0)
})

test('다음 주 목표: 취약 단원과 미처리 오답을 짚어 준다 / 면책 문구는 합격을 단정하지 않는다', () => {
  const qs = [Q('a', 'u1'), Q('b', 'u2')]
  const att = [...Array.from({ length: 6 }, (_, i) => A('a', i < 1, MON + H + i * 1000, { unitId: 'u1' })), ...Array.from({ length: 6 }, (_, i) => A('b', true, MON + 2 * H + i * 1000, { unitId: 'u2' }))]
  const r = weeklyAssessment(att, {}, qs, MON)
  assert.equal(r.weakUnit?.title, '단원1')
  const goals = nextWeekGoals(r, 4)
  assert.ok(goals.some(g => g.includes('단원1')) && goals.some(g => g.includes('미처리 오답 4개')))
  assert.match(ASSESSMENT_DISCLAIMER, /합격 가능성/)
  assert.doesNotMatch(goals.join(' '), /합격(권|확률)/)
})
