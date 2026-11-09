import type { GameQuestion, ScheduleState } from './types.ts'
import { isDue, isOpenWrong } from './srs.ts'

/** 파트 = 같은 소제목(목차)의 문제를 책 순서대로 묶은 것. '한 파트씩 자동진행' 모드의 단위. */
export interface Part {
  key: string
  section: string
  title: string
  questions: GameQuestion[]
}

export const partKeyOf = (q: GameQuestion) => `${q.section ?? q.unitTitle}|${q.topic ?? ''}`

/** 문제 목록(책 순서)을 파트로 묶는다. 순서는 처음 등장한 순서 그대로. */
export function buildParts(qs: GameQuestion[]): Part[] {
  const parts: Part[] = []
  const idx = new Map<string, Part>()
  for (const q of qs) {
    const key = partKeyOf(q)
    let p = idx.get(key)
    if (!p) { p = { key, section: q.section ?? q.unitTitle, title: q.topic ?? q.unitTitle, questions: [] }; idx.set(key, p); parts.push(p) }
    p.questions.push(q)
  }
  return parts
}

/** 시작할 파트: 아직 안 푼 문제가 있는 첫 파트 → 없으면 미처리 오답/복습 예정이 있는 첫 파트 → 없으면 첫 파트 */
export function firstPart(parts: Part[], schedules: Record<string, ScheduleState>, now: number): Part | null {
  if (!parts.length) return null
  return (
    parts.find(p => p.questions.some(q => !schedules[q.id])) ??
    parts.find(p => p.questions.some(q => isOpenWrong(schedules[q.id]) || (schedules[q.id] && isDue(schedules[q.id], now)))) ??
    parts[0]
  )
}

/** 현재 파트 다음(책 순서) 파트. 마지막이면 null */
export function nextPart(parts: Part[], currentKey: string): Part | null {
  const i = parts.findIndex(p => p.key === currentKey)
  return i >= 0 && i + 1 < parts.length ? parts[i + 1] : null
}
