import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCase, judgeCase, needOf, CASE_SIZE, SOLVE_MIN, CASE_REWARD_COINS } from '../../src/game/engine/cases.ts'
import { applyAttempt } from '../../src/game/engine/srs.ts'

const Q = (id, section, topic) => ({ id, type: 'ox', unitId: section, unitTitle: section, section, topic, statement: id, answer: 'O' })
const qs = [
  ...['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'].map((id, i) => Q(id, 'S1', 'T' + (i % 6))), // S1: 소제목 6개
  ...['b1', 'b2', 'b3'].map(id => Q(id, 'S2', 'U1')),
  Q('c1', 'S3', 'V1'), Q('c2', 'S3', 'V1'), // S3: 2문제(너무 적음)
]
const fixedRng = () => 0.5

test('사건은 문제가 충분한 대제목에서 단서 5개(최대)를 책 순서로 고른다', () => {
  const c = buildCase(qs, {}, { rng: fixedRng })
  assert.ok(c)
  assert.ok(c.questions.length <= CASE_SIZE && c.questions.length >= 3)
  const idx = c.questions.map(q => qs.indexOf(q))
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b), '책 순서')
  assert.ok(!c.questions.some(q => q.section === 'S3'), '2문제뿐인 대제목은 제외')
  assert.equal(new Set(c.questions.map(q => q.topic)).size, c.questions.length, '소제목이 겹치지 않게 고름')
  assert.match(c.title, /^사건 #\d{3} · /)
})

test('학습이 필요한 문제를 우선: 미처리 오답이 단서로 뽑힌다', () => {
  const sched = {}
  for (const q of qs.filter(x => x.section === 'S1')) sched[q.id] = applyAttempt(undefined, q.id, true, 0, null).state // 모두 처리 완료
  for (const id of ['b1', 'b2', 'b3']) sched[id] = { ...applyAttempt(undefined, id, true, 0, null).state, mastery: 100, box: 5 } // 다른 대제목도 모두 숙련
  for (const id of ['a1', 'a2', 'a4', 'a5', 'a7']) sched[id] = { ...sched[id], mastery: 100, box: 5 }
  sched.a3 = applyAttempt(undefined, 'a3', false, 0, null).state // 미처리 오답
  sched.a6 = applyAttempt(undefined, 'a6', false, 0, null).state
  const c = buildCase(qs, sched, { rng: fixedRng })
  assert.equal(c.section, 'S1', '필요도가 높은 대제목')
  assert.ok(c.questions.some(q => q.id === 'a3') && c.questions.some(q => q.id === 'a6'))
  assert.ok(needOf(qs[2], sched.a3) > needOf(qs[0], sched.a1))
})

test('같은 구성이면 같은 사건 id(반복 보상 방지의 기준), 제외 목록을 주면 다른 사건', () => {
  const a = buildCase(qs, {}, { rng: fixedRng }), b = buildCase(qs, {}, { rng: fixedRng })
  assert.equal(a.id, b.id); assert.equal(a.number, b.number)
  const other = buildCase(qs, {}, { rng: fixedRng, excludeIds: [a.id] })
  assert.ok(other && other.id !== a.id)
  assert.equal(buildCase([Q('x', 'S', 'T')], {}), null, '문제가 너무 적으면 사건 없음')
})

test('판정/보상: 4개 이상 해결, 처음 해결할 때만 보상', () => {
  assert.equal(judgeCase(SOLVE_MIN - 1, 5, false).solved, false)
  assert.equal(judgeCase(SOLVE_MIN - 1, 5, false).coins, 0)
  const first = judgeCase(SOLVE_MIN, 5, false)
  assert.deepEqual([first.solved, first.firstClear, first.coins], [true, true, CASE_REWARD_COINS])
  const again = judgeCase(5, 5, true)
  assert.deepEqual([again.solved, again.firstClear, again.coins, again.score], [true, false, 0, 0])
  assert.equal(judgeCase(3, 3, false).solved, true, '단서가 3개뿐인 사건은 3개 모두 맞혀야 해결')
  assert.equal(judgeCase(2, 3, false).solved, false)
  assert.equal(judgeCase(0, 0, false).solved, false)
})
