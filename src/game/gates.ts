// 단원 문(소제목)의 간판 글자 계산(순수 함수). 전용 그림이 없는 소제목은 사용자가 그린 문 그림을 '틀'로 쓰고
// 그 위에 소제목 이름을 붙인다. 같은 대제목은 같은 문(색)을 쓴다.

/** 문자열을 항상 같은 정수로 (재방문해도 같은 문이 나오도록) */
export function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

export function pickTemplate<T>(templates: T[], key: string): T {
  return templates[hashStr(key) % templates.length]
}

/** 간판에 들어갈 줄바꿈: 짧으면 1줄, 길면 ' — ' 기준 → 가운데에 가까운 공백 → 가운데 글자 순서로 2줄(필요하면 3줄) */
export function wrapTitle(title: string, maxPerLine = 9): string[] {
  const t = title.replace(/\s+/g, ' ').trim()
  if (t.length <= maxPerLine) return [t]
  const dash = t.split(/\s*[—–]\s*/)
  if (dash.length === 2 && dash[0] && dash[1]) return dash.every(s => s.length <= maxPerLine * 1.4) ? dash : [...wrapTitle(dash[0], maxPerLine), ...wrapTitle(dash[1], maxPerLine)].slice(0, 3)
  const mid = t.length / 2
  let best = -1
  for (let i = 0; i < t.length; i++) if (t[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i
  if (best > 0 && Math.max(best, t.length - best - 1) <= maxPerLine * 1.6) return [t.slice(0, best), t.slice(best + 1)]
  const cut = Math.ceil(t.length / 2)
  return [t.slice(0, cut), t.slice(cut)]
}
