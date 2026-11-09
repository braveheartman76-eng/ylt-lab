// 애니메이션 시간표(순수 계산, DOM 의존 없음). 그림 한 장을 변형해서 '다른 장면'을 만든다.
// 모든 함수의 p 는 0~1 진행도, t 는 초.

export const RESOLVE_MS = 700 // 정답을 누른 뒤 결과가 나오기 전의 긴장 틈(0.7초)
export const HERO_ATTACK_S = 0.5
export const ENEMY_ATTACK_S = 0.6
export const HERO_HURT_S = 0.55
export const ENEMY_HIT_S = 0.45
export const IMPACT_AFTER_HERO_ATTACK_S = 0.2 // 헌터가 휘두른 뒤 악당에게 맞는 순간
export const IMPACT_AFTER_ENEMY_ATTACK_S = 0.26 // 악당이 덮친 뒤 헌터가 맞는 순간

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const easeOut = (x: number) => 1 - (1 - clamp01(x)) * (1 - clamp01(x))
const lerp = (a: number, b: number, x: number) => a + (b - a) * clamp01(x)

/** 달리기: 몸 위아래 출렁임 + 앞으로 기울임 + 두 다리가 번갈아 앞뒤로(legA/legB, 라디안) */
export function runCycle(t: number) {
  const ph = t * 11
  const s = Math.sin(ph)
  return { bob: Math.abs(s) * 3, lean: 0.06 + 0.02 * Math.sin(ph * 2), legA: s * 0.34, legB: -s * 0.34, twist: Math.cos(ph) * 0.035, squashY: 1 - 0.03 * Math.abs(s) }
}

/** 숨쉬기(대기) */
export function idleBreath(t: number) {
  const s = Math.sin(t * 2.2)
  return { bob: s * 0.8, sy: 1 + 0.012 * s }
}

/** 헌터 공격: 뒤로 당김(0~0.3) → 앞으로 찌르며 돌진(0.3~0.55) → 복귀 */
export function heroAttack(p: number) {
  if (p < 0.3) return { dx: lerp(0, -7, easeOut(p / 0.3)), lean: lerp(0, -0.14, easeOut(p / 0.3)), sy: lerp(1, 0.97, p / 0.3) }
  if (p < 0.55) { const k = easeOut((p - 0.3) / 0.25); return { dx: lerp(-7, 36, k), lean: lerp(-0.14, 0.2, k), sy: lerp(0.97, 1.03, k) } }
  const k = easeOut((p - 0.55) / 0.45)
  return { dx: lerp(36, 0, k), lean: lerp(0.2, 0, k), sy: lerp(1.03, 1, k) }
}

/** 헌터 피격: 뒤로 튕겨 나가며 몸이 젖혀지고(붉게 번쩍) 천천히 복귀 */
export function heroHurt(p: number) {
  const k = easeOut(p)
  return { dx: lerp(-18, 0, k), tilt: lerp(-0.3, 0, k), sy: p < 0.15 ? 0.94 : 1, flash: p < 0.45 && Math.floor(p * 16) % 2 === 0 }
}

/** 기 모으기(대치): 헌터는 낮게 웅크리고, 악당은 뒤로 물러나며 떨린다 */
export function heroCharge(t: number) {
  return { dx: -3, lean: -0.1, sy: 0.96 + Math.sin(t * 18) * 0.008 }
}
export function enemyCharge(t: number) {
  return { dx: 6 + Math.sin(t * 30) * 1.5, rot: 0.1, sx: 1.04, sy: 0.95 + Math.sin(t * 20) * 0.01 }
}

/** 악당 대기: 숨 쉬듯 몸이 늘었다 줄었다, 좌우로 살짝 흔들림 */
export function enemyIdle(t: number) {
  const s = Math.sin(t * 2.6)
  return { dx: Math.sin(t * 1.3) * 1.5, sy: 1 + 0.035 * s, sx: 1 - 0.02 * s, rot: Math.sin(t * 1.7) * 0.02 }
}

/** 악당 공격: 뒤로 젖힘(0~0.35) → 헌터에게 덮침(0.35~0.6) → 복귀 */
export function enemyAttack(p: number) {
  if (p < 0.35) { const k = easeOut(p / 0.35); return { dx: lerp(0, 12, k), rot: lerp(0, 0.18, k), sx: lerp(1, 1.06, k), sy: lerp(1, 0.94, k), glow: k * 0.35 } }
  if (p < 0.6) { const k = easeOut((p - 0.35) / 0.25); return { dx: lerp(12, -78, k), rot: lerp(0.18, -0.28, k), sx: lerp(1.06, 0.96, k), sy: lerp(0.94, 1.06, k), glow: 0.35 } }
  const k = easeOut((p - 0.6) / 0.4)
  return { dx: lerp(-78, 0, k), rot: lerp(-0.28, 0, k), sx: lerp(0.96, 1, k), sy: lerp(1.06, 1, k), glow: lerp(0.35, 0, k) }
}

/** 악당 피격: 뒤로 밀려나며 기울고 하얗게 번쩍인다 */
export function enemyHit(p: number) {
  const k = easeOut(p)
  return { dx: lerp(16, 0, k), rot: lerp(0.2, 0, k), sx: p < 0.2 ? 0.94 : 1, sy: p < 0.2 ? 1.05 : 1, flash: p < 0.5 && Math.floor(p * 18) % 2 === 0 }
}

/** 쓰러짐: 서서히 투명해지며 가라앉는다 */
export function enemyDie(p: number) {
  const k = easeOut(p)
  return { dx: lerp(0, 18, k), rot: lerp(0, 0.5, k), alpha: lerp(1, 0.25, k), sy: lerp(1, 0.8, k) }
}

/** 무기 각도(라디안): 평소엔 살짝 들고, 공격 땐 크게 젖혔다가 내려친다 */
export function weaponAngle(state: 'idle' | 'charge' | 'attack' | 'hurt', p: number): number {
  if (state === 'charge') return -0.4
  if (state === 'hurt') return 0.2
  if (state !== 'attack') return -0.12
  if (p < 0.3) return lerp(-0.12, -0.95, easeOut(p / 0.3))
  if (p < 0.55) return lerp(-0.95, 0.4, easeOut((p - 0.3) / 0.25))
  return lerp(0.4, -0.12, easeOut((p - 0.55) / 0.45))
}
