// 사용자 제작 그림 자료(public/hunter-assets) 로더. 하나라도 불러오지 못하면 null → 화면은 도형 그림으로 대체된다.
export type Pose = 'idle' | 'run' | 'attack'
export type HeroKey = 'male' | 'female'

export interface Sprite { img: HTMLImageElement; height: number; anchor: { x: number; y: number }; floatY?: number }
export interface GateArt {
  id: string
  title: string
  chapter: string
  img: HTMLImageElement
  anchor: { x: number; y: number }
  labelBox: { x: number; y: number; width: number; height: number }
  labelLines: string[]
  questionRefs: string[]
}
export interface HunterAssets {
  bg: Record<string, { img: HTMLImageElement; groundY: number }>
  hero: Record<HeroKey, { height: number; anchor: { x: number; y: number }; poses: Record<Pose, HTMLImageElement> }>
  enemies: Record<string, Sprite>
  gates: { displayHeight: number; byTitle: Map<string, GateArt> }
}

import { pickTemplate, wrapTitle } from './gates.ts'

const ROOT = '/hunter-assets/'

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('이미지 로드 실패: ' + src))
    img.src = src
  })
}

export async function loadHunterAssets(): Promise<HunterAssets | null> {
  try {
    const m = await fetch(ROOT + 'manifest.json').then(r => { if (!r.ok) throw new Error('manifest'); return r.json() })
    const bgKeys = Object.keys(m.backgrounds)
    const bgImgs = await Promise.all(bgKeys.map(k => load(ROOT + m.backgrounds[k].src)))
    const bg: HunterAssets['bg'] = {}
    bgKeys.forEach((k, i) => { bg[k] = { img: bgImgs[i], groundY: m.backgrounds[k].groundY } })

    const hero = {} as HunterAssets['hero']
    for (const k of ['male', 'female'] as HeroKey[]) {
      const c = m.characters[k]
      const [idle, run, attack] = await Promise.all((['idle', 'run', 'attack'] as Pose[]).map(p => load(ROOT + c.poses[p])))
      hero[k] = { height: c.height, anchor: c.anchor, poses: { idle, run, attack } }
    }

    const eKeys = Object.keys(m.enemies)
    const eImgs = await Promise.all(eKeys.map(k => load(ROOT + m.enemies[k].src)))
    const enemies: HunterAssets['enemies'] = {}
    eKeys.forEach((k, i) => { const e = m.enemies[k]; enemies[k] = { img: eImgs[i], height: e.height, anchor: e.anchor, floatY: e.floatY } })

    // 단원 문(선택): 실패해도 나머지 그림은 쓴다
    const gates: HunterAssets['gates'] = { displayHeight: 0.64, byTitle: new Map() }
    try {
      const gm = await fetch(ROOT + 'gates/gate-manifest.json').then(r => { if (!r.ok) throw new Error('gates'); return r.json() })
      gates.displayHeight = gm.displayHeight
      const imgs = await Promise.all(gm.gates.map((g: { src: string }) => load(ROOT + 'gates/' + g.src)))
      gm.gates.forEach((g: Omit<GateArt, 'img' | 'chapter'>, i: number) => gates.byTitle.set(g.title, { ...g, chapter: gm.chapter, img: imgs[i] }))
    } catch { /* 문 그림 없이 진행 */ }
    return { bg, hero, enemies, gates }
  } catch {
    return null
  }
}

// ───────────────────────── 성장 팩(펫·무기·정예/전설 헌터·상위 보스·보스 배경): 필요할 때만 불러온다(약 7MB)
export interface ProgSprite { src: string; anchor: { x: number; y: number }; heightInViewport: number; floatY?: number; handGrip?: { x: number; y: number } }
export interface ProgWeapon { src: string; grip: { x: number; y: number }; widthInHunterHeights: number; title: string }
export interface ProgManifest {
  pets: Record<string, ProgSprite & { title: string }>
  weapons: Record<string, ProgWeapon>
  bosses: Record<string, ProgSprite & { title: string }>
  characters: Record<string, ProgSprite & { handGrip: { x: number; y: number } }>
  backgrounds: Record<string, { src: string; groundY: number }>
}

const PROG = ROOT + 'progression/'
export async function loadProgManifest(): Promise<ProgManifest | null> {
  try {
    const r = await fetch(PROG + 'progression-manifest.json')
    if (!r.ok) return null
    return (await r.json()) as ProgManifest
  } catch {
    return null
  }
}

const cache = new Map<string, HTMLImageElement | 'loading' | 'error'>()
/** manifest 의 src(예: 'progression/pets/law-rabbit.png')로 이미 불러온 이미지를 돌려주고, 아직이면 불러오기를 시작한 뒤 null 을 돌려준다(그리는 쪽은 도형/기본 그림으로 대체). */
export function peekImage(src: string): HTMLImageElement | null {
  const hit = cache.get(src)
  if (hit && hit !== 'loading' && hit !== 'error') return hit
  if (!hit) {
    cache.set(src, 'loading')
    load(ROOT + src).then(img => cache.set(src, img), () => cache.set(src, 'error')) // manifest 의 src 는 'progression/…' 로 시작
  }
  return null
}

/** 소제목에 맞는 문: 전용 그림이 있으면 그것, 없으면 사용자가 그린 문 그림을 틀로 쓰고 소제목 이름을 붙인다(같은 대제목 = 같은 문). */
export function gateArtFor(g: HunterAssets['gates'], section: string, topic: string): GateArt | undefined {
  const own = g.byTitle.get(topic)
  if (own) return own
  const list = [...g.byTitle.values()]
  if (!list.length) return undefined
  const tpl = pickTemplate(list, section)
  return { ...tpl, title: topic, labelLines: wrapTitle(topic) }
}
