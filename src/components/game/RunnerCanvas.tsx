'use client'

import { useEffect, useRef } from 'react'
import { themeOf, isBossStage, enemyKeyFor, bossForm, TIERS } from '@/game/world'
import { loadHunterAssets, loadProgManifest, peekImage, gateArtFor, type HunterAssets, type HeroKey, type GateArt, type ProgManifest } from '@/game/assets'
import type { SfxName } from '@/game/sfx'
import { smooth, tinted, dimOf, type Drawable } from '@/game/sprites'
import {
  runCycle, idleBreath, heroAttack, heroHurt, heroCharge, enemyIdle, enemyCharge, enemyAttack, enemyHit, enemyDie, weaponAngle,
  HERO_ATTACK_S, HERO_HURT_S, ENEMY_ATTACK_S, ENEMY_HIT_S, IMPACT_AFTER_HERO_ATTACK_S, IMPACT_AFTER_ENEMY_ATTACK_S, clamp01,
} from '@/game/anim'

// resolving = 정답을 누른 직후의 긴장 틈(헌터·악당이 서로 기를 모으며 대치)
export type RunPhase = 'idle' | 'running' | 'question' | 'resolving' | 'feedback'

export interface Flash {
  kind: 'hit' | 'miss'
  nonce: number
  dmg?: string // 예: "+10 XP"
  crit?: boolean // 크리티컬 공격(미처리 오답을 맞힘)
  killedStage?: number // 이 공격으로 쓰러뜨린 몬스터의 스테이지(쓰러지는 장면을 그 몬스터 그림으로 보여준다)
}

interface Props {
  phase: RunPhase
  stage: number
  monsterHp: number
  monsterMax: number
  playerHp: number
  flash: Flash | null
  runMs: number // 문제 지점까지 달리는 시간
  onArrive: () => void
  critical?: boolean // 미처리 오답 문항 = 불시 공격(붉은 경고 연출)
  /** 대제목/소제목 푯말. gate=true 면 달리는 중 문(아치)이 다가와 캐릭터가 통과한다(소제목이 바뀔 때). */
  sign?: { section: string; topic: string | null; gate: boolean } | null
  hero?: HeroKey
  tier?: number // 성장 단계 1~5: 헌터 복장·무기·보스·보스 배경이 바뀐다
  pet?: string | null
  onSfx?: (name: SfxName) => void
}

const W = 360
const H = 220
const GROUND = 168
const PX = 70 // 헌터 위치
const EX = 270 // 악당 위치
const RUN_SPEED = 120

type HeroS = 'idle' | 'charge' | 'attack' | 'hurt'
type EnemyS = 'idle' | 'charge' | 'attack' | 'hit' | 'die'
interface Pop { x: number; y: number; text: string; color: string; t: number }
interface Coin { x: number; y: number; got: boolean }
interface Fx { kind: 'slash' | 'spark' | 'claw'; x: number; y: number; t0: number; dur: number; crit?: boolean }
interface World {
  scroll: number; t: number; runT: number; arrived: boolean; lastPhase: RunPhase | ''; lastFlash: number; gatePlayed: boolean
  hero: { s: HeroS; t0: number; crit: boolean }
  enemy: { s: EnemyS; t0: number }
  dying: { stage: number; t0: number } | null
  shake: number; redFlash: number
  coins: Coin[]; pops: Pop[]; fx: Fx[]
  queue: { at: number; fn: () => void }[]
  S: number // 기기 픽셀 / 논리 단위 (선명도)
}

/** 자동 달리기 + 대치 + 공격/피격 연출 화면. 학습 로직과 분리된 순수 연출. */
export default function RunnerCanvas(p: Props) {
  const cv = useRef<HTMLCanvasElement>(null)
  const props = useRef(p)
  useEffect(() => { props.current = p })
  const progRef = useRef<ProgManifest | null>(null)
  const assetsRef = useRef<HunterAssets | null>(null)

  const world = useRef<World>({
    scroll: 0, t: 0, runT: 0, arrived: false, lastPhase: '', lastFlash: -1, gatePlayed: false,
    hero: { s: 'idle', t0: 0, crit: false }, enemy: { s: 'idle', t0: 0 }, dying: null,
    shake: 0, redFlash: 0, coins: [], pops: [], fx: [], queue: [], S: 2,
  })

  useEffect(() => {
    const canvas = cv.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let alive = true
    const w = world.current
    loadHunterAssets().then(a => { if (alive) assetsRef.current = a })
    loadProgManifest().then(m => { if (alive) progRef.current = m })

    // 선명도: 캔버스 안쪽 해상도를 '실제로 화면에 보이는 크기 × 기기 배율'에 맞춘다(PC에서 작은 캔버스를 늘려 보이면 흐려짐).
    const fit = () => {
      const r = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      const cw = Math.max(1, Math.round(r.width * dpr))
      if (canvas.width !== cw) { canvas.width = cw; canvas.height = Math.round(cw * H / W) }
      w.S = canvas.width / W
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(canvas)

    let last = performance.now()
    const at = (delay: number, fn: () => void) => w.queue.push({ at: w.t + delay, fn })

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const pr = props.current
      w.t += dt
      w.queue = w.queue.filter(q => { if (q.at <= w.t) { q.fn(); return false } return true })

      // 단계 전환
      if (w.lastPhase !== pr.phase) {
        if (pr.phase === 'running') {
          w.runT = 0; w.arrived = false; w.gatePlayed = false
          w.coins = [0, 1, 2, 3].map(i => ({ x: W + 40 + i * 70, y: GROUND - 40, got: false }))
          w.hero = { s: 'idle', t0: w.t, crit: false }; w.enemy = { s: 'idle', t0: w.t }
        }
        if (pr.phase === 'question') { w.hero = { s: 'idle', t0: w.t, crit: false }; w.enemy = { s: 'idle', t0: w.t } }
        if (pr.phase === 'resolving') { w.hero = { s: 'charge', t0: w.t, crit: false }; w.enemy = { s: 'charge', t0: w.t } } // 대치
        w.lastPhase = pr.phase
      }

      // 결과 연출: 맞히면 헌터 공격 → (0.2초 뒤) 악당 피격, 틀리면 악당 공격 → (0.26초 뒤) 헌터 피격
      if (pr.flash && pr.flash.nonce !== w.lastFlash) {
        w.lastFlash = pr.flash.nonce
        const f = pr.flash
        if (f.kind === 'hit') {
          w.hero = { s: 'attack', t0: w.t, crit: !!f.crit }
          w.fx.push({ kind: 'slash', x: EX - 38, y: GROUND - 48, t0: w.t + 0.1, dur: 0.28, crit: f.crit })
          at(IMPACT_AFTER_HERO_ATTACK_S, () => {
            if (f.killedStage) { w.dying = { stage: f.killedStage, t0: w.t }; w.enemy = { s: 'die', t0: w.t } } else w.enemy = { s: 'hit', t0: w.t }
            w.fx.push({ kind: 'spark', x: EX - 20, y: GROUND - 45, t0: w.t, dur: 0.38, crit: f.crit })
            w.shake = f.crit ? 0.9 : 0.45
            if (f.crit) w.pops.push({ x: 190, y: 70, text: 'CRITICAL!', color: '#ea580c', t: 0 })
            if (f.dmg) w.pops.push({ x: 262, y: 96, text: f.dmg, color: '#16a34a', t: 0 })
          })
        } else {
          w.enemy = { s: 'attack', t0: w.t }
          at(IMPACT_AFTER_ENEMY_ATTACK_S, () => {
            w.hero = { s: 'hurt', t0: w.t, crit: false }
            w.fx.push({ kind: 'claw', x: PX + 6, y: GROUND - 44, t0: w.t, dur: 0.32 })
            w.shake = 1; w.redFlash = 1
            w.pops.push({ x: PX + 30, y: 84, text: f.dmg ?? '오답…', color: '#dc2626', t: 0 })
          })
        }
      }

      // 동작 상태 만료
      if (w.hero.s === 'attack' && w.t - w.hero.t0 > HERO_ATTACK_S) w.hero = { s: 'idle', t0: w.t, crit: false }
      if (w.hero.s === 'hurt' && w.t - w.hero.t0 > HERO_HURT_S) w.hero = { s: 'idle', t0: w.t, crit: false }
      if (w.enemy.s === 'attack' && w.t - w.enemy.t0 > ENEMY_ATTACK_S) w.enemy = { s: 'idle', t0: w.t }
      if (w.enemy.s === 'hit' && w.t - w.enemy.t0 > ENEMY_HIT_S) w.enemy = { s: 'idle', t0: w.t }
      if (w.dying && w.t - w.dying.t0 > 1.3) w.dying = null

      const running = pr.phase === 'running'
      if (running) {
        w.scroll += RUN_SPEED * dt
        w.runT += dt * 1000
        if (w.runT >= pr.runMs && !w.arrived) { w.arrived = true; pr.onArrive() }
        if (pr.sign?.gate && !w.gatePlayed && gateX(w.runT, pr.runMs) <= PX) { w.gatePlayed = true; pr.onSfx?.('gate') }
        w.coins.forEach(c => {
          c.x -= RUN_SPEED * dt
          if (!c.got && c.x < PX + 6) { c.got = true; w.pops.push({ x: PX + 8, y: GROUND - 64, text: '+1', color: '#ca8a04', t: 0 }); pr.onSfx?.('coin') }
        })
      }
      w.shake = Math.max(0, w.shake - dt * 3)
      w.redFlash = Math.max(0, w.redFlash - dt * 2.5)
      w.pops.forEach(q => { q.t += dt; q.y -= 24 * dt })
      w.pops = w.pops.filter(q => q.t < 1.1)
      w.fx = w.fx.filter(f => w.t - f.t0 < f.dur)

      fit()
      draw(ctx, pr, w, assetsRef.current, progRef.current)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return (
    <canvas
      ref={cv}
      style={{ width: '100%', aspectRatio: `${W} / ${H}`, display: 'block', borderRadius: 12 }}
      aria-label="달리는 수험생 캐릭터와 악당의 전투 화면"
    />
  )
}

/** 문(아치)의 화면 x: 달리는 동안 오른쪽에서 다가와 헌터 위를 지나 왼쪽으로 빠진다 */
const gateX = (runT: number, runMs: number) => W + 90 - clamp01(runT / runMs) * (W + 220)

function draw(ctx: CanvasRenderingContext2D, p: Props, w: World, A: HunterAssets | null, P: ProgManifest | null) {
  ctx.setTransform(w.S, 0, 0, w.S, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, W, H)
  const th = themeOf(p.stage)
  const tier = TIERS.find(t => t.tier === (p.tier ?? 1)) ?? TIERS[0]
  const sx = w.shake > 0 ? Math.sin(w.t * 90) * 3.5 * w.shake : 0
  const sy = w.shake > 0 ? Math.cos(w.t * 70) * 2 * w.shake : 0
  ctx.save()
  ctx.translate(sx, sy)

  // 배경 (보스 스테이지는 단계별 전용 배경)
  const bgKey = isBossStage(p.stage) && tier.bossBg ? tier.bossBg : th.bg
  const bgImg = A?.bg[bgKey]?.img ?? (P?.backgrounds[bgKey] ? peekImage(P.backgrounds[bgKey].src) : null) ?? A?.bg[th.bg]?.img
  if (A && bgImg) {
    ctx.drawImage(smooth(bgImg, W + 12, H, w.S), -6, 0, W + 12, H)
    ctx.fillStyle = 'rgba(255,255,255,0.5)' // 달리는 느낌: 도로 위 흐르는 점선
    for (let i = 0; i < 12; i++) { const x = ((i * 44 - (w.scroll % 44)) + 528) % 528 - 44; ctx.fillRect(x, H - 22, 24, 3) }
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, GROUND)
    g.addColorStop(0, th.sky[0]); g.addColorStop(1, th.sky[1])
    ctx.fillStyle = g; ctx.fillRect(-10, 0, W + 20, H)
    ctx.fillStyle = 'rgba(0,0,0,0.07)'
    for (let i = -1; i < 8; i++) { const x = ((i * 70 - (w.scroll * 0.25) % 70) + 70) % (W + 70) - 35; const hh = 40 + ((i * 37) % 5) * 12; ctx.fillRect(x, GROUND - hh - 20, 46, hh + 20) }
    ctx.fillStyle = th.ground; ctx.fillRect(-10, GROUND, W + 20, H - GROUND)
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    for (let i = 0; i < 12; i++) { const x = ((i * 40 - (w.scroll % 40)) + 480) % 480 - 40; ctx.fillRect(x, GROUND + 14, 22, 3) }
  }

  // 소제목 문: 사용자가 그린 문 그림에 소제목 이름을 붙여, 달리는 동안 헌터 위로 지나간다
  if (p.sign?.gate && p.phase === 'running') {
    const art = p.sign.topic && A ? gateArtFor(A.gates, p.sign.section, p.sign.topic) : undefined
    if (art && A) drawArtGate(ctx, gateX(w.runT, p.runMs), art, A.gates.displayHeight, w.S)
    else drawGate(ctx, gateX(w.runT, p.runMs), p.sign)
  }
  // 코인
  w.coins.forEach(c => { if (!c.got) { ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.arc(c.x, c.y, 6, 0, 7); ctx.fill(); ctx.strokeStyle = '#a16207'; ctx.stroke() } })

  // 악당(죽는 중이면 쓰러지는 몬스터 + 다음 몬스터가 서서히 등장)
  const resolving = p.phase === 'resolving'
  if (w.dying) {
    const dp = clamp01((w.t - w.dying.t0) / 0.9)
    drawEnemy(ctx, p, w, A, P, { stage: w.dying.stage, hp: 0, die: dp })
    const fadeIn = clamp01((w.t - (w.dying.t0 + 0.9)) / 0.4)
    if (fadeIn > 0) drawEnemy(ctx, p, w, A, P, { stage: p.stage, hp: p.monsterHp, alpha: fadeIn })
  } else drawEnemy(ctx, p, w, A, P, { stage: p.stage, hp: p.monsterHp })

  // 헌터(+펫+무기)
  drawHero(ctx, p, w, A, P, tier)

  // 효과: 베기 / 타격 불꽃 / 악당 발톱
  w.fx.forEach(f => drawFx(ctx, f, w.t))
  w.pops.forEach(q => { ctx.globalAlpha = Math.max(0, 1 - q.t / 1.1); ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.strokeText(q.text, q.x, q.y); ctx.fillStyle = q.color; ctx.fillText(q.text, q.x, q.y); ctx.globalAlpha = 1 })
  ctx.restore()

  // 맞았을 때 화면이 붉게, 대치 중에는 가장자리가 어두워지며 긴장감
  if (w.redFlash > 0) { ctx.fillStyle = `rgba(220,38,38,${w.redFlash * 0.28})`; ctx.fillRect(0, 0, W, H) }
  if (resolving) {
    const pulse = 0.18 + 0.1 * Math.sin(w.t * 14)
    const g = ctx.createRadialGradient(W / 2, H / 2, 70, W / 2, H / 2, 230)
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${pulse + 0.15})`)
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  }

  // HUD
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(8, 8, 108, 22)
  ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left'
  ctx.fillText(`STAGE ${p.stage} · ${th.name}`.slice(0, 14), 14, 23)
  for (let i = 0; i < 3; i++) { ctx.fillStyle = i < p.playerHp ? '#ef4444' : 'rgba(0,0,0,0.25)'; ctx.fillText('♥', 130 + i * 16, 24) }
  if (p.sign && p.phase !== 'idle' && !(p.sign.gate && p.phase === 'running')) drawPlate(ctx, p.sign)
  if (p.critical && (p.phase === 'running' || p.phase === 'question' || p.phase === 'resolving')) {
    const a = 0.25 + 0.2 * Math.sin(w.t * 8)
    ctx.strokeStyle = `rgba(220,38,38,${a + 0.3})`; ctx.lineWidth = 8; ctx.strokeRect(4, 4, W - 8, H - 8); ctx.lineWidth = 1
    ctx.fillStyle = 'rgba(220,38,38,0.9)'; ctx.fillRect(W - 134, 34, 124, 22)
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('⚠ 불시 공격!', W - 72, 50)
  }
}

// ───────────────────────── 효과
function drawFx(ctx: CanvasRenderingContext2D, f: Fx, t: number) {
  const k = (t - f.t0) / f.dur
  if (k < 0 || k > 1) return
  ctx.save()
  ctx.globalAlpha = 1 - k
  if (f.kind === 'slash') {
    ctx.strokeStyle = f.crit ? '#fb923c' : '#ffffff'; ctx.lineWidth = f.crit ? 9 : 5; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.arc(f.x, f.y, (f.crit ? 52 : 40) * (0.7 + 0.5 * k), -1.2, 0.2 + 1.2 * k); ctx.stroke()
  } else if (f.kind === 'spark') {
    ctx.strokeStyle = f.crit ? '#fbbf24' : '#fde68a'; ctx.lineWidth = f.crit ? 4 : 3; ctx.lineCap = 'round'
    const n = f.crit ? 12 : 8
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, r0 = 8 + 26 * k, r1 = r0 + (f.crit ? 16 : 11); ctx.beginPath(); ctx.moveTo(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0); ctx.lineTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1); ctx.stroke() }
  } else {
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 4; ctx.lineCap = 'round'
    for (let i = 0; i < 3; i++) { const o = (i - 1) * 13, grow = 28 * Math.min(1, k * 2.2); ctx.beginPath(); ctx.moveTo(f.x + 14 + o, f.y - 26); ctx.lineTo(f.x + 14 + o - 10 * Math.min(1, k * 2.2) - 4, f.y - 26 + grow); ctx.stroke() }
  }
  ctx.restore()
}

// ───────────────────────── 헌터
function drawPet(ctx: CanvasRenderingContext2D, x: number, y: number, p: Props, w: World, P: ProgManifest | null) {
  const def = p.pet ? P?.pets[p.pet] : undefined
  const img = def ? peekImage(def.src) : null
  if (!def || !img) return
  const h = H * def.heightInViewport
  const wd = h * img.naturalWidth / img.naturalHeight
  const excited = w.hero.s === 'attack' || w.hero.s === 'hurt'
  const hop = p.phase === 'running' ? Math.abs(Math.sin(w.t * 10 + 1)) * 4 : excited ? Math.abs(Math.sin(w.t * 16)) * 6 : Math.sin(w.t * 2) * 1
  const float = (def.floatY ?? 0) * H + (def.floatY ? Math.sin(w.t * 3) * 3 : 0)
  ctx.drawImage(smooth(img, wd, h, w.S), x - wd * def.anchor.x, y - float - hop - h * def.anchor.y, wd, h)
}

const HIP = 0.6 // 달리기 때 위·아래로 가르는 높이(허리)

/** 달리기: 윗몸(몸통·가방·팔)은 출렁이며 비틀고, 아랫몸은 좌우 다리를 번갈아 앞뒤로 흔든다 */
function drawRunBody(ctx: CanvasRenderingContext2D, d: Drawable, wd: number, h: number, ax: number, ay: number, t: number) {
  const c = runCycle(t)
  const [dw, dh] = dimOf(d)
  const left = -ax * wd, top = -ay * h
  const hipY = top + HIP * h
  const pivotX = left + wd * 0.5
  for (const half of [0, 1]) {
    ctx.save()
    ctx.translate(pivotX, hipY - c.bob * 0.4); ctx.rotate(half === 0 ? c.legA : c.legB); ctx.translate(-pivotX, -hipY)
    ctx.drawImage(d, half * dw * 0.5, HIP * dh, dw * 0.5, dh * (1 - HIP), left + half * wd * 0.5, hipY, wd * 0.5, h * (1 - HIP))
    ctx.restore()
  }
  ctx.save()
  ctx.translate(pivotX, hipY); ctx.rotate(c.twist); ctx.scale(1, c.squashY); ctx.translate(-pivotX, -hipY - c.bob)
  ctx.drawImage(d, 0, 0, dw, dh * (HIP + 0.03), left, top, wd, h * (HIP + 0.03))
  ctx.restore()
}

function drawHero(ctx: CanvasRenderingContext2D, p: Props, w: World, A: HunterAssets | null, P: ProgManifest | null, tier: (typeof TIERS)[number]) {
  const running = p.phase === 'running'
  const hs = w.hero.s
  const prog = clamp01((w.t - w.hero.t0) / (hs === 'attack' ? HERO_ATTACK_S : HERO_HURT_S))
  if (!A) { // 그림이 없을 때(도형 대체)
    drawPlayer(ctx, PX, GROUND, running, { t: w.t, atk: hs === 'attack' ? 1 - prog : 0, hurt: hs === 'hurt' ? 1 - prog : 0 })
    return
  }
  const heroKey = p.hero ?? 'male'
  // 동작별 변형
  let dx = 0, lean = 0, sy = 1, tilt = 0, bob = 0, flash = false
  if (hs === 'attack') { const a = heroAttack(prog); dx = a.dx; lean = a.lean; sy = a.sy }
  else if (hs === 'hurt') { const a = heroHurt(prog); dx = a.dx; tilt = a.tilt; sy = a.sy; flash = a.flash }
  else if (hs === 'charge') { const a = heroCharge(w.t); dx = a.dx; lean = a.lean; sy = a.sy }
  else if (running) { const a = runCycle(w.t); lean = a.lean; bob = a.bob }
  else { const a = idleBreath(w.t); bob = a.bob; sy = a.sy }
  const x = PX + dx

  drawPet(ctx, x - 44, GROUND, p, w, P)

  // 정예/전설 헌터(그림이 불러와졌을 때) 또는 기본 헌터
  let img: HTMLImageElement | null = null
  let heightPct = 0, ax = 0.5, ay = 0.97, hand: { x: number; y: number } | null = null
  const useProg = tier.heroSet !== 'starter' && !!P
  if (useProg) {
    const def = P!.characters[`${heroKey}-${tier.heroSet}-${hs === 'attack' ? 'attack' : 'ready'}`]
    const im = def ? peekImage(def.src) : null
    if (def && im) { img = im; heightPct = def.heightInViewport; ax = def.anchor.x; ay = def.anchor.y; hand = def.handGrip }
  }
  let heroRun = false
  if (!img) {
    const hero = A.hero[heroKey]
    img = hero.poses[hs === 'attack' ? 'attack' : running ? 'run' : 'idle']
    heightPct = hero.height; ax = hero.anchor.x; ay = hero.anchor.y
    heroRun = running && hs !== 'attack'
  } else heroRun = running && hs !== 'attack'

  const h = H * heightPct
  const wd = h * img.naturalWidth / img.naturalHeight
  let d: Drawable = smooth(img, wd, h, w.S)
  if (hs === 'hurt' && flash) d = tinted(d, '#ff2a2a', 0.6) // 피격: 붉게 번쩍
  ctx.save()
  ctx.translate(x, GROUND)
  ctx.rotate(lean + tilt)
  ctx.scale(1, sy)
  ctx.translate(0, -bob)
  // 무기: 손잡이 좌표에 맞춰 손에 쥐고(무기 → 헌터 순으로 겹침), 공격 땐 크게 휘두른다
  const weapon = useProg && tier.weapon ? P!.weapons[tier.weapon] : undefined
  const wImg = weapon ? peekImage(weapon.src) : null
  if (weapon && wImg && hand && useProg) {
    const ww = h * weapon.widthInHunterHeights
    const wh = ww * wImg.naturalHeight / wImg.naturalWidth
    const hx = (hand.x - ax) * wd, hy = (hand.y - ay) * h
    ctx.save()
    ctx.translate(hx, hy)
    ctx.rotate(weaponAngle(hs, prog))
    ctx.drawImage(smooth(wImg, ww, wh, w.S), -ww * weapon.grip.x, -wh * weapon.grip.y, ww, wh)
    ctx.restore()
  }
  if (heroRun) drawRunBody(ctx, d, wd, h, ax, ay, w.t)
  else ctx.drawImage(d, -wd * ax, -h * ay, wd, h)
  ctx.restore()
}

// ───────────────────────── 악당
function drawEnemy(ctx: CanvasRenderingContext2D, p: Props, w: World, A: HunterAssets | null, P: ProgManifest | null, o: { stage: number; hp: number; die?: number; alpha?: number }) {
  const key = bossForm(enemyKeyFor(o.stage, p.tier ?? 1), o.hp, p.monsterMax)
  let img: HTMLImageElement | null = null
  let height = 0, ax = 0.5, ay = 0.9625, floatY = 0
  const boss = P?.bosses[key]
  if (boss) { img = peekImage(boss.src); height = boss.heightInViewport; ax = boss.anchor.x; ay = boss.anchor.y }
  else if (A) { const e = A.enemies[key]; if (e) { img = e.img; height = e.height; ax = e.anchor.x; ay = e.anchor.y; floatY = e.floatY ?? 0 } }
  if (!img && A) { const e = A.enemies['inkBoss'] ?? A.enemies['inkSlime']; if (e) { img = e.img; height = e.height; ax = e.anchor.x; ay = e.anchor.y } }
  const es = o.die !== undefined ? 'die' : w.enemy.s
  const ep = clamp01((w.t - w.enemy.t0) / (es === 'attack' ? ENEMY_ATTACK_S : ENEMY_HIT_S))
  let dx = 0, rot = 0, sx = 1, sy = 1, alpha = o.alpha ?? 1, glow = 0, flash = false
  if (es === 'die') { const a = enemyDie(o.die ?? 0); dx = a.dx; rot = a.rot; sy = a.sy; alpha *= a.alpha }
  else if (es === 'hit') { const a = enemyHit(ep); dx = a.dx; rot = a.rot; sx = a.sx; sy = a.sy; flash = a.flash }
  else if (es === 'attack') { const a = enemyAttack(ep); dx = a.dx; rot = a.rot; sx = a.sx; sy = a.sy; glow = a.glow }
  else if (es === 'charge') { const a = enemyCharge(w.t); dx = a.dx; rot = a.rot; sx = a.sx; sy = a.sy }
  else { const a = enemyIdle(w.t); dx = a.dx; rot = a.rot; sx = a.sx; sy = a.sy }

  const float = floatY * H + (floatY ? Math.sin(w.t * 3) * 3 : 0)
  ctx.save()
  ctx.globalAlpha = alpha
  if (!img) { drawMonster(ctx, EX + dx, GROUND, p, { t: w.t, mHit: flash ? 1 : 0, mLunge: 0 }); ctx.restore(); return }
  const h = H * height
  const wd = h * img.naturalWidth / img.naturalHeight
  let d: Drawable = smooth(img, wd, h, w.S)
  if (flash) d = tinted(d, '#ffffff', 0.85) // 타격: 하얗게 번쩍
  else if (glow > 0.05) d = tinted(d, '#ff5a1f', glow) // 공격 직전: 붉은 기운
  ctx.translate(EX + dx, GROUND - float)
  ctx.rotate(rot)
  ctx.scale(sx, sy)
  ctx.drawImage(d, -wd * ax, -h * ay, wd, h)
  ctx.restore()
  // HP 바(쓰러지는 중이 아닐 때만)
  if (o.die === undefined) {
    const bw = isBossStage(o.stage) ? 90 : 60
    const top = Math.max(4, GROUND - float - h * ay - 12)
    ctx.save(); ctx.globalAlpha = alpha
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(EX - bw / 2, top, bw, 8)
    ctx.fillStyle = '#ef4444'; ctx.fillRect(EX - bw / 2, top, bw * Math.max(0, o.hp) / p.monsterMax, 8)
    ctx.restore()
  }
}

// ───────────────────────── 문 / 푯말
function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, bold: boolean) {
  let s = size
  for (; s >= 8; s--) { ctx.font = `${bold ? 'bold ' : ''}${s}px sans-serif`; if (ctx.measureText(text).width <= maxW) return text }
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1)
  return t + '…'
}

function drawPlate(ctx: CanvasRenderingContext2D, sign: { section: string; topic: string | null }) {
  const x = 8, y = 34, w = 168, h = sign.topic ? 36 : 22
  ctx.fillStyle = 'rgba(92,58,30,0.92)'; ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = '#3b2412'; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)
  ctx.textAlign = 'left'; ctx.fillStyle = '#f5deb3'
  ctx.fillText(fit(ctx, sign.section, w - 12, 9, false), x + 6, y + 13)
  if (sign.topic) { ctx.fillStyle = '#fff'; ctx.fillText(fit(ctx, '▸ ' + sign.topic, w - 12, 12, true), x + 6, y + 29) }
}

/** 그림 문 그림이 없을 때만 쓰는 나무 문(대체) */
function drawGate(ctx: CanvasRenderingContext2D, cx: number, sign: { section: string; topic: string | null }) {
  const bw = 150, top = GROUND - 124, bh = sign.topic ? 36 : 24
  ctx.fillStyle = '#7a5230'; ctx.fillRect(cx - bw / 2 + 6, top + bh, 8, GROUND - top - bh); ctx.fillRect(cx + bw / 2 - 14, top + bh, 8, GROUND - top - bh)
  ctx.fillStyle = '#5c3a1e'; ctx.fillRect(cx - bw / 2, top, bw, bh)
  ctx.strokeStyle = '#3b2412'; ctx.strokeRect(cx - bw / 2 + 0.5, top + 0.5, bw - 1, bh - 1)
  ctx.textAlign = 'center'; ctx.fillStyle = '#f5deb3'
  ctx.fillText(fit(ctx, sign.section, bw - 12, 9, false), cx, top + 13)
  if (sign.topic) { ctx.fillStyle = '#fff'; ctx.fillText(fit(ctx, '▸ ' + sign.topic, bw - 12, 12, true), cx, top + 29) }
  ctx.textAlign = 'left'
}

/** 사용자 제작 문 그림 + 소제목 이름(gate-manifest 의 labelBox/labelLines 규칙) */
function drawArtGate(ctx: CanvasRenderingContext2D, cx: number, g: GateArt, displayHeight: number, S: number) {
  const h = H * displayHeight
  const wd = h * g.img.naturalWidth / g.img.naturalHeight
  const x = cx - wd * g.anchor.x, y = GROUND - h * g.anchor.y
  ctx.drawImage(smooth(g.img, wd, h, S), x, y, wd, h)
  const b = g.labelBox
  const lx = x + wd * (b.x + b.width / 2), ly = y + h * (b.y + b.height / 2)
  const maxW = wd * b.width, maxH = h * b.height
  let size = Math.min(21, maxH / (g.labelLines.length * 1.16))
  const font = (s: number) => `800 ${s}px "Pretendard", "Noto Sans KR", "Malgun Gothic", sans-serif`
  ctx.save()
  ctx.font = font(size)
  const widest = Math.max(...g.labelLines.map(l => ctx.measureText(l).width))
  if (widest > maxW) { size *= maxW / widest; ctx.font = font(size) }
  ctx.fillStyle = '#251c16'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  g.labelLines.forEach((line, i) => ctx.fillText(line, lx, ly + (i - (g.labelLines.length - 1) / 2) * size * 1.12))
  ctx.restore()
}

// ───────────────────────── 그림 자료가 없을 때만 쓰는 도형 대체
function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, running: boolean, w: { t: number; atk: number; hurt: number }) {
  const swing = running ? Math.sin(w.t * 14) * 7 : 0
  const bob = running ? Math.abs(Math.sin(w.t * 14)) * 2 : 0
  ctx.save(); ctx.translate(x, y - bob)
  if (w.hurt > 0 && Math.floor(w.t * 20) % 2 === 0) ctx.globalAlpha = 0.5
  ctx.fillStyle = '#374151'; ctx.fillRect(-6 + swing * 0.6, -16, 6, 16); ctx.fillRect(2 - swing * 0.6, -16, 6, 16)
  ctx.fillStyle = '#d97706'; ctx.fillRect(-16, -42, 11, 24)
  ctx.fillStyle = '#3b82f6'; ctx.fillRect(-8, -44, 18, 30)
  ctx.fillStyle = '#fcd9b6'; ctx.beginPath(); ctx.arc(2, -54, 11, 0, 7); ctx.fill()
  ctx.fillStyle = '#4b3621'; ctx.beginPath(); ctx.arc(2, -57, 11, Math.PI, 0); ctx.fill()
  ctx.save(); ctx.translate(6, -36); ctx.rotate(w.atk > 0 ? -1.2 + (1 - w.atk) * 2.6 : -swing * 0.06)
  ctx.fillStyle = '#fcd9b6'; ctx.fillRect(0, -3, 14, 5); ctx.fillStyle = '#fbbf24'; ctx.fillRect(12, -4, 18, 4); ctx.fillStyle = '#ef4444'; ctx.fillRect(30, -4, 4, 4)
  ctx.restore(); ctx.restore()
}

function drawMonster(ctx: CanvasRenderingContext2D, x: number, y: number, p: Props, w: { t: number; mHit: number; mLunge: number }) {
  const boss = isBossStage(p.stage)
  const r = boss ? 34 : 22
  const squash = 1 + Math.sin(w.t * 4) * 0.05
  ctx.save(); ctx.translate(x, y)
  ctx.fillStyle = w.mHit > 0 ? '#fff' : boss ? '#7c3aed' : '#38bdf8'
  ctx.beginPath(); ctx.ellipse(0, -r * 0.8, r * 1.1, r * 0.9 * squash, 0, Math.PI, 0); ctx.lineTo(r * 1.1, 0); ctx.lineTo(-r * 1.1, 0); ctx.fill()
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-r * 0.4, -r * 0.7, 3, 0, 7); ctx.arc(r * 0.4, -r * 0.7, 3, 0, 7); ctx.fill()
  ctx.restore()
}
