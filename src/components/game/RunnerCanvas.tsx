'use client'

import { useEffect, useRef } from 'react'
import { themeOf, isBossStage } from '@/game/world'

export type RunPhase = 'idle' | 'running' | 'question' | 'feedback'

export interface Flash {
  kind: 'hit' | 'miss'
  nonce: number
  dmg?: string // 예: "+10 XP"
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
  speedLabel?: string
}

const W = 360
const H = 220
const GROUND = 168

interface Pop { x: number; y: number; text: string; color: string; t: number }
interface Obs { x: number; w: number; h: number; passed: boolean }
interface Coin { x: number; y: number; got: boolean }

/** 자동 이동 러닝 화면. 학습 로직과 분리된 순수 연출(캐릭터·몬스터는 임시 도안). 탭/스페이스로 점프. */
export default function RunnerCanvas(p: Props) {
  const cv = useRef<HTMLCanvasElement>(null)
  const props = useRef(p)
  useEffect(() => { props.current = p })

  const world = useRef<World>({
    scroll: 0, t: 0, runT: 0, arrived: false, lastPhase: '',
    py: 0, vy: 0, stumble: 0, atk: 0, hurt: 0, mHit: 0, mLunge: 0, shake: 0,
    obs: [], coins: [], pops: [], lastFlash: -1,
  })

  useEffect(() => {
    const canvas = cv.current!
    const ctx = canvas.getContext('2d')!
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = W * dpr
    canvas.height = H * dpr
    ctx.scale(dpr, dpr)
    let raf = 0
    let last = performance.now()
    const w = world.current

    const jump = () => { if (w.py === 0 && props.current.phase === 'running') w.vy = 7.2 }
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Space' && props.current.phase === 'running') { e.preventDefault(); jump() } }
    canvas.addEventListener('pointerdown', jump)
    window.addEventListener('keydown', onKey)

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const pr = props.current
      // 단계 전환 처리
      if (w.lastPhase !== pr.phase) {
        if (pr.phase === 'running') {
          w.runT = 0; w.arrived = false
          w.obs = [{ x: W + 60, w: 22, h: 20, passed: false }, { x: W + 260, w: 26, h: 24, passed: false }]
          w.coins = [0, 1, 2, 3].map(i => ({ x: W + 40 + i * 70, y: GROUND - 46 - (i % 2) * 16, got: false }))
        }
        w.lastPhase = pr.phase
      }
      if (pr.flash && pr.flash.nonce !== w.lastFlash) {
        w.lastFlash = pr.flash.nonce
        if (pr.flash.kind === 'hit') { w.atk = 1; w.mHit = 1 } else { w.mLunge = 1; w.hurt = 1; w.shake = 1 }
        if (pr.flash.dmg) w.pops.push({ x: 250, y: 90, text: pr.flash.dmg, color: pr.flash.kind === 'hit' ? '#16a34a' : '#dc2626', t: 0 })
      }
      w.t += dt
      const running = pr.phase === 'running'
      const speed = running ? (w.stumble > 0 ? 70 : 150) : 0
      if (running) {
        w.scroll += speed * dt
        w.runT += dt * 1000
        if (w.runT >= pr.runMs && !w.arrived) { w.arrived = true; pr.onArrive() }
        w.obs.forEach(o => { o.x -= speed * dt })
        w.coins.forEach(c => { c.x -= speed * dt })
      }
      // 점프
      if (w.py > 0 || w.vy > 0) { w.py = Math.max(0, w.py + w.vy * 60 * dt); w.vy -= 24 * dt * 1.0; if (w.py === 0) w.vy = 0 }
      // 충돌/코인
      const px = 70
      w.obs.forEach(o => {
        if (!o.passed && o.x < px + 10 && o.x + o.w > px - 10) { if (w.py < o.h - 4) { w.stumble = 0.6; o.passed = true } }
        if (o.x + o.w < px - 10) o.passed = true
      })
      w.coins.forEach(c => { if (!c.got && Math.abs(c.x - px) < 12 && Math.abs((GROUND - c.y) - w.py - 14) < 28) { c.got = true; w.pops.push({ x: px + 8, y: GROUND - 70, text: '+1', color: '#ca8a04', t: 0 }) } })
      w.stumble = Math.max(0, w.stumble - dt)
      w.atk = Math.max(0, w.atk - dt * 2.2)
      w.hurt = Math.max(0, w.hurt - dt * 2)
      w.mHit = Math.max(0, w.mHit - dt * 3)
      w.mLunge = Math.max(0, w.mLunge - dt * 1.8)
      w.shake = Math.max(0, w.shake - dt * 3)
      w.pops.forEach(q => { q.t += dt; q.y -= 24 * dt })
      w.pops = w.pops.filter(q => q.t < 1.1)

      draw(ctx, pr, w)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('pointerdown', jump)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <canvas
      ref={cv}
      style={{ width: '100%', aspectRatio: `${W} / ${H}`, display: 'block', borderRadius: 12, touchAction: 'manipulation' }}
      aria-label="달리는 수험생 캐릭터 화면. 화면을 탭하면 점프합니다."
    />
  )
}

function draw(ctx: CanvasRenderingContext2D, p: Props, w: World) {
  const th = themeOf(p.stage)
  const sx = w.shake > 0 ? Math.sin(w.t * 90) * 3 * w.shake : 0
  ctx.save()
  ctx.translate(sx, 0)
  const g = ctx.createLinearGradient(0, 0, 0, GROUND)
  g.addColorStop(0, th.sky[0]); g.addColorStop(1, th.sky[1])
  ctx.fillStyle = g; ctx.fillRect(-10, 0, W + 20, H)
  // 원경(건물 실루엣) 시차 스크롤
  ctx.fillStyle = 'rgba(0,0,0,0.07)'
  for (let i = -1; i < 8; i++) {
    const x = ((i * 70 - (w.scroll * 0.25) % 70) + 70) % (W + 70) - 35
    const hh = 40 + ((i * 37) % 5) * 12
    ctx.fillRect(x, GROUND - hh - 20, 46, hh + 20)
  }
  // 바닥
  ctx.fillStyle = th.ground; ctx.fillRect(-10, GROUND, W + 20, H - GROUND)
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  for (let i = 0; i < 12; i++) { const x = ((i * 40 - (w.scroll % 40)) + 480) % 480 - 40; ctx.fillRect(x, GROUND + 14, 22, 3) }
  // 장애물(택배 상자) · 코인
  w.obs.forEach(o => { ctx.fillStyle = '#b8864b'; ctx.fillRect(o.x, GROUND - o.h, o.w, o.h); ctx.fillStyle = '#8a6330'; ctx.fillRect(o.x + o.w / 2 - 1, GROUND - o.h, 2, o.h) })
  w.coins.forEach(c => { if (!c.got) { ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.arc(c.x, c.y, 6, 0, 7); ctx.fill(); ctx.strokeStyle = '#a16207'; ctx.stroke() } })
  // 몬스터
  drawMonster(ctx, 270, GROUND, p, w)
  // 플레이어
  const lunge = w.atk > 0 ? Math.sin((1 - w.atk) * Math.PI) * 60 : 0
  drawPlayer(ctx, 70 + lunge, GROUND - w.py, p.phase === 'running', w)
  // 슬래시
  if (w.atk > 0.2) {
    ctx.strokeStyle = `rgba(255,255,255,${w.atk})`; ctx.lineWidth = 5
    ctx.beginPath(); ctx.arc(190, GROUND - 40, 46, -1.1, 0.7); ctx.stroke(); ctx.lineWidth = 1
  }
  // 팝업
  w.pops.forEach(q => { ctx.globalAlpha = Math.max(0, 1 - q.t / 1.1); ctx.fillStyle = q.color; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(q.text, q.x, q.y); ctx.globalAlpha = 1 })
  ctx.restore()
  // HUD
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(8, 8, 108, 22)
  ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left'
  ctx.fillText(`STAGE ${p.stage} · ${th.name}`.slice(0, 14), 14, 23)
  for (let i = 0; i < 3; i++) { ctx.fillStyle = i < p.playerHp ? '#ef4444' : 'rgba(0,0,0,0.25)'; ctx.fillText('♥', 130 + i * 16, 24) }
  if (p.phase === 'running') { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(W - 128, 8, 120, 20); ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('탭하면 점프!', W - 68, 22) }
}
export type World = {
  scroll: number; t: number; runT: number; arrived: boolean; lastPhase: RunPhase | ''
  py: number; vy: number; stumble: number; atk: number; hurt: number; mHit: number; mLunge: number; shake: number
  obs: Obs[]; coins: Coin[]; pops: Pop[]; lastFlash: number
}

function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, running: boolean, w: World) {
  const swing = running ? Math.sin(w.t * 14) * 7 : 0
  const bob = running && w.py === 0 ? Math.abs(Math.sin(w.t * 14)) * 2 : 0
  ctx.save(); ctx.translate(x, y - bob)
  if (w.hurt > 0 && Math.floor(w.t * 20) % 2 === 0) ctx.globalAlpha = 0.5
  // 다리
  ctx.fillStyle = '#374151'; ctx.fillRect(-6 + swing * 0.6, -16, 6, 16); ctx.fillRect(2 - swing * 0.6, -16, 6, 16)
  // 가방 · 몸 · 머리
  ctx.fillStyle = '#d97706'; ctx.fillRect(-16, -42, 11, 24)
  ctx.fillStyle = '#3b82f6'; ctx.fillRect(-8, -44, 18, 30)
  ctx.fillStyle = '#fcd9b6'; ctx.beginPath(); ctx.arc(2, -54, 11, 0, 7); ctx.fill()
  ctx.fillStyle = '#4b3621'; ctx.beginPath(); ctx.arc(2, -57, 11, Math.PI, 0); ctx.fill()
  ctx.fillStyle = '#111'; ctx.fillRect(6, -55, 2, 3)
  // 팔 + 필기구(공격 시 휘두름)
  ctx.save(); ctx.translate(6, -36); ctx.rotate(w.atk > 0 ? -1.2 + (1 - w.atk) * 2.6 : -swing * 0.06)
  ctx.fillStyle = '#fcd9b6'; ctx.fillRect(0, -3, 14, 5)
  ctx.fillStyle = '#fbbf24'; ctx.fillRect(12, -4, 18, 4); ctx.fillStyle = '#ef4444'; ctx.fillRect(30, -4, 4, 4)
  ctx.restore(); ctx.restore()
}

function drawMonster(ctx: CanvasRenderingContext2D, x: number, y: number, p: Props, w: World) {
  const boss = isBossStage(p.stage)
  const r = boss ? 34 : 22
  const lunge = w.mLunge > 0 ? -Math.sin((1 - w.mLunge) * Math.PI) * 70 : 0
  const squash = 1 + Math.sin(w.t * 4) * 0.05
  ctx.save(); ctx.translate(x + lunge, y)
  if (p.monsterHp <= 0 && p.phase !== 'running') ctx.globalAlpha = 0.35
  ctx.fillStyle = w.mHit > 0 ? '#fff' : boss ? '#7c3aed' : '#38bdf8'
  ctx.beginPath(); ctx.ellipse(0, -r * 0.8, r * 1.1, r * 0.9 * squash, 0, Math.PI, 0); ctx.lineTo(r * 1.1, 0); ctx.lineTo(-r * 1.1, 0); ctx.fill()
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-r * 0.4, -r * 0.7, 3, 0, 7); ctx.arc(r * 0.4, -r * 0.7, 3, 0, 7); ctx.fill()
  if (boss) { ctx.fillStyle = '#fde047'; ctx.fillRect(-10, -r * 1.9, 20, 8); ctx.fillRect(-10, -r * 1.9 - 6, 4, 6); ctx.fillRect(-2, -r * 1.9 - 8, 4, 8); ctx.fillRect(6, -r * 1.9 - 6, 4, 6) }
  // HP 바
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-30, -r * 2.1 - 12, 60, 8)
  ctx.fillStyle = '#ef4444'; ctx.fillRect(-30, -r * 2.1 - 12, 60 * Math.max(0, p.monsterHp) / p.monsterMax, 8)
  ctx.restore()
}
