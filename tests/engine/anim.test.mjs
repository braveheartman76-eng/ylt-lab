import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RESOLVE_MS, HERO_ATTACK_S, ENEMY_ATTACK_S, IMPACT_AFTER_HERO_ATTACK_S, IMPACT_AFTER_ENEMY_ATTACK_S,
  runCycle, heroAttack, heroHurt, enemyAttack, enemyHit, enemyDie, enemyIdle, weaponAngle,
} from '../../src/game/anim.ts'

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps

test('정답 체크 후 긴장 틈은 0.3~1초(0.몇 초)', () => {
  assert.ok(RESOLVE_MS >= 300 && RESOLVE_MS <= 1000, String(RESOLVE_MS))
})

test('명중/피격 순간이 공격 동작의 "타격 구간" 안에 있다(화면·소리 타이밍 일치)', () => {
  // 헌터: 0.3~0.55 구간이 앞으로 찌르는 구간
  const hp = IMPACT_AFTER_HERO_ATTACK_S / HERO_ATTACK_S
  assert.ok(hp >= 0.3 && hp <= 0.55, `hero impact progress ${hp}`)
  // 악당: 0.35~0.6 구간이 덮치는 구간
  const ep = IMPACT_AFTER_ENEMY_ATTACK_S / ENEMY_ATTACK_S
  assert.ok(ep >= 0.35 && ep <= 0.6, `enemy impact progress ${ep}`)
})

test('헌터 공격: 시작·끝은 제자리, 뒤로 당겼다가 앞으로 크게 돌진', () => {
  assert.ok(near(heroAttack(0).dx, 0) && near(heroAttack(1).dx, 0))
  assert.ok(heroAttack(0.3).dx < -5, '뒤로 당김')
  assert.ok(heroAttack(0.55).dx > 30, '앞으로 돌진')
  assert.ok(heroAttack(0.55).lean > heroAttack(0.3).lean)
})

test('악당 공격: 헌터 쪽(왼쪽, 음수)으로 크게 덮치고 원위치로 돌아온다', () => {
  assert.ok(enemyAttack(0.6).dx < -60)
  assert.ok(near(enemyAttack(0).dx, 0) && near(enemyAttack(1).dx, 0))
  assert.ok(enemyAttack(0.35).glow > 0.2, '공격 직전 붉은 기운')
})

test('피격: 헌터는 뒤로 튕기며 젖혀지고 회복, 악당은 번쩍 후 회복, 쓰러짐은 투명해짐', () => {
  assert.ok(heroHurt(0).dx < -10 && heroHurt(0).tilt < -0.2)
  assert.ok(near(heroHurt(1).dx, 0) && near(heroHurt(1).tilt, 0))
  assert.equal(heroHurt(0.8).flash, false)
  assert.ok(enemyHit(0).dx > 10)
  assert.equal(enemyHit(0.9).flash, false)
  assert.ok(enemyDie(1).alpha < 0.4 && enemyDie(0).alpha === 1)
})

test('달리기: 두 다리가 반대 위상으로 번갈아 움직이고(legA=-legB), 주기적이며, 몸이 위아래로 출렁인다', () => {
  const T = (2 * Math.PI) / 11
  for (const t of [0.05, 0.13, 0.31, 0.77]) {
    const c = runCycle(t)
    assert.ok(near(c.legA, -c.legB, 1e-9))
    assert.ok(c.bob >= 0 && c.bob <= 3.01)
    assert.ok(Math.abs(c.legA) <= 0.35)
    assert.ok(near(runCycle(t + T).legA, c.legA, 1e-6))
  }
  const swing = Array.from({ length: 40 }, (_, i) => runCycle(i * 0.02).legA)
  assert.ok(Math.max(...swing) > 0.3 && Math.min(...swing) < -0.3, '다리가 앞뒤로 충분히 흔들림')
})

test('악당 대기: 숨 쉬듯 크기가 변한다', () => {
  const ys = Array.from({ length: 60 }, (_, i) => enemyIdle(i * 0.05).sy)
  assert.ok(Math.max(...ys) > 1.02 && Math.min(...ys) < 0.98)
})

test('무기 각도: 공격 때 젖혔다가(작아짐) 내려치고(커짐) 원래대로', () => {
  const idle = weaponAngle('idle', 0)
  assert.ok(weaponAngle('attack', 0.3) < idle - 0.5)
  assert.ok(weaponAngle('attack', 0.55) > idle + 0.4)
  assert.ok(near(weaponAngle('attack', 1), idle, 0.02))
})
