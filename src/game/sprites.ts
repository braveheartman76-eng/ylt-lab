// 그림 선명도/효과 도구(브라우저 전용). 캔버스 크기에 맞춰 큰 그림을 미리 단계적으로 줄여 두면
// 한 번에 확 줄여 그릴 때보다 훨씬 선명하다. 색 입힌 그림(피격 붉은색/타격 흰색)은 한 번만 만들어 재사용한다.
export type Drawable = HTMLImageElement | HTMLCanvasElement

export const dimOf = (d: Drawable): [number, number] => (d instanceof HTMLImageElement ? [d.naturalWidth, d.naturalHeight] : [d.width, d.height])

const ids = new WeakMap<object, number>()
let seq = 0
const idOf = (o: object) => { let v = ids.get(o); if (!v) { v = ++seq; ids.set(o, v) } return v }

const smoothCache = new Map<string, HTMLCanvasElement>()
const MAX_CACHE = 200

/** 화면에 그릴 크기(논리 단위 destW×destH, 기기 픽셀은 scale 배)에 맞게 단계적으로 줄인 그림을 돌려준다. */
export function smooth(img: HTMLImageElement, destW: number, destH: number, scale: number): Drawable {
  const tw = Math.max(1, Math.ceil(destW * scale))
  const th = Math.max(1, Math.ceil(destH * scale))
  if (img.naturalWidth <= tw * 1.5) return img // 이미 알맞은 크기
  const key = `${idOf(img)}:${Math.round(tw / 4)}:${Math.round(th / 4)}`
  const hit = smoothCache.get(key)
  if (hit) return hit
  let cur: Drawable = img
  let cw = img.naturalWidth
  let ch = img.naturalHeight
  while (cw / 2 >= tw) { // 절반씩 줄여가며 부드럽게
    const c = document.createElement('canvas')
    c.width = Math.ceil(cw / 2); c.height = Math.ceil(ch / 2)
    const g = c.getContext('2d')!
    g.imageSmoothingQuality = 'high'
    g.drawImage(cur, 0, 0, c.width, c.height)
    cur = c; cw = c.width; ch = c.height
  }
  const out = document.createElement('canvas')
  out.width = tw; out.height = th
  const g = out.getContext('2d')!
  g.imageSmoothingQuality = 'high'
  g.drawImage(cur, 0, 0, tw, th)
  if (smoothCache.size > MAX_CACHE) smoothCache.clear()
  smoothCache.set(key, out)
  return out
}

const tintCache = new WeakMap<object, Map<string, HTMLCanvasElement>>()

/** 그림의 불투명한 부분에만 색을 입힌 복사본(피격=붉은색, 타격=흰색, 악당 공격=주황 기운). */
export function tinted(d: Drawable, color: string, alpha: number): HTMLCanvasElement {
  let m = tintCache.get(d)
  if (!m) { m = new Map(); tintCache.set(d, m) }
  const key = `${color}|${alpha}`
  const hit = m.get(key)
  if (hit) return hit
  const [w, h] = dimOf(d)
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')!
  g.drawImage(d, 0, 0)
  g.globalCompositeOperation = 'source-atop' // 그림이 있는 픽셀 위에만
  g.globalAlpha = alpha
  g.fillStyle = color
  g.fillRect(0, 0, w, h)
  m.set(key, c)
  return c
}
