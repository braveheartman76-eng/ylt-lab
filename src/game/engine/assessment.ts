import type { Attempt, GameQuestion, ScheduleState } from './types.ts'
import { CLEAR_STREAK } from './srs.ts'
import { unitStats } from './stats.ts'

// 주간 평가(게임 내 학습성과 등급). 실제 시험 합격 가능성/합격권을 뜻하지 않는다.
export const ASSESSMENT_DISCLAIMER = '※ 게임 내 학습성과 등급이며 실제 시험의 합격 가능성이나 합격권을 의미하지 않습니다.'

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D'
export const WEEKLY_TARGET = 70 // 주간 풀이 목표(문항)
export const MIN_SOLVED = 10 // 이보다 적게 풀면 평가를 보류한다(근거 부족)
export const GRADE_REWARD: Record<Grade, number> = { S: 100, A: 70, B: 50, C: 30, D: 20 }

const KST = 9 * 3600 * 1000
const WEEK = 7 * 24 * 3600 * 1000

/** 한국 시간 기준 월요일 00:00 (epoch ms). 주간 평가의 '한 주'의 시작. */
export function weekStartOf(ts: number): number {
  const k = new Date(ts + KST)
  const diff = (k.getUTCDay() + 6) % 7 // 월=0 … 일=6
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - diff) - KST
}
export const weekKey = (weekStart: number) => new Date(weekStart + KST).toISOString().slice(0, 10) // 'YYYY-MM-DD'(월요일 날짜)

export interface WeeklyAssessment {
  weekStart: number
  key: string
  solved: number
  distinctQuestions: number
  accuracy: number | null // 0~100
  firstAccuracy: number | null
  reviewCompletion: number | null // 이번 주 처리 대상 오답 중 처리 완료 비율 0~100
  reviewTotal: number
  reviewCleared: number
  masteryAvg: number | null // 이번 주 푼 문항의 복습 단계 평균 0~100
  trend: number | null // 지난주 대비 정답률 변화(%p). 지난주 풀이가 10개 미만이면 null
  score: number | null // 0~100
  grade: Grade | null // null = 평가 보류
  holdReason: string | null
  reward: number // 등급 보상(코인)
  weakUnit: { title: string; accuracy: number } | null
}

const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10)

/** 풀이 기록을 시간순으로 재생해 '미처리 오답'(한 번 이상 틀렸고 연속 CLEAR_STREAK 회 미만) 집합을 구한다. */
function openSetAt(attempts: Attempt[], until: number): Set<string> {
  const wrong = new Map<string, number>()
  const streak = new Map<string, number>()
  for (const a of attempts) {
    if (a.at >= until) break
    if (a.isCorrect) streak.set(a.questionId, (streak.get(a.questionId) ?? 0) + 1)
    else { streak.set(a.questionId, 0); wrong.set(a.questionId, (wrong.get(a.questionId) ?? 0) + 1) }
  }
  const open = new Set<string>()
  for (const [id, w] of wrong) if (w > 0 && (streak.get(id) ?? 0) < CLEAR_STREAK) open.add(id)
  return open
}

export function gradeOf(score: number): Grade {
  return score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D'
}

export function weeklyAssessment(
  attemptsAll: Attempt[],
  schedules: Record<string, ScheduleState>,
  questions: GameQuestion[],
  weekStart: number,
): WeeklyAssessment {
  const attempts = [...attemptsAll].sort((a, b) => a.at - b.at)
  const end = weekStart + WEEK
  const week = attempts.filter(a => a.at >= weekStart && a.at < end)
  const prev = attempts.filter(a => a.at >= weekStart - WEEK && a.at < weekStart)
  const solved = week.length
  const correct = week.filter(a => a.isCorrect).length
  const first = week.filter(a => a.isFirst)
  const accuracy = pct(correct, solved)
  const prevAcc = prev.length >= MIN_SOLVED ? pct(prev.filter(a => a.isCorrect).length, prev.length) : null
  const trend = accuracy !== null && prevAcc !== null ? Math.round((accuracy - prevAcc) * 10) / 10 : null

  // 오답 복습 완료율: (주 시작 시점에 미처리였던 것 + 이번 주에 새로 미처리가 된 것) 중 주말에 처리 완료된 비율
  const openStart = openSetAt(attempts, weekStart)
  const openEnd = openSetAt(attempts, end)
  const opened = new Set<string>()
  { // 이번 주 동안 미처리 상태가 된 문항
    const wrong = new Set<string>()
    for (const a of week) if (!a.isCorrect) wrong.add(a.questionId)
    for (const id of wrong) opened.add(id)
  }
  const target = new Set<string>([...openStart, ...opened])
  const cleared = [...target].filter(id => !openEnd.has(id)).length
  const reviewCompletion = pct(cleared, target.size)

  const touched = [...new Set(week.map(a => a.questionId))]
  const masteries = touched.map(id => schedules[id]?.mastery).filter((m): m is number => typeof m === 'number')
  const masteryAvg = masteries.length ? Math.round(masteries.reduce((s, m) => s + m, 0) / masteries.length) : null

  let score: number | null = null
  let grade: Grade | null = null
  let holdReason: string | null = null
  if (solved < MIN_SOLVED) holdReason = `이번 주 풀이가 ${solved}문항이라 평가를 보류합니다. (최소 ${MIN_SOLVED}문항)`
  else {
    // 항목 점수(0~100)와 가중치. 값이 없는 항목은 가중치를 나머지에 나눠 준다.
    const parts: [number | null, number][] = [
      [Math.min(100, (solved / WEEKLY_TARGET) * 100), 0.25], // 학습 문항 수
      [accuracy, 0.3], // 문제풀이 정확도
      [reviewCompletion, 0.2], // 오답 복습 완료율
      [masteryAvg, 0.15], // 복습 단계(숙련도)
      [trend === null ? null : Math.max(0, Math.min(100, 50 + trend * 2.5)), 0.1], // 실력 상승 추세(0%p=50점)
    ]
    const used = parts.filter(([v]) => v !== null) as [number, number][]
    const wsum = used.reduce((s, [, w]) => s + w, 0)
    score = Math.round((used.reduce((s, [v, w]) => s + v * w, 0) / wsum) * 10) / 10
    grade = gradeOf(score)
  }

  const weak = unitStats(week, questions, schedules).filter(u => u.attempts >= 5 && u.accuracy !== null).sort((a, b) => (a.accuracy ?? 1) - (b.accuracy ?? 1))[0]
  return {
    weekStart, key: weekKey(weekStart), solved, distinctQuestions: touched.length, accuracy,
    firstAccuracy: pct(first.filter(a => a.isCorrect).length, first.length),
    reviewCompletion, reviewTotal: target.size, reviewCleared: cleared, masteryAvg, trend, score, grade, holdReason,
    reward: grade ? GRADE_REWARD[grade] : 0,
    weakUnit: weak && (weak.accuracy ?? 1) < 0.75 ? { title: weak.unitTitle, accuracy: Math.round((weak.accuracy ?? 0) * 100) } : null,
  }
}

/** 다음 주 추천 학습 목표 */
export function nextWeekGoals(a: WeeklyAssessment, openWrongNow: number): string[] {
  const goals: string[] = []
  const target = a.solved >= WEEKLY_TARGET ? Math.round((a.solved * 1.1) / 5) * 5 : WEEKLY_TARGET
  goals.push(`이번 주보다 조금 더: ${target}문항 풀기`)
  if (openWrongNow > 0) goals.push(`미처리 오답 ${openWrongNow}개 중 절반 이상 처리하기 (같은 문제를 연속 2번 맞히기)`)
  if (a.weakUnit) goals.push(`「${a.weakUnit.title}」 단원 집중훈련 (이번 주 정답률 ${a.weakUnit.accuracy}%)`)
  if (a.accuracy !== null && a.accuracy >= 85 && a.grade) goals.push('정답률이 높으니 한 파트씩 자동진행으로 속도를 올려 보기')
  return goals
}

export interface ClaimState { [weekKeyStr: string]: { grade: Grade; reward: number; claimedAt: number } }

/** 보상 수령: 같은 주에는 한 번만. 평가 보류(등급 없음)이거나 아직 끝나지 않은 주는 수령 불가. */
export function claimReward(claims: ClaimState, a: WeeklyAssessment, now: number): { claims: ClaimState; coins: number; reason?: string } {
  if (!a.grade) return { claims, coins: 0, reason: '평가 보류 상태에서는 보상이 없어요.' }
  if (claims[a.key]) return { claims, coins: 0, reason: '이미 받은 주간 보상이에요.' }
  if (now < a.weekStart + WEEK) return { claims, coins: 0, reason: '이번 주가 끝난 뒤(월요일부터) 받을 수 있어요.' }
  return { claims: { ...claims, [a.key]: { grade: a.grade, reward: a.reward, claimedAt: now } }, coins: a.reward }
}
