'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import RunnerCanvas, { type Flash, type RunPhase } from './RunnerCanvas'
import { applyAttempt, isDue, levelFromXp } from '@/game/engine/srs'
import { pickNext, type PickKind } from '@/game/engine/picker'
import { recommend, unitStats } from '@/game/engine/stats'
import type { Attempt, GameQuestion } from '@/game/engine/types'
import { emptyGame, loadGame, saveGame, type SavedGame } from '@/game/store'
import { speak, stopSpeaking, ttsSupported, unlockTts, readable } from '@/game/tts'
import { ITEMS, MAX_PLAYER_HP, STAGE_SIZE, dropFor, isBossStage, roomName, themeOf } from '@/game/world'

type Tab = 'play' | 'review' | 'report' | 'room'
const KIND_LABEL: Record<PickKind, string> = { review: '복습', new: '새 문제', past_wrong: '오답 다시', challenge: '도전', any: '장기 확인' }

interface Feedback {
  correct: boolean
  answer: string
  explanation: string
  xp: number
  coins: number
  nextText: string
  drop?: string
  cleared?: boolean
}

export default function GameClient() {
  const [game, setGame] = useState<SavedGame>(emptyGame)
  const [loaded, setLoaded] = useState(false)
  const [questions, setQuestions] = useState<GameQuestion[]>([])
  const [dataInfo, setDataInfo] = useState('')
  const [tab, setTab] = useState<Tab>('play')
  const [phase, setPhase] = useState<RunPhase>('idle')
  const [current, setCurrent] = useState<{ q: GameQuestion; kind: PickKind } | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [monsterHp, setMonsterHp] = useState(STAGE_SIZE)
  const [playerHp, setPlayerHp] = useState(MAX_PLAYER_HP)
  const [reviewOnly, setReviewOnly] = useState(false)
  const [focusUnit, setFocusUnit] = useState<string | undefined>()
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [recent, setRecent] = useState<string[]>([])

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
      setLoaded(true)
      if (data?.questions) {
        setQuestions(data.questions)
        setDataInfo(url.includes('local') ? '내 변환 문항(검수 전)' : '테스트 샘플 문항')
      }
    })()
    return () => { cancelled = true }
  }, [])
  useEffect(() => { if (loaded) saveGame(game) }, [game, loaded])
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id) }, [])

  const dueCount = useMemo(() => questions.filter(q => game.schedules[q.id] && isDue(game.schedules[q.id], now)).length, [questions, game.schedules, now])
  const lv = levelFromXp(game.xp)
  const th = themeOf(game.stage)

  const nextRun = useCallback((o?: { review: boolean; unit?: string }) => {
    const ro = o ? o.review : reviewOnly
    const unit = o ? o.unit : focusUnit
    const p = pickNext(questions, game.schedules, { now: Date.now(), attempts: game.attempts, recentIds: recent, reviewOnly: ro, unitId: unit })
    if (!p) { setCurrent(null); setPhase('idle'); return }
    setCurrent({ q: p.question, kind: p.kind })
    setFeedback(null)
    setPhase('running')
  }, [questions, game.schedules, game.attempts, recent, reviewOnly, focusUnit])

  const arrive = useCallback(() => {
    setPhase('question')
    setStartedAt(Date.now())
    setNow(Date.now())
    const c = current
    if (c) speak(readable([c.q.statement, ...(c.q.bogi ?? []).map(b => `${b.label}. ${b.text}`), ...(c.q.choices ?? []).map(x => `${x.no}번. ${x.text}`)].join(' ')), game.tts)
  }, [current, game.tts])

  const answer = useCallback((sel: string) => {
    if (phase !== 'question' || !current) return
    const q = current.q
    const t = Date.now()
    const correct = sel === q.answer
    const g = game
    const r = applyAttempt(g.schedules[q.id], q.id, correct, t, q.difficulty)
    const attempt: Attempt = {
      id: `${t}-${Math.random().toString(36).slice(2, 8)}`, questionId: q.id, unitId: q.unitId, at: t, selected: sel, isCorrect: correct,
      elapsedMs: t - startedAt, attemptNo: r.state.attemptCount, wasReview: r.wasReview, isFirst: r.isFirst, boxAfter: r.state.box,
    }
    const stage = g.stage
    let kills = g.stageKills, items = g.items, coins = g.coins + r.reward.coins
    let hp = playerHp, mhp = monsterHp, drop: string | undefined, cleared = false
    if (correct) {
      mhp = monsterHp - 1
      kills += 1
      if (mhp <= 0) {
        const it = dropFor(stage, items)
        if (it) { items = [...items, it.id]; drop = `${it.emoji} ${it.name}` } else coins += 20
        cleared = true
      }
    } else {
      hp = playerHp - 1
    }
    const sched = { ...g.schedules, [q.id]: r.state }
    const next: SavedGame = { ...g, schedules: sched, attempts: [...g.attempts, attempt], xp: g.xp + r.reward.xp, coins, stage, stageKills: kills, items }
    if (cleared) { next.stage = stage + 1; next.stageKills = 0 }
    setGame(next)
    setNow(t)
    setFlash({ kind: correct ? 'hit' : 'miss', nonce: t, dmg: correct ? (r.reward.xp ? `+${r.reward.xp} XP` : '정답!') : '오답…' })
    setMonsterHp(cleared ? STAGE_SIZE : mhp)
    setPlayerHp(hp <= 0 ? MAX_PLAYER_HP : hp)
    setRecent(r => [q.id, ...r].slice(0, 3))
    const mins = Math.round((r.state.nextReviewAt - t) / 60000)
    const nextText = mins < 120 ? `${mins}분 뒤 다시 확인해요` : mins < 2880 ? '내일 다시 나와요' : `${Math.round(mins / 1440)}일 뒤 다시 나와요`
    const exp = q.explanation ?? ''
    const fb: Feedback = { correct, answer: q.type === 'ox' ? q.answer : `${q.answer}번`, explanation: exp, xp: r.reward.xp, coins: r.reward.coins, nextText: correct ? nextText : `오답노트에 저장 · ${nextText}`, drop, cleared }
    setFeedback(fb)
    setPhase('feedback')
    speak(`${correct ? '정답입니다.' : `오답입니다. 정답은 ${fb.answer}.`} ${readable(exp.split('\n')[0] ?? '')}`, g.tts)
  }, [phase, current, playerHp, monsterHp, game, startedAt])

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
  // 피드백 후 자동으로 다음 구간으로 (정답 3.2초 / 오답은 해설을 읽도록 6.5초). '다음' 버튼으로 즉시 진행 가능.
  useEffect(() => {
    if (phase !== 'feedback' || !feedback) return
    const id = setTimeout(() => nextRun(), feedback.correct ? 3200 : 6500)
    return () => clearTimeout(id)
  }, [phase, feedback, nextRun])
  useEffect(() => () => { stopSpeaking() }, [])

  const start = (opts: { review?: boolean; unit?: string }) => {
    unlockTts()
    setReviewOnly(!!opts.review)
    setFocusUnit(opts.unit)
    setTab('play')
    setPlayerHp(MAX_PLAYER_HP)
    nextRun({ review: !!opts.review, unit: opts.unit })
  }

  const stats = useMemo(() => unitStats(game.attempts, questions, game.schedules), [game.attempts, questions, game.schedules])
  const advice = useMemo(() => recommend(stats), [stats])
  const total = game.attempts.length
  const correctN = game.attempts.filter(a => a.isCorrect).length
  const firstA = game.attempts.filter(a => a.isFirst)
  const wrongDocs = Object.values(game.schedules).filter(s => s.wrongCount > 0).length

  if (!loaded) return <div className="fixed inset-0 z-[100] bg-[#eef3f8] p-6 text-sm text-gray-500">불러오는 중…</div>

  const q = current?.q
  return (
    // 게임은 기존 사이트의 헤더/사이드바 없이 전체 화면으로 표시한다(모바일 폭 확보). 기존 레이아웃은 수정하지 않는다.
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-[#eef3f8]">
    <div className="mx-auto max-w-xl p-3 pb-10 select-none">
      <Link href="/" className="mb-1 inline-block text-[11px] text-gray-500 underline">← 연구실 사이트로</Link>
      <header className="mb-2 flex items-center justify-between rounded-xl bg-white px-3 py-2 shadow-sm">
        <div>
          <div className="text-sm font-bold">노량진 형사법 헌터</div>
          <div className="text-[11px] text-gray-500">{dataInfo} · {questions.length}문항{!questions.length && ' (없음)'}</div>
        </div>
        <div className="text-right text-xs">
          <div className="font-bold text-blue-700">Lv.{lv.level} <span className="text-gray-400">({lv.into}/{lv.need})</span></div>
          <div>🪙 {game.coins} · 오늘 복습 {dueCount}</div>
        </div>
      </header>

      <nav className="mb-2 grid grid-cols-4 gap-1 text-sm" role="tablist">
        {([['play', '게임'], ['review', `복습${dueCount ? ` ${dueCount}` : ''}`], ['report', '리포트'], ['room', '내 방']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-lg py-2 font-medium ${tab === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}>{label}</button>
        ))}
      </nav>

      {tab === 'play' && (
        <section>
          <div className="relative">
            <RunnerCanvas phase={phase} stage={game.stage} monsterHp={monsterHp} monsterMax={STAGE_SIZE} playerHp={playerHp} flash={flash}
              runMs={2200} onArrive={arrive} />
            {phase === 'idle' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/45 p-4 text-center text-white">
                <div className="text-lg font-bold">노량진역에 도착했습니다</div>
                <div className="text-xs">STAGE {game.stage} · {th.name}{isBossStage(game.stage) ? ' · 보스' : ''}</div>
                {questions.length ? (
                  <button onClick={() => start({})} className="mt-1 rounded-full bg-yellow-400 px-6 py-3 text-base font-bold text-black">공부 시작</button>
                ) : <div className="text-sm">문제 데이터가 없습니다 (public/game-data)</div>}
              </div>
            )}
          </div>

          {current && phase !== 'idle' && (
            <div className="mt-2 rounded-xl bg-white p-3 shadow-sm">
              <div className="mb-1 flex items-center justify-between text-[11px] text-gray-500">
                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">{KIND_LABEL[current.kind]}</span>
                <span>{q!.unitTitle}{q!.isTestData ? ' · 테스트' : ''}{q!.derivedFrom ? ' · 선지 변형' : ''}</span>
              </div>
              {phase === 'running' && <div className="py-6 text-center text-sm text-gray-500">다음 문제로 달리는 중… (화면을 탭하면 점프)</div>}
              {(phase === 'question' || phase === 'feedback') && (
                <div>
                  <p className="whitespace-pre-wrap text-[15px] font-semibold leading-relaxed">{q!.statement}</p>
                  {q!.stemNote && <p className="mt-1 text-[11px] text-gray-400">{q!.stemNote.split('\n')[0]}</p>}
                  {q!.bogi && <ul className="mt-2 space-y-1 rounded-lg bg-gray-50 p-2 text-[13px]">{q!.bogi.map(b => <li key={b.label}><b>{b.label}</b> {b.text}</li>)}</ul>}
                  <div className={`mt-3 ${q!.type === 'ox' ? 'grid grid-cols-2 gap-3' : 'space-y-2'}`}>
                    {q!.type === 'ox'
                      ? (['O', 'X'] as const).map(v => (
                        <button key={v} disabled={phase !== 'question'} onClick={() => answer(v)}
                          className={`rounded-xl py-4 text-3xl font-black disabled:opacity-60 ${v === 'O' ? 'bg-blue-500 text-white' : 'bg-rose-500 text-white'} ${feedback && v === q!.answer ? 'ring-4 ring-yellow-300' : ''}`}>{v}</button>))
                      : q!.choices!.map(c => (
                        <button key={c.no} disabled={phase !== 'question'} onClick={() => answer(c.no)}
                          className={`w-full rounded-xl border px-3 py-3 text-left text-[14px] leading-snug disabled:opacity-80 ${feedback && c.no === q!.answer ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200 bg-white'}`}>
                          <b className="mr-1">{c.no}</b>{c.text}</button>))}
                  </div>
                </div>
              )}
              {phase === 'feedback' && feedback && (
                <div className={`mt-3 rounded-lg p-3 text-sm ${feedback.correct ? 'bg-green-50' : 'bg-rose-50'}`}>
                  <div className="font-bold">{feedback.correct ? '정답!' : `오답 · 정답은 ${feedback.answer}`}
                    {feedback.xp > 0 && <span className="ml-2 text-green-700">+{feedback.xp}XP +{feedback.coins}🪙</span>}</div>
                  {feedback.explanation && <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-gray-700">{feedback.explanation}</p>}
                  <div className="mt-1 text-[11px] text-gray-500">{feedback.nextText}</div>
                  {feedback.cleared && <div className="mt-1 font-bold text-blue-700">스테이지 클리어! {feedback.drop ? `획득: ${feedback.drop}` : '+20🪙'}</div>}
                  <button onClick={() => nextRun()} className="mt-2 w-full rounded-lg bg-gray-800 py-2 text-white">다음으로 (자동 진행)</button>
                </div>
              )}
            </div>
          )}
          {phase === 'idle' && !questions.length ? null : phase === 'idle' && current === null && game.attempts.length > 0 && (
            <p className="mt-2 text-center text-sm text-gray-500">{reviewOnly ? '지금은 복습할 문제가 없어요.' : '출제할 문제가 없습니다.'}</p>
          )}

          <div className="mt-3 flex items-center justify-between rounded-xl bg-white px-3 py-2 text-xs shadow-sm">
            <label className="flex items-center gap-1"><input type="checkbox" checked={game.tts.enabled} disabled={!ttsSupported()}
              onChange={e => { if (e.target.checked) unlockTts(); else stopSpeaking(); setGame(g => ({ ...g, tts: { ...g.tts, enabled: e.target.checked } })) }} /> 음성 읽기{!ttsSupported() && ' (미지원)'}</label>
            <label className="flex items-center gap-1">속도 <input type="range" min={0.7} max={1.5} step={0.1} value={game.tts.rate}
              onChange={e => setGame(g => ({ ...g, tts: { ...g.tts, rate: Number(e.target.value) } }))} /> {game.tts.rate.toFixed(1)}x</label>
            {phase !== 'idle' && <button className="rounded bg-gray-200 px-2 py-1" onClick={() => { stopSpeaking(); setPhase('idle'); setCurrent(null) }}>그만하기</button>}
          </div>
        </section>
      )}

      {tab === 'review' && (
        <section className="rounded-xl bg-white p-3 text-sm shadow-sm">
          <div className="text-base font-bold">오늘의 복습</div>
          <p className="mt-1 text-gray-600">복습 예정 문항 <b>{dueCount}</b>개 · 오답 이력이 있는 문항 <b>{wrongDocs}</b>개 (기록은 지워지지 않습니다)</p>
          <button disabled={!dueCount} onClick={() => start({ review: true })} className="mt-3 w-full rounded-lg bg-blue-600 py-3 font-bold text-white disabled:bg-gray-300">복습 달리기 시작</button>
          <ul className="mt-3 divide-y">
            {questions.filter(x => game.schedules[x.id]?.wrongCount).sort((a, b) => game.schedules[b.id].wrongCount - game.schedules[a.id].wrongCount).slice(0, 15).map(x => {
              const s = game.schedules[x.id]
              return <li key={x.id} className="py-2"><div className="line-clamp-2">{x.statement}</div>
                <div className="text-[11px] text-gray-500">오답 {s.wrongCount}회 · 단계 {s.box}/5 · {isDue(s, now) ? <b className="text-rose-600">복습 예정</b> : `다음 ${new Date(s.nextReviewAt).toLocaleDateString('ko-KR')}`}</div></li>
            })}
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
          <div className="mt-3 grid grid-cols-5 gap-2 text-center">
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
