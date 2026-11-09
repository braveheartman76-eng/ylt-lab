// 스테이지(배경) · 아이템 · 몬스터 정의. 모든 도안은 독창적으로 직접 그린 임시 리소스이며 추후 교체한다.

export interface Theme {
  name: string
  bg: 'station' | 'academy' | 'library' // public/hunter-assets/backgrounds 의 그림 (없으면 아래 도형 색으로 대체)
  sky: [string, string]
  ground: string
  accent: string
}

export const THEMES: Theme[] = [
  { name: '노량진역', bg: 'station', sky: ['#9bd3ff', '#e4f4ff'], ground: '#8a8f98', accent: '#3b82f6' },
  { name: '고시원 골목', bg: 'academy', sky: ['#ffd9a8', '#fff1dd'], ground: '#9a7b5a', accent: '#f59e0b' },
  { name: '학원가', bg: 'academy', sky: ['#c9b6ff', '#f0eaff'], ground: '#7b7f8c', accent: '#8b5cf6' },
  { name: '독서실', bg: 'library', sky: ['#a8e6cf', '#e8fbf2'], ground: '#6b8f7a', accent: '#10b981' },
  { name: '강의실', bg: 'library', sky: ['#ffc2c2', '#fff0f0'], ground: '#8f6b6b', accent: '#ef4444' },
  { name: '모의고사장', bg: 'library', sky: ['#b5c7d9', '#eef3f8'], ground: '#5f6b78', accent: '#475569' },
]

export const STAGE_SIZE = 5 // 스테이지당 몬스터를 쓰러뜨리는 정답 수
export const MAX_PLAYER_HP = 3
export const themeOf = (stage: number) => THEMES[(stage - 1) % THEMES.length]
export const isBossStage = (stage: number) => stage % 5 === 0

/** 스테이지의 몬스터 그림: 보스 스테이지는 잉크 보스, 그 외에는 5종을 순서대로 */
const ENEMY_CYCLE = ['inkSlime', 'falsePrecedentGhost', 'prisonCage', 'hourglassGoblin', 'statuteMimic']
export function enemyKeyFor(stage: number): string {
  if (isBossStage(stage)) return 'inkBoss'
  const n = stage - Math.floor(stage / 5) - 1 // 앞선 '보스가 아닌' 스테이지 수
  return ENEMY_CYCLE[n % ENEMY_CYCLE.length]
}

export interface Item {
  id: string
  name: string
  emoji: string
  tier: 'basic' | 'mid' | 'high'
}

// supabase/game/002_seed_reference.sql 의 game_items 와 id 가 같다
export const ITEMS: Item[] = [
  { id: 'pencil', name: '연필', emoji: '✏️', tier: 'basic' },
  { id: 'highlighter', name: '형광펜', emoji: '🖍️', tier: 'basic' },
  { id: 'notebook', name: '공책', emoji: '📓', tier: 'basic' },
  { id: 'textbook', name: '기본서', emoji: '📘', tier: 'basic' },
  { id: 'bag', name: '책가방', emoji: '🎒', tier: 'basic' },
  { id: 'desk', name: '책상', emoji: '🪑', tier: 'mid' },
  { id: 'stand', name: '스탠드', emoji: '💡', tier: 'mid' },
  { id: 'bookshelf', name: '책장', emoji: '📚', tier: 'mid' },
  { id: 'wrong_note', name: '오답노트', emoji: '📕', tier: 'mid' },
  { id: 'reading_seat', name: '독서실 좌석', emoji: '💺', tier: 'mid' },
  { id: 'tablet', name: '태블릿', emoji: '📱', tier: 'high' },
  { id: 'premium_book', name: '전문 수험서', emoji: '📖', tier: 'high' },
  { id: 'premium_reading_room', name: '고급 독서실', emoji: '🏛️', tier: 'high' },
  { id: 'mock_materials', name: '모의고사 자료', emoji: '📝', tier: 'high' },
  { id: 'outfit_final', name: '파이널 의상', emoji: '🧥', tier: 'high' },
]

/** 스테이지 클리어 보상: 스테이지가 오를수록 상위 등급. 이미 가진 것은 제외, 다 가졌으면 null. */
export function dropFor(stage: number, owned: string[]): Item | null {
  const tier = stage <= 3 ? 'basic' : stage <= 8 ? 'mid' : 'high'
  const order: Item['tier'][] = tier === 'basic' ? ['basic', 'mid', 'high'] : tier === 'mid' ? ['mid', 'high', 'basic'] : ['high', 'mid', 'basic']
  for (const t of order) {
    const left = ITEMS.filter(i => i.tier === t && !owned.includes(i.id))
    if (left.length) return left[0]
  }
  return null
}

/** 공부방 단계: 보유 아이템 수로 시각적 발전(고시원 → 독서실 → 고급 독서실) */
export function roomName(itemCount: number) {
  if (itemCount >= 11) return '고급 독서실'
  if (itemCount >= 6) return '독서실'
  if (itemCount >= 3) return '학원 자습실'
  return '허름한 고시원 방'
}
