import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyAttempt, INTERVAL_MINUTES, levelFromXp, isOpenWrong, CLEAR_STREAK } from '../../src/game/engine/srs.ts'
import { pickNext, targetDifficulty } from '../../src/game/engine/picker.ts'
import { recommend, unitStats } from '../../src/game/engine/stats.ts'
import type { Attempt, GameQuestion, ScheduleState } from '../../src/game/engine/types.ts'

const MIN = 60_000, DAY = 1440 * MIN
const mkQ = (id: string, unit = 'u1', difficulty: number | null = null): GameQuestion =>
  ({ id, type: 'ox', unitId: unit, unitTitle: unit === 'u1' ? '[테스트] 단원1' : '[테스트] 단원2', statement: `[테스트] ${id}`, answer: 'O', difficulty, isTestData: true })
const mkA = (q: string, ok: boolean, extra: Partial<Attempt> = {}): Attempt =>
  ({ id: Math.random().toString(), questionId: q, unitId: 'u1', at: 0, selected: 'O', isCorrect: ok, elapsedMs: 1000, attemptNo: 1, wasReview: false, isFirst: true, boxAfter: 0, ...extra })

test('첫 오답: box0, 30분 뒤 재확인, 누적 오답 1', () => {
  const r = applyAttempt(undefined, 'a', false, 0, null)
  assert.equal(r.state.box, 0); assert.equal(r.state.wrongCount, 1); assert.equal(r.state.nextReviewAt, 30 * MIN)
  assert.deepEqual(r.reward, { xp: 0, coins: 0 })
})

test('복습 사다리: 1일→3일→7일→14일→30일, 오답 시 2단계 하락/누적오답 유지', () => {
  let s = applyAttempt(undefined, 'a', false, 0, null).state
  let t = 0
  const boxes: number[] = []
  for (let i = 0; i < 6; i++) { t = s.nextReviewAt; s = applyAttempt(s, 'a', true, t, null).state; boxes.push(s.box) }
  assert.deepEqual(boxes, [1, 2, 3, 4, 5, 5])
  assert.equal(s.nextReviewAt - t, INTERVAL_MINUTES[5] * MIN)
  t = s.nextReviewAt
  const w = applyAttempt(s, 'a', false, t, null).state
  assert.equal(w.box, 3); assert.equal(w.streak, 0); assert.equal(w.wrongCount, 2)
})

test('보상 파밍 방지: 복습 예정이 아닌 정답 반복은 보상 0', () => {
  const first = applyAttempt(undefined, 'a', true, 0, 1)
  assert.ok(first.reward.xp > 0)
  const again = applyAttempt(first.state, 'a', true, 1000, 1)
  assert.deepEqual(again.reward, { xp: 0, coins: 0 })
  const review = applyAttempt(first.state, 'a', true, first.state.nextReviewAt, 1)
  assert.equal(review.reward.xp, 15) // 10 + 복습 5
})

test('레벨은 경험치로만 오른다', () => {
  assert.equal(levelFromXp(0).level, 1); assert.equal(levelFromXp(50).level, 2); assert.ok(levelFromXp(10_000).level > 5)
})

test('출제: reviewOnly 는 미처리 오답(오답 많은 순) → 복습 예정 순, 없으면 null', () => {
  const qs = [mkQ('a'), mkQ('b'), mkQ('c')]
  const sch: Record<string, ScheduleState> = {
    a: { ...applyAttempt(undefined, 'a', false, 0, null).state },
    b: { ...applyAttempt(applyAttempt(undefined, 'b', false, 0, null).state, 'b', false, 40 * MIN, null).state },
  }
  const now = 3 * DAY
  const p = pickNext(qs, sch, { now, attempts: [], reviewOnly: true })
  assert.equal(p?.question.id, 'b'); assert.equal(p?.kind, 'critical')
  assert.equal(pickNext(qs, {}, { now, attempts: [], reviewOnly: true }), null)
})

test('출제: 연속 중복 방지, 단원 집중훈련, 풀이 소진 시에도 null 이 아님', () => {
  const qs = [mkQ('a'), mkQ('b', 'u2')]
  const p = pickNext(qs, {}, { now: 0, attempts: [], recentIds: ['a'], rng: () => 0.5 })
  assert.equal(p?.question.id, 'b')
  assert.equal(pickNext(qs, {}, { now: 0, attempts: [], unitId: 'u1', rng: () => 0.5 })?.question.id, 'a')
  const sch = { a: applyAttempt(undefined, 'a', true, 0, null).state, b: applyAttempt(undefined, 'b', true, 0, null).state }
  assert.ok(pickNext(qs, sch, { now: 1, attempts: [], rng: () => 0.5 }))
})

test('적응형 난이도: 실력은 최근 정답률로만 조절(데이터 부족 시 기초)', () => {
  assert.equal(targetDifficulty([]), 2)
  const low = Array.from({ length: 10 }, (_, i) => mkA('x', i < 3))
  assert.equal(targetDifficulty(low), 1)
  const high = Array.from({ length: 20 }, () => mkA('x', true))
  assert.equal(targetDifficulty(high), 5)
  // 난이도 5 목표일 때 새 문제는 난이도가 높은 것부터
  const qs = [mkQ('easy', 'u1', 1), mkQ('hard', 'u1', 5)]
  assert.equal(pickNext(qs, {}, { now: 0, attempts: high, rng: () => 0.5 })?.question.id, 'hard')
})

test('통계/추천: 근거가 충분할 때만 취약 단원 추천, 합격 가능성 언급 없음', () => {
  const qs = [mkQ('a'), mkQ('b')]
  assert.equal(recommend(unitStats([mkA('a', false)], qs, {})), null)
  const at = [...Array.from({ length: 5 }, () => mkA('a', false, { wasReview: true, isFirst: false })), mkA('b', true)]
  const msg = recommend(unitStats(at, qs, {}))!
  assert.match(msg, /\[테스트\] 단원1.*복습 정답률이 0%/)
  assert.doesNotMatch(msg, /합격/)
})

test('미처리 오답: 연속 2회 정답으로 처리되고, 다시 틀리면 되살아난다 (누적 오답은 유지)', () => {
  let s = applyAttempt(undefined, 'a', false, 0, null).state
  assert.equal(isOpenWrong(s), true)
  s = applyAttempt(s, 'a', true, 1000, null).state
  assert.equal(isOpenWrong(s), true, `연속 ${CLEAR_STREAK}회 전에는 미처리`)
  s = applyAttempt(s, 'a', true, 2000, null).state
  assert.equal(isOpenWrong(s), false)
  s = applyAttempt(s, 'a', false, 3000, null).state
  assert.equal(isOpenWrong(s), true)
  assert.equal(s.wrongCount, 2)
  assert.equal(isOpenWrong(undefined), false)
})

test('미처리 오답은 복습 시각이 아직 안 되었어도 접속하면 먼저 나온다(forceCritical)', () => {
  const qs = [mkQ('wrong1'), mkQ('fresh1'), mkQ('fresh2')]
  const sch = { wrong1: applyAttempt(undefined, 'wrong1', false, 0, null).state }
  const now = 1000 // 30분 복습 시각 전
  assert.ok(sch.wrong1.nextReviewAt > now)
  const p = pickNext(qs, sch, { now, attempts: [], forceCritical: true, rng: () => 0.99 })
  assert.equal(p?.question.id, 'wrong1'); assert.equal(p?.kind, 'critical')
  // 처리된 뒤에는 접속 직후에도 강제로 나오지 않는다
  let s = sch.wrong1
  s = applyAttempt(s, 'wrong1', true, 2000, null).state
  s = applyAttempt(s, 'wrong1', true, 3000, null).state
  const p2 = pickNext(qs, { wrong1: s }, { now: 4000, attempts: [], forceCritical: true, rng: () => 0.99, recentIds: [] })
  assert.notEqual(p2?.kind, 'critical')
})

test('평소에도 미처리 오답이 꾸준히 섞여 나온다 (약 1/3 이상)', () => {
  const qs = [mkQ('w'), ...Array.from({ length: 20 }, (_, i) => mkQ(`n${i}`))]
  const sch = { w: applyAttempt(undefined, 'w', false, 0, null).state }
  let seed = 7
  const rng = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
  let hit = 0
  for (let i = 0; i < 400; i++) if (pickNext(qs, sch, { now: 1000, attempts: [], rng })?.kind === 'critical') hit++
  assert.ok(hit / 400 > 0.3 && hit / 400 < 0.5, `critical 비율 ${hit / 400}`)
})
