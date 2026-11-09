import type { Attempt, ScheduleState } from './engine/types.ts'

export interface SavedGame {
  v: 1
  schedules: Record<string, ScheduleState>
  attempts: Attempt[] // append-only: 삭제/수정하지 않는다
  xp: number
  coins: number
  stage: number
  stageKills: number // 현재 스테이지에서 맞힌 수
  items: string[]
  tts: { enabled: boolean; rate: number }
  track: string
  hero: 'male' | 'female' // 선택한 헌터 캐릭터
  pet: string | null // 함께 다니는 펫(해금된 것 중 선택). null 이면 해금된 첫 번째
  sfx: { enabled: boolean; volume: number } // 효과음
}

const KEY = 'ylt-game-v1'

export const emptyGame = (): SavedGame => ({
  v: 1, schedules: {}, attempts: [], xp: 0, coins: 0, stage: 1, stageKills: 0, items: [],
  tts: { enabled: false, rate: 1 }, track: 'police', hero: 'male', pet: null, sfx: { enabled: true, volume: 0.6 },
})

export function loadGame(): SavedGame {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptyGame()
    const g = JSON.parse(raw)
    return g?.v === 1 ? { ...emptyGame(), ...g } : emptyGame()
  } catch {
    return emptyGame()
  }
}

export function saveGame(g: SavedGame) {
  try {
    localStorage.setItem(KEY, JSON.stringify(g))
  } catch {
    /* 저장소 차단/용량 초과 — 플레이는 계속 가능, 기록만 저장되지 않음 */
  }
}
