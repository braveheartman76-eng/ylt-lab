import type { GameQuestion, ScheduleState } from './types.ts'
import { isOpenWrong } from './srs.ts'
import { hashStr } from '../gates.ts'

// 사건 수사 미션: 한 대제목에서 단서(문제) 5개를 모아 사건을 해결한다.
// 단서 선택은 '지금 학습이 필요한 문제' 우선(미처리 오답 > 아직 안 푼 문제 > 숙련도 낮은 문제)이고, 가능하면 서로 다른 소제목에서 고른다.
export const CASE_SIZE = 5
export const SOLVE_MIN = 4 // 이 개수 이상 맞히면 사건 해결
export const CASE_REWARD_COINS = 30
export const CASE_REWARD_SCORE = 20
const MIN_SECTION = 3 // 이보다 문제가 적은 대제목은 사건으로 만들지 않는다

export interface CaseFile {
  id: string // 단서 문제 id 들로 정해지는 안정적인 사건 id(같은 구성이면 같은 id)
  number: number // 사건 번호(표시용 3자리)
  title: string
  section: string
  questions: GameQuestion[] // 책 순서
}

/** 학습이 필요한 정도(클수록 먼저 단서로 뽑힘) */
export function needOf(q: GameQuestion, s: ScheduleState | undefined): number {
  if (isOpenWrong(s)) return 3 + (s?.wrongCount ?? 0) * 0.1
  if (!s) return 2
  return (100 - s.mastery) / 50 // 0~2
}

export function buildCase(
  questions: GameQuestion[],
  schedules: Record<string, ScheduleState>,
  opt: { rng?: () => number; excludeIds?: string[] } = {},
): CaseFile | null {
  const rng = opt.rng ?? Math.random
  const bySection = new Map<string, GameQuestion[]>()
  for (const q of questions) { const k = q.section ?? q.unitTitle; bySection.set(k, [...(bySection.get(k) ?? []), q]) }
  const sections = [...bySection.entries()].filter(([, qs]) => qs.length >= MIN_SECTION)
  if (!sections.length) return null
  // 대제목 선택: 평균 필요도가 높은 곳 우선(근소한 차이면 무작위로 변화를 준다)
  const scored = sections.map(([name, qs]) => ({ name, qs, need: qs.reduce((s, q) => s + needOf(q, schedules[q.id]), 0) / qs.length + rng() * 0.3 }))
  scored.sort((a, b) => b.need - a.need)
  for (const sec of scored) {
    const ranked = [...sec.qs].sort((a, b) => needOf(b, schedules[b.id]) - needOf(a, schedules[a.id]) || (rng() - 0.5))
    const picked: GameQuestion[] = []
    const topics = new Set<string>()
    for (const q of ranked) { // 1차: 소제목이 겹치지 않게
      const t = q.topic ?? ''
      if (picked.length < CASE_SIZE && !topics.has(t)) { picked.push(q); topics.add(t) }
    }
    for (const q of ranked) if (picked.length < CASE_SIZE && !picked.includes(q)) picked.push(q) // 2차: 모자라면 채움
    const ordered = picked.sort((a, b) => questions.indexOf(a) - questions.indexOf(b))
    const id = ordered.map(q => q.id).join('+')
    if (opt.excludeIds?.includes(id) && scored.length > 1) continue
    return { id, number: 100 + (hashStr(id) % 900), title: `사건 #${100 + (hashStr(id) % 900)} · ${sec.name}`, section: sec.name, questions: ordered }
  }
  return null
}

export interface CaseOutcome { solved: boolean; correct: number; total: number; coins: number; score: number; firstClear: boolean; verdict: string }

/** 결과 판정과 보상. 같은 사건을 반복해서 보상을 받을 수는 없다(처음 해결할 때만). */
export function judgeCase(correct: number, total: number, alreadyCleared: boolean): CaseOutcome {
  const solved = total > 0 && correct >= Math.min(SOLVE_MIN, total)
  const firstClear = solved && !alreadyCleared
  return {
    solved, correct, total, firstClear,
    coins: firstClear ? CASE_REWARD_COINS : 0,
    score: firstClear ? CASE_REWARD_SCORE : 0,
    verdict: solved ? (firstClear ? '사건 해결! 🎉' : '사건 해결(이미 해결한 사건이라 보상은 없어요)') : '수사 보류 — 틀린 단서를 복습하고 다시 도전해 보세요',
  }
}
