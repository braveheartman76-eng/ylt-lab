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
