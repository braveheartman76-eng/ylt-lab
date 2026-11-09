import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildParts, firstPart, nextPart } from '../../src/game/engine/parts.ts'
import { applyAttempt } from '../../src/game/engine/srs.ts'
import { addScore, toNextLife, MAX_HP, SCORE_PER_LIFE, SCORE_KILL, SCORE_PICKUP, FULL_HP_COIN_BONUS } from '../../src/game/world.ts'

const Q = (id, section, topic) => ({ id, type: 'ox', unitId: 'u', unitTitle: section, section, topic, statement: id, answer: 'O' })
const qs = [Q('a1', 'S1', 'T1'), Q('a2', 'S1', 'T1'), Q('b1', 'S1', 'T2'), Q('c1', 'S2', 'T3'), Q('a3', 'S1', 'T1')]

test('파트: 같은 소제목끼리 책 순서대로 묶인다(처음 등장한 순서 유지)', () => {
  const parts = buildParts(qs)
  assert.deepEqual(parts.map(p => [p.title, p.questions.map(q => q.id)]), [['T1', ['a1', 'a2', 'a3']], ['T2', ['b1']], ['T3', ['c1']]])
})

test('파트 선택: 안 푼 문제가 있는 첫 파트 → 없으면 오답/복습 있는 파트 → 없으면 첫 파트, 다음 파트는 책 순서', () => {
  const parts = buildParts(qs)
  const now = 1_000_000
  assert.equal(firstPart(parts, {}, now).title, 'T1')
  const solved = id => applyAttempt(undefined, id, true, 0, null).state
  const all = Object.fromEntries(qs.map(q => [q.id, solved(q.id)]))
  assert.equal(firstPart(parts, { ...all, a1: undefined, a2: all.a2 }, now).title, 'T1', '안 푼 문제가 있으면 그 파트')
  const only3 = { a1: all.a1, a2: all.a2, a3: all.a3, b1: all.b1 } // T3 문제(c1) 안 풂
  assert.equal(firstPart(parts, only3, now).title, 'T3')
  const wrong = { ...all, b1: applyAttempt(undefined, 'b1', false, 0, null).state }
  assert.equal(firstPart(parts, wrong, now).title, 'T2', '미처리 오답이 있는 파트')
  assert.equal(firstPart(parts, all, 1).title, 'T1', '전부 처리됐고 복습 예정도 없으면 처음부터')
  assert.equal(nextPart(parts, parts[0].key).title, 'T2')
  assert.equal(nextPart(parts, parts[2].key), null)
  assert.equal(firstPart([], {}, 0), null)
})

test('점수 → 생명: 점수가 쌓이다가 기준 점수마다 체력 +1 (한 번에 여러 개도 가능)', () => {
  let s = { score: 0, lifeAwards: 0, hp: 3, coins: 0 }
  s = addScore(s, SCORE_PICKUP)
  assert.deepEqual([s.score, s.hp, s.lifeAwards], [1, 3, 0])
  s = addScore(s, SCORE_PER_LIFE - 1)
  assert.deepEqual([s.score, s.hp, s.lifeAwards, s.lives], [SCORE_PER_LIFE, 4, 1, 1])
  s = addScore(s, 1)
  assert.equal(s.lives, 0, '기준을 넘기지 않으면 보너스 없음')
  const big = addScore({ score: 0, lifeAwards: 0, hp: 3, coins: 0 }, SCORE_PER_LIFE * 2)
  assert.deepEqual([big.hp, big.lives, big.lifeAwards], [5, 2, 2])
})

test('체력이 가득이면 생명 대신 코인, 체력 상한은 지켜진다', () => {
  const r = addScore({ score: SCORE_PER_LIFE - 1, lifeAwards: 0, hp: MAX_HP, coins: 10 }, 1)
  assert.deepEqual([r.hp, r.lives, r.coinBonus, r.coins], [MAX_HP, 0, FULL_HP_COIN_BONUS, 10 + FULL_HP_COIN_BONUS])
  const over = addScore({ score: 0, lifeAwards: 0, hp: MAX_HP - 1, coins: 0 }, SCORE_PER_LIFE * 3)
  assert.equal(over.hp, MAX_HP); assert.equal(over.lives, 1); assert.equal(over.coinBonus, FULL_HP_COIN_BONUS * 2)
})

test('점수 규칙이 적당한지: 악당 2마리 처치 + 간식 10개 정도에 생명 1개 수준(기준 점수 / 처치 점수)', () => {
  const perLifeKills = SCORE_PER_LIFE / SCORE_KILL
  assert.ok(perLifeKills > 1.5 && perLifeKills < 4, `처치 ${perLifeKills}마리당 생명 1개`)
  assert.equal(toNextLife(0), SCORE_PER_LIFE); assert.equal(toNextLife(SCORE_PER_LIFE - 5), 5)
  assert.ok(addScore({ score: 0, lifeAwards: 0, hp: 1, coins: 0 }, -50).score === 0, '음수 점수는 무시')
})
