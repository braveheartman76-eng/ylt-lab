'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import RunnerCanvas, { type Flash, type RunPhase } from './RunnerCanvas'
import { applyAttempt, isDue, isOpenWrong, levelFromXp, CLEAR_STREAK } from '@/game/engine/srs'
import { pickNext, type PickKind } from '@/game/engine/picker'
import { recommend, unitStats } from '@/game/engine/stats'
import type { Attempt, GameQuestion } from '@/game/engine/types'
import { emptyGame, loadGame, saveGame, type SavedGame } from '@/game/store'
import { speak, stopSpeaking, ttsSupported, unlockTts, readable } from '@/game/tts'
import { configureSfx, playSfx, unlockSfx, startBgm, stopBgm } from '@/game/sfx'
import { RESOLVE_MS } from '@/game/anim'
import { buildParts, firstPart, nextPart, type Part } from '@/game/engine/parts'
import { loadProgManifest, type ProgManifest } from '@/game/assets'
import { ITEMS, MAX_HP, MAX_PLAYER_HP, SCORE_BOSS_KILL, SCORE_KILL, SCORE_PICKUP, TIERS, addScore, dropFor, isBossStage, nextTier, roomName, stageHp, themeOf, tierOf, toNextLife, unlockedPets } from '@/game/world'

type Tab = 'play' | 'review' | 'report' | 'room'
type Kind = PickKind | 'part'
const KIND_LABEL: Record<Kind, string> = { critical: '⚠ 불시 공격 · 미처리 오답', review: '복습', new: '새 문제', challenge: '도전', any: '장기 확인', part: '파트 진행' }
const PART_AUTO_MS = 1500 // 파트 자동진행: 정답/오답 연출을 보여 준 뒤 다음 문제로

interface PartItem { q: GameQuestion; selected: string; correct: boolean }
interface PartResult { part: Part; items: PartItem[]; notes: string[]; next: Part | null }

interface Feedback {
  correct: boolean
  answer: string
  explanation: string
  xp: number
  coins: number
  nextText: string
  drop?: string
  cleared?: boolean
  crit?: boolean
  growth?: string // 레벨 업 / 성장 단계 상승 안내
  points?: number // 악당 처치 점수
}

export default function GameClient() {
  const [game, setGame] = useState<SavedGame>(emptyGame)
  const [loaded, setLoaded] = useState(false)
  const [questions, setQuestions] = useState<GameQuestion[]>([])
  const [dataInfo, setDataInfo] = useState('')
  const [tab, setTab] = useState<Tab>('play')
  const [phase, setPhase] = useState<RunPhase>('idle')
  const [current, setCurrent] = useState<{ q: GameQuestion; kind: Kind } | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [monsterHp, setMonsterHp] = useState(stageHp(1))
  const [prog, setProg] = useState<ProgManifest | null>(null)
  const [runMs, setRunMs] = useState(3800) // 문제 지점까지 달리는 시간
  const [toast, setToast] = useState<string | null>(null)
  const [partRun, setPartRun] = useState<{ part: Part; idx: number } | null>(null) // 한 파트씩 자동진행 중
  const [partLog, setPartLog] = useState<PartItem[]>([])
  const [partNotes, setPartNotes] = useState<string[]>([])
  const [partResult, setPartResult] = useState<PartResult | null>(null)
  const [onlyWrong, setOnlyWrong] = useState(false)
  const [reviewOnly, setReviewOnly] = useState(false)
  const [focusUnit, setFocusUnit] = useState<string | undefined>()
  const [startedAt, setStartedAt] = useState(0)
  const [resolving, setResolving] = useState<{ sel: string; tapAt: number } | null>(null) // 정답을 누른 뒤 결과 전의 긴장 틈
  const [now, setNow] = useState(() => Date.now())
  const [recent, setRecent] = useState<string[]>([])
  const [lastTopic, setLastTopic] = useState('')
  const [gate, setGate] = useState(false)
  const [served, setServed] = useState(0) // 이번 접속에서 출제한 수(처음 몇 문제는 미처리 오답을 먼저 낸다)

  // 저장된 진행 + 문제 데이터 불러오기 (로컬 모드)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const saved = loadGame()
      let url = '/game-data/questions.local.json'
      let res = await fetch(url).catch(() => null)
      if (!res || !res.ok) { url = '/game-data/questions.sample.json'; res = await fetch(url).catch(() => null) }
      const data = res && res.ok ? await res.json().catch(() => null) : null
      if (cancelled) return
      setGame(saved)
      setMonsterHp(stageHp(saved.stage))
      setLoaded(true)
      if (data?.questions) {
        setQuestions(data.questions)
        setDataInfo(url.includes('local') ? '내 변환 문항(검수 전)' : '테스트 샘플 문항')
      }
    })()
    return () => { cancelled = true }
  }, [])
  useEffect(() => { if (loaded) saveGame(game) }, [game, loaded])
  useEffect(() => { configureSfx(game.sfx) }, [game.sfx])
  useEffect(() => { if (game.sfx.enabled && game.sfx.bgm && phase !== 'idle') startBgm(); else stopBgm() }, [game.sfx, phase])
  useEffect(() => () => stopBgm(), [])
  useEffect(() => { loadProgManifest().then(setProg) }, [])
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id) }, [])
  useEffect(() => { if (!toast) return; const id = window.setTimeout(() => setToast(null), 2600); return () => window.clearTimeout(id) }, [toast])

  const dueCount = useMemo(() => questions.filter(q => game.schedules[q.id] && isDue(game.schedules[q.id], now)).length, [questions, game.schedules, now])
  const openCount = useMemo(() => questions.filter(q => isOpenWrong(game.schedules[q.id])).length, [questions, game.schedules])
  const lv = levelFromXp(game.xp)
  const th = themeOf(game.stage)
  const tier = tierOf(lv.level)
  const nt = nextTier(tier.tier)
  const petsOpen = unlockedPets(tier.tier)
  const pet = game.pet && petsOpen.includes(game.pet) ? game.pet : petsOpen[0]
  const parts = useMemo(() => buildParts(questions), [questions])

  // 문제 하나를 내보낸다(달려가서 문 → 문제). gate: 소제목이 바뀔 때만(파트의 첫 문제는 항상) 문을 지난다.
  const serve = useCallback((q: GameQuestion, kind: Kind, o: { runMs: number; forceGate?: boolean }) => {
    const key = `${q.section ?? q.unitTitle}|${q.topic ?? ''}`
    setGate(o.forceGate ?? key !== lastTopic)
    setLastTopic(key)
    setRunMs(o.runMs)
    setCurrent({ q, kind })
    if (kind === 'critical') playSfx('ambush')
    setFeedback(null)
    setPhase('running')
  }, [lastTopic])

  // 한 문제씩 모드(그리고 복습/집중훈련): 학습 엔진이 다음 문제를 고른다
  const nextRun = useCallback((o?: { review: boolean; unit?: string }) => {
    stopSpeaking() // 해설을 읽던 중이면 멈추고 다음으로
    const ro = o ? o.review : reviewOnly
    const unit = o ? o.unit : focusUnit
    const sv = o ? 0 : served // start 로 새로 접속한 경우 0부터
    const p = pickNext(questions, game.schedules, { now: Date.now(), attempts: game.attempts, recentIds: recent, reviewOnly: ro, unitId: unit, forceCritical: sv < 3 })
    if (!p) { setCurrent(null); setPhase('idle'); return }
    setServed(sv + 1)
    serve(p.question, p.kind, { runMs: 3800 })
  }, [questions, game.schedules, game.attempts, recent, reviewOnly, focusUnit, served, serve])

  // 한 파트씩 자동진행: 파트(같은 소제목)의 문제를 책 순서대로 쭉 낸다
  const servePart = useCallback((r: { part: Part; idx: number }) => {
    stopSpeaking()
    serve(r.part.questions[r.idx], 'part', { runMs: r.idx === 0 ? 3000 : 1700, forceGate: r.idx === 0 })
  }, [serve])

  const startPart = useCallback((part: Part | null) => {
    if (!part) { setPhase('idle'); setCurrent(null); return }
    setLastTopic('')
    setPartLog([]); setPartNotes([]); setPartResult(null)
    const r = { part, idx: 0 }
    setPartRun(r)
    servePart(r)
  }, [servePart])

  // 파트 끝: 오답 여부와 해설을 한 번에 보여 준다
  const finishPart = useCallback(() => {
    if (!partRun) return
    setPartResult({ part: partRun.part, items: partLog, notes: partNotes, next: nextPart(parts, partRun.part.key) })
    setPartRun(null)
    setCurrent(null)
    setFeedback(null)
    setPhase('feedback') // 장면은 그대로 두고 결과 화면을 띄운다
    playSfx(partLog.every(i => i.correct) ? 'clear' : 'coin')
  }, [partRun, partLog, partNotes, parts])

  const partAdvance = useCallback(() => {
    if (!partRun) return
    if (partRun.idx + 1 < partRun.part.questions.length) {
      const r = { ...partRun, idx: partRun.idx + 1 }
      setPartRun(r)
      servePart(r)
    } else finishPart()
  }, [partRun, servePart, finishPart])

  const arrive = useCallback(() => {
    setPhase('question')
    setStartedAt(Date.now())
    setNow(Date.now())
    const c = current
    if (c) speak(readable([c.q.statement, ...(c.q.bogi ?? []).map(b => `${b.label}. ${b.text}`), ...(c.q.choices ?? []).map(x => `${x.no}번. ${x.text}`)].join(' ')), game.tts)
  }, [current, game.tts])

  // 결과 확정(긴장 틈 RESOLVE_MS 뒤에 실행): 채점·복습 예약·보상·연출. 풀이 시각/소요시간은 '누른 순간'(tapAt) 기준.
  const commitAnswer = useCallback((sel: string, tapAt: number) => {
    if (!current) return
    const q = current.q
    const t = tapAt
    const correct = sel === q.answer
    const g = game
    const r = applyAttempt(g.schedules[q.id], q.id, correct, t, q.difficulty)
    const attempt: Attempt = {
      id: `${t}-${Math.random().toString(36).slice(2, 8)}`, questionId: q.id, unitId: q.unitId, at: t, selected: sel, isCorrect: correct,
      elapsedMs: t - startedAt, attemptNo: r.state.attemptCount, wasReview: r.wasReview, isFirst: r.isFirst, boxAfter: r.state.box,
    }
    const stage = g.stage
    const lvBefore = levelFromXp(g.xp).level
    let kills = g.stageKills, items = g.items, coins = g.coins + r.reward.coins
    let hp = g.hp, mhp = monsterHp, drop: string | undefined, cleared = false
    let killPts = 0
    if (correct) {
      mhp = monsterHp - (current.kind === 'critical' ? 2 : 1) // 크리티컬(미처리 오답을 맞힘)은 2배 피해
      kills += 1
      if (mhp <= 0) {
        const it = dropFor(stage, items)
        if (it) { items = [...items, it.id]; drop = `${it.emoji} ${it.name}` } else coins += 20
        if (isBossStage(stage)) coins += 30 // 보스 처치 보너스
        killPts = isBossStage(stage) ? SCORE_BOSS_KILL : SCORE_KILL
        cleared = true
      }
    } else {
      hp = g.hp - 1
      if (hp <= 0) hp = MAX_PLAYER_HP // 체력이 0이 되면 게임오버 없이 재정비(오답은 모두 기록됨)
    }
    // 악당 처치 점수 → 일정 점수마다 생명 보너스
    const sc = addScore({ score: g.score, lifeAwards: g.lifeAwards, hp, coins }, killPts)
    hp = sc.hp; coins = sc.coins
    const sched = { ...g.schedules, [q.id]: r.state }
    const next: SavedGame = { ...g, schedules: sched, attempts: [...g.attempts, attempt], xp: g.xp + r.reward.xp, coins, stage, stageKills: kills, items, score: sc.score, lifeAwards: sc.lifeAwards, hp }
    if (cleared) { next.stage = stage + 1; next.stageKills = 0 }
    setGame(next)
    setNow(t)
    setFlash({ kind: correct ? 'hit' : 'miss', nonce: Date.now(), killedStage: cleared ? stage : undefined, crit: correct && current.kind === 'critical', dmg: correct ? (r.reward.xp ? `+${r.reward.xp} XP` : '정답!') : '오답…' })
    setMonsterHp(cleared ? stageHp(stage + 1) : mhp)
    if (sc.lives) { window.setTimeout(() => { playSfx('life'); setToast(`❤ 생명 +${sc.lives} (점수 ${sc.score})`) }, cleared ? 1300 : 700) }
    setRecent(r => [q.id, ...r].slice(0, 3))
    const mins = Math.round((r.state.nextReviewAt - t) / 60000)
    const wasOpen = isOpenWrong(g.schedules[q.id])
    const nowOpen = isOpenWrong(r.state)
    const baseText = mins < 120 ? `${mins}분 뒤 다시 확인해요` : mins < 2880 ? '내일 다시 나와요' : `${Math.round(mins / 1440)}일 뒤 다시 나와요`
    const exp = q.explanation ?? ''
    // 레벨 업 / 성장 단계 상승(펫·무기·보스가 바뀐다)
    const lvAfter = levelFromXp(next.xp).level
    const tBefore = tierOf(lvBefore), tAfter = tierOf(lvAfter)
    let growth: string | undefined
    if (tAfter.tier > tBefore.tier) {
      const petNames = tAfter.pets.map(id => prog?.pets[id]?.title ?? id).join(', ')
      const wName = tAfter.weapon ? (prog?.weapons[tAfter.weapon]?.title ?? tAfter.weapon) : null
      growth = `성장 단계 상승! 「${tAfter.title}」 헌터 (Lv.${lvAfter})${petNames ? ` · 새 펫: ${petNames}` : ''}${wName ? ` · 새 무기: ${wName}` : ''}`
    } else if (lvAfter > lvBefore) growth = `레벨 업! Lv.${lvAfter}`
    // 소리 타이밍: 맞히면 휘두름 → 0.2초 뒤 명중(임팩트), 틀리면 악당이 덮침 → 0.26초 뒤 내가 맞음 (화면 연출과 같은 시간표)
    if (correct) {
      playSfx('attack')
      window.setTimeout(() => playSfx(current.kind === 'critical' ? 'critical' : 'correct'), 200)
    } else {
      playSfx('enemyAttack')
      window.setTimeout(() => playSfx('hit'), 260)
      window.setTimeout(() => playSfx('wrong'), 340)
    }
    if (cleared) window.setTimeout(() => playSfx('clear'), 900)
    if (growth) window.setTimeout(() => playSfx('levelup'), cleared ? 1700 : 1100)
    const fb: Feedback = { correct, points: killPts, answer: q.type === 'ox' ? q.answer : `${q.answer}번`, explanation: exp, xp: r.reward.xp, coins: r.reward.coins, nextText: nowOpen ? `미처리 오답 · 연속 정답 ${r.state.streak}/${CLEAR_STREAK} — 처리될 때까지 접속할 때마다 나와요` : wasOpen ? `오답 처리 완료! · ${baseText}` : baseText, drop, cleared, crit: correct && current.kind === 'critical', growth }
    setFeedback(fb)
    setPhase('feedback')
    if (current.kind === 'part') {
      // 한 파트씩 자동진행: 해설은 읽지 않고 기록만 해 두었다가 파트 끝에서 한꺼번에 보여 준다
      setPartLog(prev => [...prev, { q, selected: sel, correct }])
      if (growth) setPartNotes(prev => [...prev, growth])
    } else {
      // 한 문제씩: 판정 → 해설 전체를 끝까지 읽어 준다(다음 문제로 자동으로 넘어가지 않음)
      speak(`${correct ? '정답입니다.' : `오답입니다. 정답은 ${fb.answer}.`} ${growth ? growth + '.' : ''} ${readable(exp)}`, g.tts)
    }
  }, [current, monsterHp, game, startedAt, prog])

  // 정답을 누르면: 선택음 + 대치(긴장) → 0.7초 뒤 결과(맞히면 공격, 틀리면 공격받음)
  const answer = useCallback((sel: string) => {
    if (phase !== 'question' || !current) return
    setResolving({ sel, tapAt: Date.now() })
    setPhase('resolving')
    playSfx('select')
    window.setTimeout(() => playSfx('tension'), 70)
  }, [phase, current])
  useEffect(() => {
    if (!resolving) return
    const id = window.setTimeout(() => { commitAnswer(resolving.sel, resolving.tapAt); setResolving(null) }, RESOLVE_MS)
    return () => window.clearTimeout(id)
  }, [resolving, commitAnswer])

  // 키보드: O/X, 1~4
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (phase !== 'question' || !current) return
      const k = e.key.toUpperCase()
      if (current.q.type === 'ox' && (k === 'O' || k === 'X')) answer(k)
      if (current.q.type === 'mcq' && ['1', '2', '3', '4'].includes(k)) answer(k)
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [phase, current, answer])
  // 한 파트씩 자동진행에서만: 정답/오답 연출을 보여 준 뒤 자동으로 다음 문제(마지막이면 파트 결과).
  // 한 문제씩 모드는 자동으로 넘어가지 않고 '다음 문제' 버튼을 눌러야 한다(해설을 끝까지 읽을 수 있게).
  useEffect(() => {
    if (phase !== 'feedback' || !feedback || current?.kind !== 'part' || !partRun) return
    const id = window.setTimeout(partAdvance, PART_AUTO_MS)
    return () => window.clearTimeout(id)
  }, [phase, feedback, current, partRun, partAdvance])
  useEffect(() => () => { stopSpeaking() }, [])

  const start = (opts: { review?: boolean; unit?: string }) => {
    unlockTts()
    unlockSfx() // 모바일: 첫 터치에서 오디오 잠금 해제
    setReviewOnly(!!opts.review)
    setFocusUnit(opts.unit)
    setTab('play')
    setPartResult(null)
    if (game.mode === 'part' && !opts.review && !opts.unit) {
      setPartRun(null)
      startPart(firstPart(parts, game.schedules, Date.now()))
    } else {
      setPartRun(null)
      nextRun({ review: !!opts.review, unit: opts.unit })
    }
  }

  // 달리다 간식을 먹으면 점수(+생명 보너스)
  const onPickup = () => {
    const r = addScore({ score: game.score, lifeAwards: game.lifeAwards, hp: game.hp, coins: game.coins }, SCORE_PICKUP)
    setGame(g => ({ ...g, score: r.score, lifeAwards: r.lifeAwards, hp: r.hp, coins: r.coins }))
    if (r.lives) { playSfx('life'); setToast(`❤ 생명 +${r.lives} (간식 점수 보너스!)`) }
  }

  const stats = useMemo(() => unitStats(game.attempts, questions, game.schedules), [game.attempts, questions, game.schedules])
  const advice = useMemo(() => recommend(stats), [stats])
  const total = game.attempts.length
  const correctN = game.attempts.filter(a => a.isCorrect).length
  const firstA = game.attempts.filter(a => a.isFirst)
  const wrongDocs = Object.values(game.schedules).filter(s => s.wrongCount > 0).length

  if (!loaded) return <div className="min-h-full bg-[#eef3f8] p-6 text-sm text-gray-500">불러오는 중…</div>

  const q = current?.q
  return (
    // 게임은 SiteChrome 이 사이트 헤더/사이드바를 그리지 않으므로(모바일 폭 확보) 본문 전체를 쓴다.
    <div className="min-h-full bg-[#eef3f8]">
    <div className="mx-auto max-w-xl p-3 pb-10 select-none">
      <Link href="/" className="mb-1 inline-block text-[11px] text-gray-500 underline">← 연구실 사이트로</Link>
      <header className="mb-2 flex items-center justify-between rounded-xl bg-white px-3 py-2 shadow-sm">
        <div>
          <div className="text-sm font-bold">노량진 형사법 헌터</div>
          <div className="text-[11px] text-gray-500">{dataInfo} · {questions.length}문항{!questions.length && ' (없음)'}</div>
        </div>
        <div className="text-right text-xs">
          <div className="font-bold text-blue-700">Lv.{lv.level} <span className="text-gray-400">({lv.into}/{lv.need})</span></div>
          <div>🪙 {game.coins} · 미처리 오답 <b className={openCount ? 'text-rose-600' : ''}>{openCount}</b></div>
          <div className="text-[11px] text-gray-500">⭐ {game.score}점 · 다음 ❤ 까지 {toNextLife(game.score)}점</div>
        </div>
      </header>

      <nav className="mb-2 grid grid-cols-4 gap-1 text-sm" role="tablist">
        {([['play', '게임'], ['review', `오답${openCount ? ` ${openCount}` : ''}`], ['report', '리포트'], ['room', '내 방']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-lg py-2 font-medium ${tab === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}>{label}</button>
        ))}
      </nav>

      {tab === 'play' && (
        <section>
          {toast && <div className="mb-2 rounded-lg bg-pink-100 px-3 py-2 text-center text-sm font-bold text-pink-700">{toast}</div>}
          <div className="relative">
            <RunnerCanvas phase={phase} stage={game.stage} monsterHp={monsterHp} monsterMax={stageHp(game.stage)} playerHp={game.hp} maxHp={MAX_HP} flash={flash}
              runMs={runMs} onArrive={arrive} onPickup={onPickup} hero={game.hero} tier={tier.tier} pet={pet} onSfx={playSfx} sign={current ? { section: current.q.section ?? current.q.unitTitle, topic: current.q.topic ?? null, gate } : null} critical={current?.kind === 'critical' && (phase === 'running' || phase === 'question' || phase === 'resolving')} />
            {phase === 'idle' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/45 p-4 text-center text-white">
                <div className="text-lg font-bold">노량진역에 도착했습니다</div>
                <div className="text-xs">STAGE {game.stage} · {th.name}{isBossStage(game.stage) ? ' · 보스' : ''}</div>
                {openCount > 0 && <div className="rounded bg-rose-600/90 px-3 py-1 text-xs font-bold">⚠ 미처리 오답 {openCount}개가 불시 공격으로 먼저 나옵니다</div>}
                {questions.length ? (
                  <button onClick={() => start({})} className="mt-1 rounded-full bg-yellow-400 px-6 py-3 text-base font-bold text-black">공부 시작</button>
                ) : <div className="text-sm">문제 데이터가 없습니다 (public/game-data)</div>}
              </div>
            )}
          </div>

          {current && phase !== 'idle' && (
            <div className="mt-2 rounded-xl bg-white p-3 shadow-sm">
              <div className="mb-1 flex items-start justify-between gap-2 text-[11px] text-gray-500">
                <span className="shrink-0 whitespace-nowrap rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">{current.kind === 'part' && partRun ? `파트 ${partRun.idx + 1}/${partRun.part.questions.length}` : KIND_LABEL[current.kind]}</span>
                <span className="line-clamp-2 text-right">{q!.unitTitle}{q!.isTestData ? ' · 테스트' : ''}{q!.derivedFrom ? ' · 선지 변형' : ''}</span>
              </div>
              {phase === 'running' && <div className="py-6 text-center text-sm text-gray-500">{current.kind === 'critical' ? '⚠ 불시 공격이 다가온다! ' : ''}다음 문제로 달리는 중…</div>}
              {(phase === 'question' || phase === 'resolving' || phase === 'feedback') && (
                <div>
                  <p className="whitespace-pre-wrap text-[15px] font-semibold leading-relaxed">{q!.statement}</p>
                  {q!.sourceNote && <p className="mt-1 text-[11px] text-gray-400">출제 정보: {q!.sourceNote}</p>}
                  {q!.stemNote && <p className="mt-1 text-[11px] text-gray-400">{q!.stemNote.split('\n')[0]}</p>}
                  {q!.bogi && <ul className="mt-2 space-y-1 rounded-lg bg-gray-50 p-2 text-[13px]">{q!.bogi.map(b => <li key={b.label}><b>{b.label}</b> {b.text}</li>)}</ul>}
                  <div className={`mt-3 ${q!.type === 'ox' ? 'grid grid-cols-2 gap-3' : 'space-y-2'}`}>
                    {q!.type === 'ox'
                      ? (['O', 'X'] as const).map(v => (
                        <button key={v} disabled={phase !== 'question'} onClick={() => answer(v)}
                          className={`rounded-xl py-4 text-3xl font-black disabled:opacity-60 ${v === 'O' ? 'bg-blue-500 text-white' : 'bg-rose-500 text-white'} ${feedback && v === q!.answer ? 'ring-4 ring-yellow-300' : ''} ${resolving?.sel === v ? 'scale-95 ring-4 ring-white brightness-110' : resolving ? 'opacity-40' : ''}`}>{v}</button>))
                      : q!.choices!.map(c => (
                        <button key={c.no} disabled={phase !== 'question'} onClick={() => answer(c.no)}
                          className={`w-full rounded-xl border px-3 py-3 text-left text-[14px] leading-snug disabled:opacity-80 ${feedback && c.no === q!.answer ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 bg-white'} ${resolving?.sel === c.no ? 'scale-[0.98] border-blue-500 bg-blue-50 ring-2 ring-blue-400' : resolving ? 'opacity-40' : ''}`}>
                          <b className="mr-1">{c.no}</b>{c.text}</button>))}
                  </div>
                </div>
              )}
              {phase === 'feedback' && feedback && current.kind === 'part' && (
                // 한 파트씩 자동진행: 정답/오답만 알려 주고 자동으로 다음 문제로 (해설은 파트 끝에서 한꺼번에)
                <div className={`mt-3 rounded-lg p-3 text-center text-sm font-bold ${feedback.correct ? 'bg-green-50 text-green-700' : 'bg-rose-50 text-rose-700'}`}>
                  {feedback.correct ? '⭕ 정답!' : '❌ 오답'} <span className="ml-1 text-[11px] font-normal text-gray-500">{partRun && partRun.idx + 1 < partRun.part.questions.length ? '다음 문제로 이동…' : '파트 끝! 결과를 모아 보여 드려요…'}</span>
                  {feedback.points ? <span className="ml-2 text-[12px] text-blue-700">악당 처치 +{feedback.points}점</span> : null}
                </div>
              )}
              {phase === 'feedback' && feedback && current.kind !== 'part' && (
                // 한 문제씩: 판정 → 해설(끝까지 읽어 줌) → '다음 문제'를 눌러야 달려간다
                <div className={`mt-3 rounded-lg p-3 text-sm ${feedback.correct ? 'bg-green-50' : 'bg-rose-50'}`}>
                  <div className="font-bold">{feedback.crit ? '크리티컬! 정답 ' : ''}{feedback.correct ? (feedback.crit ? '' : '정답!') : `오답 · 정답은 ${feedback.answer}`}
                    {feedback.xp > 0 && <span className="ml-2 text-green-700">+{feedback.xp}XP +{feedback.coins}🪙</span>}
                    {feedback.points ? <span className="ml-2 text-blue-700">악당 처치 +{feedback.points}점</span> : null}</div>
                  {feedback.explanation && <p className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-gray-700">{feedback.explanation}</p>}
                  <div className="mt-1 text-[11px] text-gray-500">{feedback.nextText}</div>
                  {feedback.growth && <div className="mt-1 rounded bg-amber-100 px-2 py-1 text-[12px] font-bold text-amber-900">🎉 {feedback.growth}</div>}
                  {feedback.cleared && <div className="mt-1 font-bold text-blue-700">스테이지 클리어! {feedback.drop ? `획득: ${feedback.drop}` : '+20🪙'}</div>}
                  <div className="mt-2 flex gap-2">
                    {ttsSupported() && <button onClick={() => speak(`${feedback.correct ? '정답입니다.' : `오답입니다. 정답은 ${feedback.answer}.`} ${readable(feedback.explanation)}`, { enabled: true, rate: game.tts.rate })} className="shrink-0 rounded-lg bg-white px-3 py-2 text-[13px] ring-1 ring-gray-300">🔊 해설 듣기</button>}
                    <button onClick={() => nextRun()} className="flex-1 rounded-lg bg-gray-800 py-2 font-bold text-white">다음 문제 ▶</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 한 파트씩 자동진행: 파트 결과(오답 여부 + 해설을 한 번에) */}
          {partResult && (
            <div className="mt-2 rounded-xl bg-white p-3 shadow-sm">
              <div className="text-base font-bold">📋 파트 결과 · {partResult.part.title}</div>
              <div className="mt-1 text-[12px] text-gray-500">{partResult.part.section}</div>
              {(() => {
                const ok = partResult.items.filter(i => i.correct).length, n = partResult.items.length
                return (
                  <div className="mt-2 flex items-center gap-2 text-sm">
                    <span className="rounded-full bg-green-100 px-3 py-1 font-bold text-green-700">정답 {ok}</span>
                    <span className="rounded-full bg-rose-100 px-3 py-1 font-bold text-rose-700">오답 {n - ok}</span>
                    <span className="text-[12px] text-gray-500">/ {n}문제</span>
                    <button onClick={() => setOnlyWrong(v => !v)} className="ml-auto rounded bg-gray-100 px-2 py-1 text-[11px]">{onlyWrong ? '전체 보기' : '틀린 것만 보기'}</button>
                  </div>
                )
              })()}
              {partResult.notes.map((n, i) => <div key={i} className="mt-2 rounded bg-amber-100 px-2 py-1 text-[12px] font-bold text-amber-900">🎉 {n}</div>)}
              <ul className="mt-3 space-y-3">
                {partResult.items.map((it, i) => ({ it, i })).filter(x => !onlyWrong || !x.it.correct).map(({ it, i }) => (
                  <li key={it.q.id + i} className={`rounded-lg border p-3 ${it.correct ? 'border-green-200 bg-green-50/40' : 'border-rose-300 bg-rose-50/60'}`}>
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 text-base">{it.correct ? '⭕' : '❌'}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-gray-400">{i + 1}번{it.q.sourceNote ? ` · ${it.q.sourceNote}` : ''}</div>
                        <p className="whitespace-pre-wrap text-[13px] font-semibold leading-relaxed">{it.q.statement}</p>
                        <div className="mt-1 text-[12px]">
                          내 답 <b>{it.q.type === 'ox' ? it.selected : `${it.selected}번`}</b> · 정답 <b className="text-blue-700">{it.q.type === 'ox' ? it.q.answer : `${it.q.answer}번`}</b>
                        </div>
                        {it.q.explanation && <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-gray-700">{it.q.explanation}</p>}
                        {ttsSupported() && <button onClick={() => speak(`${it.correct ? '정답' : '오답'}. 정답은 ${it.q.type === 'ox' ? it.q.answer : `${it.q.answer}번`}. ${readable(it.q.explanation ?? '')}`, { enabled: true, rate: game.tts.rate })} className="mt-1 rounded bg-white px-2 py-1 text-[11px] ring-1 ring-gray-300">🔊 해설 듣기</button>}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <button onClick={() => { stopSpeaking(); setPartResult(null); setPhase('idle') }} className="rounded-lg bg-gray-200 px-3 py-3 text-sm">그만하기</button>
                <button onClick={() => { stopSpeaking(); startPart(partResult.part) }} className="rounded-lg bg-white px-3 py-3 text-sm ring-1 ring-gray-300">이 파트 다시</button>
                {partResult.next
                  ? <button onClick={() => { stopSpeaking(); startPart(partResult.next) }} className="flex-1 rounded-lg bg-blue-600 py-3 text-sm font-bold text-white">다음 파트로 ▶ <span className="font-normal opacity-80">{partResult.next.title}</span></button>
                  : <div className="flex-1 rounded-lg bg-green-100 py-3 text-center text-sm font-bold text-green-700">모든 파트를 끝냈어요! 🎉</div>}
              </div>
            </div>
          )}

          {/* 시작 전: 진행 방식 선택 + 헌터 선택 */}
          {phase === 'idle' && !partResult && questions.length > 0 && (
            <div className="mt-2 rounded-xl bg-white p-3 shadow-sm">
              <div className="text-sm font-bold">진행 방식 선택</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {([['single', '한 문제씩', '풀 때마다 정답·해설을 보고, “다음 문제”를 눌러야 달려가요.'], ['part', '한 파트씩 자동진행', '정답·오답만 체크하며 파트(목차) 끝까지 쭉 달리고, 끝에서 오답과 해설을 한꺼번에 봐요.']] as const).map(([k, title, desc]) => (
                  <button key={k} onClick={() => setGame(g => ({ ...g, mode: k }))} aria-pressed={game.mode === k}
                    className={`rounded-xl border-2 p-3 text-left ${game.mode === k ? 'border-blue-600 bg-blue-50' : 'border-gray-200 bg-white'}`}>
                    <div className="text-[14px] font-bold">{game.mode === k ? '✅ ' : ''}{title}</div>
                    <div className="mt-1 text-[11px] leading-snug text-gray-500">{desc}</div>
                  </button>))}
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs">
                <span className="text-gray-500">헌터</span>
                {(['male', 'female'] as const).map(hk => (
                  <button key={hk} onClick={() => setGame(g => ({ ...g, hero: hk }))}
                    className={`rounded-full px-3 py-1 font-bold ${game.hero === hk ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{hk === 'male' ? '남자 헌터' : '여자 헌터'}</button>))}
                <span className="ml-auto text-[11px] text-gray-400">{game.mode === 'part' ? `파트 ${parts.length}개` : ''}</span>
              </div>
            </div>
          )}
          {phase === 'idle' && !questions.length ? null : phase === 'idle' && current === null && game.attempts.length > 0 && (
            <p className="mt-2 text-center text-sm text-gray-500">{reviewOnly ? '지금은 복습할 문제가 없어요.' : '출제할 문제가 없습니다.'}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-white px-3 py-2 text-xs shadow-sm [&_label]:whitespace-nowrap">
            <label className="flex items-center gap-1"><input type="checkbox" checked={game.tts.enabled} disabled={!ttsSupported()}
              onChange={e => { if (e.target.checked) unlockTts(); else stopSpeaking(); setGame(g => ({ ...g, tts: { ...g.tts, enabled: e.target.checked } })) }} /> 음성 읽기{!ttsSupported() && ' (미지원)'}</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={game.sfx.enabled}
              onChange={e => { if (e.target.checked) unlockSfx(); setGame(g => ({ ...g, sfx: { ...g.sfx, enabled: e.target.checked } })); if (e.target.checked) window.setTimeout(() => playSfx('coin'), 50) }} /> 효과음</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={!!game.sfx.bgm} disabled={!game.sfx.enabled}
              onChange={e => { if (e.target.checked) unlockSfx(); setGame(g => ({ ...g, sfx: { ...g.sfx, bgm: e.target.checked } })) }} /> 배경음악</label>
            <label className="flex items-center gap-1">속도 <input type="range" className="w-24" min={0.7} max={1.5} step={0.1} value={game.tts.rate}
              onChange={e => setGame(g => ({ ...g, tts: { ...g.tts, rate: Number(e.target.value) } }))} /> {game.tts.rate.toFixed(1)}x</label>
            {phase !== 'idle' && <button className="ml-auto whitespace-nowrap rounded bg-gray-200 px-3 py-1" onClick={() => { stopSpeaking(); setResolving(null); stopBgm(); setPartRun(null); setPartResult(null); setPhase('idle'); setCurrent(null) }}>그만하기</button>}
          </div>
        </section>
      )}

      {tab === 'review' && (
        <section className="rounded-xl bg-white p-3 text-sm shadow-sm">
          <div className="text-base font-bold">오답 복습 (크리티컬 공격)</div>
          <p className="mt-1 text-gray-600">미처리 오답 <b className={openCount ? 'text-rose-600' : ''}>{openCount}</b>개 · 복습 예정 <b>{dueCount}</b>개 · 오답 이력 전체 <b>{wrongDocs}</b>개</p>
          <p className="mt-1 text-[12px] text-gray-500">틀린 문제는 <b>같은 문제를 연속 {CLEAR_STREAK}번 맞힐 때까지</b> 접속할 때마다 불시 공격으로 나옵니다. 맞히면 크리티컬(피해 2배)! 오답 기록 자체는 지워지지 않습니다.</p>
          <button disabled={!openCount && !dueCount} onClick={() => start({ review: true })} className="mt-3 w-full rounded-lg bg-rose-600 py-3 font-bold text-white disabled:bg-gray-300">{openCount ? `미처리 오답 ${openCount}개 처리하기` : '복습 달리기 시작'}</button>
          <ul className="mt-3 divide-y">
            {questions.filter(x => isOpenWrong(game.schedules[x.id])).sort((a, b) => game.schedules[b.id].wrongCount - game.schedules[a.id].wrongCount).slice(0, 20).map(x => {
              const s = game.schedules[x.id]
              return <li key={x.id} className="py-2"><div className="line-clamp-2">{x.statement}</div>
                <div className="text-[11px] text-gray-500">틀린 횟수 {s.wrongCount}회 · <b className="text-rose-600">처리까지 연속 정답 {s.streak}/{CLEAR_STREAK}</b></div></li>
            })}
            {!openCount && <li className="py-4 text-center text-gray-400">미처리 오답이 없습니다 👍</li>}
          </ul>
        </section>
      )}

      {tab === 'report' && (
        <section className="space-y-2 text-sm">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[['푼 문제', total], ['정답률', total ? `${Math.round(correctN / total * 100)}%` : '-'], ['첫 풀이 정답률', firstA.length ? `${Math.round(firstA.filter(a => a.isCorrect).length / firstA.length * 100)}%` : '-']].map(([k, v]) => (
              <div key={String(k)} className="rounded-xl bg-white p-3 shadow-sm"><div className="text-lg font-bold">{v}</div><div className="text-[11px] text-gray-500">{k}</div></div>))}
          </div>
          {advice && <div className="rounded-xl bg-amber-50 p-3 text-amber-900">{advice}
            <button className="mt-2 block rounded bg-amber-500 px-3 py-1 text-white" onClick={() => { const w = stats.filter(s => s.attempts >= 5).sort((a, b) => (a.reviewAccuracy ?? a.accuracy ?? 1) - (b.reviewAccuracy ?? b.accuracy ?? 1))[0]; start({ unit: w?.unitId }) }}>집중훈련 시작</button></div>}
          <div className="rounded-xl bg-white p-3 shadow-sm">
            <div className="mb-2 font-bold">단원별</div>
            {stats.map(s => (
              <div key={s.unitId} className="mb-2">
                <div className="flex justify-between text-[12px]"><span className="truncate pr-2">{s.unitTitle}</span><span>{s.accuracy === null ? '-' : `${Math.round(s.accuracy * 100)}%`} ({s.attempts}회)</span></div>
                <div className="h-2 rounded bg-gray-100"><div className="h-2 rounded bg-blue-500" style={{ width: `${(s.accuracy ?? 0) * 100}%` }} /></div>
                <div className="text-[11px] text-gray-500">복습 정답률 {s.reviewAccuracy === null ? '-' : `${Math.round(s.reviewAccuracy * 100)}%`} · 미숙련 오답 {s.openWrong}문항</div>
              </div>))}
          </div>
          <p className="text-[11px] text-gray-400">※ 게임 내 학습성과 지표이며 실제 시험 합격 가능성을 의미하지 않습니다. 경험치/레벨은 게임 성장이고 학습 숙련도와 별개입니다.</p>
        </section>
      )}

      {tab === 'room' && (
        <section className="rounded-xl bg-white p-3 shadow-sm">
          <div className="text-base font-bold">{roomName(game.items.length)}</div>
          <p className="text-[12px] text-gray-500">STAGE {game.stage} · {th.name} · 보유 {game.items.length}/{ITEMS.length}</p>
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-[12px]">
            <div className="font-bold text-slate-800">성장 단계 {tier.tier}/{TIERS.length} 「{tier.title}」 · Lv.{lv.level}</div>
            <div className="mt-1 text-slate-600">
              무기: {tier.weapon ? (prog?.weapons[tier.weapon]?.title ?? tier.weapon) : '각인 기본봉'} · 보스: {isBossStage(game.stage) ? '지금 보스 스테이지!' : `STAGE ${Math.ceil(game.stage / 5) * 5}`}
              {nt ? ` · 다음 단계 「${nt.title}」은 Lv.${nt.minLevel}에서 (무기·펫·보스 변화)` : ' · 최고 단계입니다'}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">성장 단계는 학습 보상(처음 푸는 문제/복습 문제 정답)으로 얻는 경험치로만 오릅니다.</p>
            <div className="mt-2 flex gap-2">
              {(['male', 'female'] as const).map(hk => (
                <button key={hk} onClick={() => setGame(g => ({ ...g, hero: hk }))}
                  className={`rounded-full px-3 py-1 font-bold ${game.hero === hk ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>{hk === 'male' ? '남자 헌터' : '여자 헌터'}</button>))}
            </div>
          </div>
          <div className="mt-3 text-[13px] font-bold">함께 다닐 펫</div>
          <div className="mt-1 grid grid-cols-4 gap-2 text-center">
            {TIERS.flatMap(t => t.pets.map(id => ({ id, t }))).map(({ id, t }) => {
              const open = petsOpen.includes(id)
              const def = prog?.pets[id]
              return (
                <button key={id} disabled={!open} onClick={() => setGame(g => ({ ...g, pet: id }))} title={def?.title ?? id}
                  className={`rounded-lg border p-1 ${pet === id ? 'border-blue-500 bg-blue-50' : 'bg-gray-50'} ${open ? '' : 'opacity-40'}`}>
                  {def && open
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={`/hunter-assets/${def.src}`} alt={def.title} loading="lazy" className="mx-auto h-12 w-full object-contain" />
                    : <div className="flex h-12 items-center justify-center text-xl">{open ? '🐾' : '🔒'}</div>}
                  <div className="text-[10px] leading-tight">{open ? (def?.title ?? id) : `Lv.${t.minLevel}`}</div>
                </button>
              )
            })}
          </div>
          <div className="mt-4 text-[13px] font-bold">공부방 아이템</div>
          <div className="mt-1 grid grid-cols-5 gap-2 text-center">
            {ITEMS.map(i => {
              const has = game.items.includes(i.id)
              return <div key={i.id} className={`rounded-lg border p-2 ${has ? 'bg-yellow-50' : 'bg-gray-50 opacity-40'}`} title={i.name}>
                <div className="text-2xl">{has ? i.emoji : '❔'}</div><div className="text-[10px]">{has ? i.name : '???'}</div></div>
            })}
          </div>
          <button className="mt-4 text-[11px] text-gray-400 underline" onClick={() => { if (confirm('이 기기에 저장된 게임 기록을 모두 지울까요? (되돌릴 수 없음)')) { setGame(emptyGame()); setPhase('idle'); setCurrent(null) } }}>이 기기 기록 초기화</button>
        </section>
      )}
    </div>
    </div>
  )
}
