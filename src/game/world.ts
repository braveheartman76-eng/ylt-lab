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

export const STAGE_SIZE = 5 // 일반 스테이지에서 몬스터를 쓰러뜨리는 정답 수
export const BOSS_HP = 8 // 보스 스테이지는 더 오래 싸운다(크리티컬은 2배 피해)
export const stageHp = (stage: number) => (isBossStage(stage) ? BOSS_HP : STAGE_SIZE)
export const MAX_PLAYER_HP = 3 // 기본 체력(체력이 0이 되면 이 값으로 재정비)
export const themeOf = (stage: number) => THEMES[(stage - 1) % THEMES.length]
export const isBossStage = (stage: number) => stage % 5 === 0

/** 일반 스테이지의 몬스터 그림: 5종 순환 (보스 스테이지는 bossFor 로 단계에 맞는 보스) */
const ENEMY_CYCLE = ['inkSlime', 'falsePrecedentGhost', 'prisonCage', 'hourglassGoblin', 'statuteMimic']
export function enemyKeyFor(stage: number, tier = 1): string {
  if (isBossStage(stage)) return bossFor(stage, tier)
  const n = stage - Math.floor(stage / 5) - 1 // 앞선 '보스가 아닌' 스테이지 수
  return ENEMY_CYCLE[n % ENEMY_CYCLE.length]
}

// ───────────────────────── 성장 단계 (입문 → 수련 → 정예 → 달인 → 전설)
// 단계는 '게임 레벨'로 정한다. 레벨은 학습 보상(처음 푸는 문제/복습 예정 문항 정답)으로만 오르므로 반복 파밍으로 올릴 수 없다.
// id 는 public/hunter-assets/progression/progression-manifest.json 과 같다(tests/engine/progression.test.mjs 로 검증).
export interface Tier {
  tier: number
  title: string
  minLevel: number
  pets: string[] // 이 단계에서 새로 해금되는 펫
  weapon: string | null // null = 기본 헌터가 들고 있는 각인 기본봉
  boss: string // 이 단계 보스 스테이지의 보스
  heroSet: 'starter' | 'veteran' | 'legendary'
  bossBg: string | null // 보스 스테이지 전용 배경 (null = 일반 스테이지 배경)
}

export const TIERS: Tier[] = [
  { tier: 1, title: '입문', minLevel: 1, pets: ['law-rabbit', 'book-shiba'], weapon: null, boss: 'inkBoss', heroSet: 'starter', bossBg: null },
  { tier: 2, title: '수련', minLevel: 3, pets: ['precedent-owl', 'evidence-fox'], weapon: 'crystal-sword', boss: 'iron-warden', heroSet: 'veteran', bossBg: 'academy' },
  { tier: 3, title: '정예', minLevel: 6, pets: ['iron-tortoise', 'starlight-raven'], weapon: 'verdict-hammer', boss: 'crimson-ink-demon', heroSet: 'veteran', bossBg: 'library' },
  { tier: 4, title: '달인', minLevel: 10, pets: ['azure-dragonling'], weapon: 'azure-dragon-glaive', boss: 'magma-dragon', heroSet: 'legendary', bossBg: 'volcanic-cavern' },
  { tier: 5, title: '전설', minLevel: 15, pets: ['golden-haechi'], weapon: 'justice-greatsword', boss: 'abyssal-colossus', heroSet: 'legendary', bossBg: 'abyss-throne' },
]

export const tierOf = (level: number): Tier => [...TIERS].reverse().find(t => level >= t.minLevel) ?? TIERS[0]
export const unlockedPets = (tier: number): string[] => TIERS.filter(t => t.tier <= tier).flatMap(t => t.pets)
export const nextTier = (tier: number): Tier | null => TIERS.find(t => t.tier === tier + 1) ?? null

/** 보스 스테이지의 보스. 전설 단계는 심연 괴수 → 흑요석 용왕 순서로 번갈아 나온다. */
export function bossFor(stage: number, tier: number): string {
  const t = TIERS.find(x => x.tier === tier) ?? TIERS[0]
  if (t.tier === 5) return Math.floor(stage / 5) % 2 === 1 ? 'abyssal-colossus' : 'obsidian-king'
  return t.boss
}
/** 흑요석 용왕은 체력이 절반 이하가 되면 폭주(두 번째 형태)한다. */
export function bossForm(key: string, hp: number, max: number): string {
  return key === 'obsidian-king' && hp <= Math.floor(max / 2) ? 'obsidian-king-enraged' : key
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

// ───────────────────────── 점수 → 생명 보너스
// 간식을 먹거나 악당을 처치하면 점수가 쌓이고, 일정 점수마다 생명(체력) +1. 체력이 가득이면 코인으로 대신 준다.
// 점수·생명은 게임 재미 요소이며 학습 보상(XP/코인 규칙)과 별개다. 체력이 0이 되어도 게임오버 없이 재정비(오답은 모두 기록).
export const MAX_HP = 5
export const SCORE_PICKUP = 1 // 간식 하나
export const SCORE_KILL = 15 // 악당 처치
export const SCORE_BOSS_KILL = 40 // 보스 처치
export const SCORE_PER_LIFE = 40 // 이 점수마다 생명 +1
export const FULL_HP_COIN_BONUS = 5

export interface ScoreState { score: number; lifeAwards: number; hp: number; coins: number }
export interface ScoreResult extends ScoreState { lives: number; coinBonus: number }

export function addScore(s: ScoreState, pts: number): ScoreResult {
  const score = s.score + Math.max(0, pts)
  const earned = Math.max(0, Math.floor(score / SCORE_PER_LIFE) - s.lifeAwards)
  let hp = s.hp, lives = 0, coinBonus = 0
  for (let i = 0; i < earned; i++) {
    if (hp < MAX_HP) { hp++; lives++ } else coinBonus += FULL_HP_COIN_BONUS
  }
  return { score, lifeAwards: s.lifeAwards + earned, hp, coins: s.coins + coinBonus, lives, coinBonus }
}

/** 다음 생명까지 남은 점수 */
export const toNextLife = (score: number) => SCORE_PER_LIFE - (score % SCORE_PER_LIFE)
