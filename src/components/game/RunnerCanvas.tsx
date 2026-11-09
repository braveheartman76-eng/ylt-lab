'use client'

import { useEffect, useRef } from 'react'
import { themeOf, isBossStage, enemyKeyFor, bossForm, TIERS } from '@/game/world'
import { loadHunterAssets, loadProgManifest, peekImage, type HunterAssets, type HeroKey, type GateArt, type ProgManifest } from '@/game/assets'
import type { SfxName } from '@/game/sfx'

export type RunPhase = 'idle' | 'running' | 'question' | 'feedback'

export interface Flash {
  kind: 'hit' | 'miss'
  nonce: number
  dmg?: string // 예: "+10 XP"
  crit?: boolean // 크리티컬 공격(미처리 오답을 맞힘)
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
  hero?: HeroKey // 남/여 헌터(그림 자료가 있을 때)
  tier?: number // 성장 단계 1~5: 헌터 복장·무기·보스·보스 배경이 바뀐다
  pet?: string | null // 따라다니는 펫 id
  onSfx?: (name: SfxName) => void // 효과음 신호(점프/부딪힘/코인/문 통과)
}

const W = 360
const H = 220
const GROUND = 168
// 점프: 공중 약 0.8초, 장애물을 넘을 수 있는 터치 타이밍 허용폭 약 0.4초(모바일에서 반응할 수 있게 넉넉히)
const JUMP_V = 6.5
const GRAVITY = 16
const RUN_SPEED = 120 // px/s (천천히: 모바일에서 반응할 시간 확보)
const OBSTACLE_ENTER_S = 1 // 첫 장애물이 화면 오른쪽 끝에 나타나는 시각(달리기 시작 후)

interface Pop { x: number; y: number; text: string; color: string; t: number }
interface Obs { x: number; w: number; h: number; passed: boolean; hit?: boolean; hitT?: number }
interface Coin { x: number; y: number; got: boolean }

/** 자동 이동 러닝 화면. 학습 로직과 분리된 순수 연출(캐릭터·몬스터는 임시 도안). 화면을 터치/스페이스로 점프. */
export default function RunnerCanvas(p: Props) {
  const cv = useRef<HTMLCanvasElement>(null)
  const props = useRef(p)
  useEffect(() => { props.current = p })
  const progRef = useRef<ProgManifest | null>(null) // 성장 팩 목록(작은 JSON). 이미지는 필요할 때만 불러온다.
  const assetsRef = useRef<HunterAssets | null>(null) // 사용자 제작 그림. 불러오기 전/실패 시 null → 도형 그림

  const world = useRef<World>({
    scroll: 0, t: 0, runT: 0, arrived: false, lastPhase: '',
    py: 0, vy: 0, crit: false, knock: 0, stumble: 0, atk: 0, hurt: 0, mHit: 0, mLunge: 0, shake: 0,
    obs: [], coins: [], pops: [], lastFlash: -1, gatePlayed: false,
  })

  useEffect(() => {
    const canvas = cv.current!
    const ctx = canvas.getContext('2d')!
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = W * dpr
    canvas.height = H * dpr
    ctx.scale(dpr, dpr)
    let raf = 0
    let alive = true
    loadHunterAssets().then(a => { if (alive) assetsRef.current = a })
    loadProgManifest().then(m => { if (alive) progRef.current = m })
    let last = performance.now()
    const w = world.current

    // 화면 아무 곳이나 터치하면 점프(엄지로 누르기 쉽게). 버튼·링크·탭 영역은 제외. 스페이스바도 지원.
    const jump = () => { if (w.py === 0 && w.vy === 0 && props.current.phase === 'running') { w.vy = JUMP_V; props.current.onSfx?.('jump') } }
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (t?.closest('button, a, input, label, nav, [role="tab"]')) return
      jump()
    }
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Space' && props.current.phase === 'running') { e.preventDefault(); jump() } }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const pr = props.current
      // 단계 전환 처리
      if (w.lastPhase !== pr.phase) {
        if (pr.phase === 'running') {
          w.runT = 0; w.arrived = false; w.gatePlayed = false
          // 장애물은 달리기 시작 후 1초 뒤에 화면에 들어온다(문제를 푼 직후엔 반응할 틈이 필요)
          w.obs = [{ x: W + RUN_SPEED * OBSTACLE_ENTER_S, w: 22, h: 20, passed: false }]
          w.coins = [0, 1, 2, 3].map(i => ({ x: W + 40 + i * 70, y: GROUND - 46 - (i % 2) * 16, got: false }))
        }
        w.lastPhase = pr.phase
      }
      if (pr.flash && pr.flash.nonce !== w.lastFlash) {
        w.lastFlash = pr.flash.nonce
        if (pr.flash.kind === 'hit') { w.atk = 1; w.mHit = 1; w.crit = !!pr.flash.crit } else { w.mLunge = 1; w.hurt = 1; w.shake = 1 }
        if (pr.flash.crit) w.pops.push({ x: 200, y: 70, text: 'CRITICAL!', color: '#ea580c', t: 0 })
        if (pr.flash.dmg) w.pops.push({ x: 250, y: 100, text: pr.flash.dmg, color: pr.flash.kind === 'hit' ? '#16a34a' : '#dc2626', t: 0 })
      }
      w.t += dt
      const running = pr.phase === 'running'
      const speed = running ? (w.stumble > 0 ? RUN_SPEED * 0.5 : RUN_SPEED) : 0
      if (running) {
        w.scroll += speed * dt
        w.runT += dt * 1000
        if (w.runT >= pr.runMs && !w.arrived) { w.arrived = true; pr.onArrive() }
        w.obs.forEach(o => { o.x -= speed * dt })
        // 단원 문이 캐릭터 위치를 지나는 순간 차임
        if (pr.sign?.gate && !w.gatePlayed && W + 90 - Math.min(1, w.runT / pr.runMs) * (W + 220) <= 70) { w.gatePlayed = true; pr.onSfx?.('gate') }
        w.coins.forEach(c => { c.x -= speed * dt })
      }
      // 점프 물리
      if (w.py > 0 || w.vy > 0) { w.py = Math.max(0, w.py + w.vy * 60 * dt); w.vy -= GRAVITY * dt; if (w.py === 0) w.vy = 0 }
      // 충돌/코인
      const px = 70
      w.obs.forEach(o => {
        if (o.hit) { o.hitT = (o.hitT ?? 0) + dt; return }
        if (!o.passed && o.x < px + 8 && o.x + o.w > px - 8 && w.py < o.h - 4) {
          // 부딪힘: 캐릭터가 뒤로 밀리고 깜빡이며 상자가 튕겨 나간다(학습 기록·보상에는 영향 없음)
          o.hit = true; o.hitT = 0; o.passed = true
          w.stumble = 0.8; w.knock = 1; w.hurt = 1
          w.pops.push({ x: px + 6, y: GROUND - 80, text: '쿵!', color: '#dc2626', t: 0 })
          pr.onSfx?.('hit')
        } else if (!o.passed && o.x + o.w < px - 10) {
          o.passed = true // 점프로 무사히 넘음
          w.pops.push({ x: px + 6, y: GROUND - 80, text: '점프 성공!', color: '#16a34a', t: 0 })
        }
      })
      w.coins.forEach(c => { if (!c.got && Math.abs(c.x - px) < 12 && Math.abs((GROUND - c.y) - w.py - 14) < 28) { c.got = true; w.pops.push({ x: px + 8, y: GROUND - 70, text: '+1', color: '#ca8a04', t: 0 }); pr.onSfx?.('coin') } })
      w.stumble = Math.max(0, w.stumble - dt)
      w.knock = Math.max(0, w.knock - dt * 2.5)
      w.atk = Math.max(0, w.atk - dt * 2.2)
      w.hurt = Math.max(0, w.hurt - dt * 2)
      w.mHit = Math.max(0, w.mHit - dt * 3)
      w.mLunge = Math.max(0, w.mLunge - dt * 1.8)
      w.shake = Math.max(0, w.shake - dt * 3)
      w.pops.forEach(q => { q.t += dt; q.y -= 24 * dt })
      w.pops = w.pops.filter(q => q.t < 1.1)

      draw(ctx, pr, w, assetsRef.current, progRef.current)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <canvas
      ref={cv}
      style={{ width: '100%', aspectRatio: `${W} / ${H}`, display: 'block', borderRadius: 12, touchAction: 'manipulation' }}
      aria-label="달리는 수험생 캐릭터 화면. 화면을 터치하면 점프합니다."
    />
  )
}

function draw(ctx: CanvasRenderingContext2D, p: Props, w: World, A: HunterAssets | null, P: ProgManifest | null) {
  const th = themeOf(p.stage)
  const sx = w.shake > 0 ? Math.sin(w.t * 90) * 3 * w.shake : 0
  ctx.save()
  ctx.translate(sx, 0)
  const tier = TIERS.find(t => t.tier === (p.tier ?? 1)) ?? TIERS[0]
  const bgKey = isBossStage(p.stage) && tier.bossBg ? tier.bossBg : th.bg // 보스 스테이지는 단계별 전용 배경
  const bgImg = A?.bg[bgKey]?.img ?? (P?.backgrounds[bgKey] ? peekImage(P.backgrounds[bgKey].src) : null) ?? A?.bg[th.bg]?.img
  if (A && bgImg) {
    // 사용자 제작 배경(1104×674 → 캔버스와 같은 비율). 정지 그림이라 달리는 느낌은 도로 위 흐르는 점선으로 준다.
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bgImg, -6, 0, W + 12, H)
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    for (let i = 0; i < 12; i++) { const x = ((i * 44 - (w.scroll % 44)) + 528) % 528 - 44; ctx.fillRect(x, H - 22, 24, 3) }
  } else {
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
  }
  // 소제목 문(아치): 달리는 동안 오른쪽에서 다가와 캐릭터 머리 위로 지나간다(플레이어보다 뒤에 그림)
  if (p.sign?.gate && p.phase === 'running') {
    const prog = Math.min(1, w.runT / p.runMs)
    const art = p.sign.topic ? A?.gates.byTitle.get(p.sign.topic) : undefined
    const gx = W + 90 - prog * (W + 220)
    if (art && A) drawArtGate(ctx, gx, art, A.gates.displayHeight)
    else drawGate(ctx, gx, p.sign)
  }
  // 장애물(택배 상자) · 코인
  w.obs.forEach(o => {
    ctx.save()
    if (o.hit) { const t = o.hitT ?? 0; ctx.translate(o.x + o.w / 2 + t * 110, GROUND - o.h / 2 - t * 90 + t * t * 260); ctx.rotate(t * 7); ctx.globalAlpha = Math.max(0, 1 - t * 1.2); ctx.translate(-o.w / 2, -o.h / 2) }
    else ctx.translate(o.x, GROUND - o.h)
    ctx.fillStyle = '#b8864b'; ctx.fillRect(0, 0, o.w, o.h); ctx.fillStyle = '#8a6330'; ctx.fillRect(o.w / 2 - 1, 0, 2, o.h)
    ctx.restore()
  })
  w.coins.forEach(c => { if (!c.got) { ctx.fillStyle = '#facc15'; ctx.beginPath(); ctx.arc(c.x, c.y, 6, 0, 7); ctx.fill(); ctx.strokeStyle = '#a16207'; ctx.stroke() } })
  // 몬스터
  if (A) drawEnemyArt(ctx, 270, GROUND, p, w, A, P)
  else drawMonster(ctx, 270, GROUND, p, w)
  // 플레이어
  const lunge = w.atk > 0 ? Math.sin((1 - w.atk) * Math.PI) * 60 : 0
  if (A) drawHeroArt(ctx, 70 + lunge - w.knock * 16, GROUND - w.py, p, w, A, P)
  else drawPlayer(ctx, 70 + lunge - w.knock * 16, GROUND - w.py, p.phase === 'running', w)
  // 슬래시
  if (w.atk > 0.2) {
    ctx.strokeStyle = w.crit ? `rgba(251,146,60,${w.atk})` : `rgba(255,255,255,${w.atk})`; ctx.lineWidth = w.crit ? 10 : 5
    ctx.beginPath(); ctx.arc(190, GROUND - 40, w.crit ? 62 : 46, -1.1, 0.7); ctx.stroke(); ctx.lineWidth = 1
  }
  // 팝업
  w.pops.forEach(q => { ctx.globalAlpha = Math.max(0, 1 - q.t / 1.1); ctx.fillStyle = q.color; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(q.text, q.x, q.y); ctx.globalAlpha = 1 })
  ctx.restore()
  // HUD
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(8, 8, 108, 22)
  ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'left'
  ctx.fillText(`STAGE ${p.stage} · ${th.name}`.slice(0, 14), 14, 23)
  for (let i = 0; i < 3; i++) { ctx.fillStyle = i < p.playerHp ? '#ef4444' : 'rgba(0,0,0,0.25)'; ctx.fillText('♥', 130 + i * 16, 24) }
  if (p.phase === 'running') { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(W - 138, 8, 130, 20); ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('화면 터치 = 점프!', W - 73, 22) }
  // 푯말(고정): 지금 풀고 있는 대제목 / 소제목
  if (p.sign && p.phase !== 'idle' && !(p.sign.gate && p.phase === 'running')) drawPlate(ctx, p.sign)
  if (p.critical && (p.phase === 'running' || p.phase === 'question')) {
    // 불시 공격: 붉은 테두리가 깜빡이고 경고 문구 표시
    const a = 0.25 + 0.2 * Math.sin(w.t * 8)
    ctx.strokeStyle = `rgba(220,38,38,${a + 0.3})`; ctx.lineWidth = 8; ctx.strokeRect(4, 4, W - 8, H - 8); ctx.lineWidth = 1
    ctx.fillStyle = 'rgba(220,38,38,0.9)'; ctx.fillRect(W - 134, 34, 124, 22)
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('⚠ 불시 공격!', W - 72, 50)
  }
}
export type World = {
  scroll: number; t: number; runT: number; arrived: boolean; lastPhase: RunPhase | ''
  py: number; vy: number; crit: boolean; knock: number; stumble: number; atk: number; hurt: number; mHit: number; mLunge: number; shake: number
  obs: Obs[]; coins: Coin[]; pops: Pop[]; lastFlash: number; gatePlayed: boolean
}

/** 글자를 maxW 안에 맞춘다: 글자 크기를 줄이다가 그래도 넘치면 말줄임. */
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

function drawGate(ctx: CanvasRenderingContext2D, cx: number, sign: { section: string; topic: string | null }) {
  const bw = 150, top = GROUND - 124, bh = sign.topic ? 36 : 24
  // 기둥 2개 + 목재 간판. 캐릭터 머리(약 66px)보다 높게 달아서 아래로 지나간다.
  ctx.fillStyle = '#7a5230'; ctx.fillRect(cx - bw / 2 + 6, top + bh, 8, GROUND - top - bh); ctx.fillRect(cx + bw / 2 - 14, top + bh, 8, GROUND - top - bh)
  ctx.fillStyle = '#5c3a1e'; ctx.fillRect(cx - bw / 2, top, bw, bh)
  ctx.strokeStyle = '#3b2412'; ctx.strokeRect(cx - bw / 2 + 0.5, top + 0.5, bw - 1, bh - 1)
  ctx.textAlign = 'center'; ctx.fillStyle = '#f5deb3'
  ctx.fillText(fit(ctx, sign.section, bw - 12, 9, false), cx, top + 13)
  if (sign.topic) { ctx.fillStyle = '#fff'; ctx.fillText(fit(ctx, '▸ ' + sign.topic, bw - 12, 12, true), cx, top + 29) }
  ctx.textAlign = 'left'
}

/** 사용자 제작 문 그림 + 간판 글자(gate-manifest 의 labelBox/labelLines 규칙). */
function drawArtGate(ctx: CanvasRenderingContext2D, cx: number, g: GateArt, displayHeight: number) {
  const h = H * displayHeight
  const wd = h * g.img.naturalWidth / g.img.naturalHeight
  const x = cx - wd * g.anchor.x, y = GROUND - h * g.anchor.y
  ctx.drawImage(g.img, x, y, wd, h)
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

/** 따라다니는 펫: 헌터 뒤에서 통통 따라온다. floatY 가 있는 펫(부엉이·까마귀 등)은 공중에 띄운다. */
function drawPet(ctx: CanvasRenderingContext2D, x: number, y: number, p: Props, w: World, P: ProgManifest | null) {
  const def = p.pet ? P?.pets[p.pet] : undefined
  const img = def ? peekImage(def.src) : null
  if (!def || !img) return
  const h = H * def.heightInViewport
  const wd = h * img.naturalWidth / img.naturalHeight
  const hop = p.phase === 'running' ? Math.abs(Math.sin(w.t * 10 + 1)) * 4 : Math.sin(w.t * 2) * 1
  const float = (def.floatY ?? 0) * H + (def.floatY ? Math.sin(w.t * 3) * 3 : 0)
  ctx.drawImage(img, x - wd * def.anchor.x, y - float - hop - h * def.anchor.y, wd, h)
}

function drawHeroArt(ctx: CanvasRenderingContext2D, x: number, y: number, p: Props, w: World, A: HunterAssets, P: ProgManifest | null) {
  const heroKey = p.hero ?? 'male'
  const tier = TIERS.find(t => t.tier === (p.tier ?? 1)) ?? TIERS[0]
  const attacking = w.atk > 0.05
  const running = p.phase === 'running'
  const bob = running && w.py === 0 ? Math.abs(Math.sin(w.t * 12)) * 3 : 0
  // 펫은 헌터 뒤(왼쪽)에 먼저 그린다
  drawPet(ctx, x - 44, y, p, w, P)

  // 정예/전설 헌터 + 무기(손잡이 좌표에 맞춰 그린다). 그림이 아직 안 불러와졌으면 기본 헌터로 대체.
  if (tier.heroSet !== 'starter' && P) {
    const def = P.characters[`${heroKey}-${tier.heroSet}-${attacking ? 'attack' : 'ready'}`]
    const img = def ? peekImage(def.src) : null
    if (def && img) {
      const h = H * def.heightInViewport
      const wd = h * img.naturalWidth / img.naturalHeight
      const left = x - wd * def.anchor.x, top = y - bob - h * def.anchor.y
      const weapon = tier.weapon ? P.weapons[tier.weapon] : undefined
      const wImg = weapon ? peekImage(weapon.src) : null
      ctx.save()
      if (w.hurt > 0 && Math.floor(w.t * 20) % 2 === 0) ctx.globalAlpha = 0.45
      if (running) { ctx.translate(x, y); ctx.rotate(0.05); ctx.translate(-x, -y) } // 달리기 프레임이 없어 살짝 앞으로 기울인다
      if (weapon && wImg) {
        const ww = h * weapon.widthInHunterHeights
        const wh = ww * wImg.naturalHeight / wImg.naturalWidth
        const hx = left + wd * def.handGrip.x, hy = top + h * def.handGrip.y
        ctx.save()
        ctx.translate(hx, hy)
        ctx.rotate(attacking ? -0.45 + (1 - w.atk) * 0.7 : -0.12) // 손잡이를 축으로 휘두른다
        ctx.drawImage(wImg, -ww * weapon.grip.x, -wh * weapon.grip.y, ww, wh)
        ctx.restore()
      }
      ctx.drawImage(img, left, top, wd, h) // 주먹이 손잡이를 가리도록 무기 위에 헌터를 그린다
      ctx.restore()
      return
    }
  }

  const hero = A.hero[heroKey]
  const pose = attacking ? 'attack' : running ? 'run' : 'idle'
  const img = hero.poses[pose]
  const h = H * hero.height
  const wd = h * img.naturalWidth / img.naturalHeight
  ctx.save()
  if (w.hurt > 0 && Math.floor(w.t * 20) % 2 === 0) ctx.globalAlpha = 0.45
  ctx.drawImage(img, x - wd * hero.anchor.x, y - bob - h * hero.anchor.y, wd, h)
  ctx.restore()
}

function drawEnemyArt(ctx: CanvasRenderingContext2D, x: number, y: number, p: Props, w: World, A: HunterAssets, P: ProgManifest | null) {
  const key = bossForm(enemyKeyFor(p.stage, p.tier ?? 1), p.monsterHp, p.monsterMax)
  // 상위 보스(성장 팩)는 progression manifest, 기본 몬스터/잉크 보스는 기본 팩
  let img: HTMLImageElement | null = null
  let height = 0, ax = 0.5, ay = 0.9625, floatY = 0
  const boss = P?.bosses[key]
  if (boss) { img = peekImage(boss.src); height = boss.heightInViewport; ax = boss.anchor.x; ay = boss.anchor.y }
  else { const e = A.enemies[key]; if (e) { img = e.img; height = e.height; ax = e.anchor.x; ay = e.anchor.y; floatY = e.floatY ?? 0 } }
  if (!img) { const e = A.enemies['inkBoss'] ?? A.enemies['inkSlime']; if (!e) return drawMonster(ctx, x, y, p, w); img = e.img; height = e.height; ax = e.anchor.x; ay = e.anchor.y }
  const h = H * height
  const wd = h * img.naturalWidth / img.naturalHeight
  const lunge = w.mLunge > 0 ? -Math.sin((1 - w.mLunge) * Math.PI) * 70 : 0
  const float = floatY * H + (floatY ? Math.sin(w.t * 3) * 3 : 0)
  const shake = w.mHit > 0 ? Math.sin(w.t * 80) * 3 * w.mHit : 0
  ctx.save()
  if (p.monsterHp <= 0 && p.phase !== 'running') ctx.globalAlpha = 0.35
  else if (w.mHit > 0 && Math.floor(w.t * 30) % 2 === 0) ctx.globalAlpha = 0.6
  const top = y - float - h * ay
  ctx.drawImage(img, x + lunge + shake - wd * ax, top, wd, h)
  ctx.globalAlpha = 1
  // HP 바(보스는 더 넓게)
  const bw = isBossStage(p.stage) ? 90 : 60
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - bw / 2, Math.max(4, top - 12), bw, 8)
  ctx.fillStyle = '#ef4444'; ctx.fillRect(x - bw / 2, Math.max(4, top - 12), bw * Math.max(0, p.monsterHp) / p.monsterMax, 8)
  ctx.restore()
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
