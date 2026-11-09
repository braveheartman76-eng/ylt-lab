// 효과음: 파일 없이 WebAudio 로 직접 합성한다(저작권·용량 문제 없음). 모바일은 사용자 터치 후에만 재생되므로
// unlockSfx()를 첫 터치(공부 시작 버튼)에서 호출한다. 설정은 configureSfx()로 전달(켜기/끄기, 볼륨).
export type SfxName = 'correct' | 'wrong' | 'critical' | 'jump' | 'hit' | 'coin' | 'gate' | 'ambush' | 'clear' | 'levelup' | 'attack'

export interface SfxSettings { enabled: boolean; volume: number }

type AC = typeof AudioContext
let ctx: AudioContext | null = null
let master: GainNode | null = null
let cfg: SfxSettings = { enabled: true, volume: 0.6 }
let noiseBuf: AudioBuffer | null = null

export function configureSfx(s: SfxSettings) {
  cfg = { enabled: s.enabled, volume: Math.min(1, Math.max(0, s.volume)) }
  if (master) master.gain.value = cfg.volume * 0.5
}

function ensure(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const w = window as unknown as { AudioContext?: AC; webkitAudioContext?: AC }
    const Ctor = w.AudioContext ?? w.webkitAudioContext
    if (!Ctor) return null
    try {
      ctx = new Ctor()
      master = ctx.createGain()
      master.gain.value = cfg.volume * 0.5
      master.connect(ctx.destination)
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** 사용자 제스처 안에서 호출: 오디오 잠금 해제 */
export function unlockSfx() {
  ensure()
}

function tone(c: AudioContext, t0: number, freq: number, dur: number, type: OscillatorType, gain: number, endFreq?: number) {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t0)
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g).connect(master!)
  o.start(t0)
  o.stop(t0 + dur + 0.02)
}

function noise(c: AudioContext, t0: number, dur: number, gain: number, cutoff: number) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.5), c.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  const s = c.createBufferSource()
  s.buffer = noiseBuf
  const f = c.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.value = cutoff
  const g = c.createGain()
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  s.connect(f).connect(g).connect(master!)
  s.start(t0)
  s.stop(t0 + dur + 0.02)
}

const N = (semitonesFromA4: number) => 440 * Math.pow(2, semitonesFromA4 / 12)

export function playSfx(name: SfxName) {
  if (!cfg.enabled || cfg.volume <= 0) return
  const c = ensure()
  if (!c || !master) return
  const t = c.currentTime + 0.01
  switch (name) {
    case 'correct': // 밝은 두 음 '띵-동'
      tone(c, t, N(3), 0.16, 'triangle', 0.5)
      tone(c, t + 0.1, N(10), 0.32, 'triangle', 0.5)
      break
    case 'wrong': // 낮고 짧은 '부-웅'
      tone(c, t, 170, 0.34, 'sawtooth', 0.28, 95)
      tone(c, t, 175, 0.34, 'square', 0.12, 100)
      break
    case 'critical': // 휘익 + 상승 아르페지오
      noise(c, t, 0.22, 0.5, 4000)
      ;[0, 4, 7, 12].forEach((s, i) => tone(c, t + 0.05 + i * 0.07, N(s - 9), 0.22, 'square', 0.28))
      tone(c, t + 0.36, N(15), 0.4, 'triangle', 0.5)
      break
    case 'attack': // 베는 소리
      noise(c, t, 0.14, 0.35, 3000)
      tone(c, t, 500, 0.12, 'sawtooth', 0.12, 160)
      break
    case 'jump': // 통통 튀는 상승음
      tone(c, t, 320, 0.13, 'sine', 0.4, 700)
      break
    case 'hit': // 쿵
      noise(c, t, 0.18, 0.55, 700)
      tone(c, t, 150, 0.2, 'sine', 0.6, 55)
      break
    case 'coin': // 짧은 반짝
      tone(c, t, N(15), 0.07, 'square', 0.18)
      tone(c, t + 0.06, N(22), 0.14, 'square', 0.18)
      break
    case 'gate': // 문을 지날 때 부드러운 차임
      ;[0, 4, 9].forEach((s, i) => tone(c, t + i * 0.09, N(s), 0.35, 'sine', 0.3))
      break
    case 'ambush': // 불시 공격 경고음
      for (let i = 0; i < 3; i++) tone(c, t + i * 0.16, i % 2 ? 330 : 440, 0.13, 'square', 0.2)
      break
    case 'clear': // 스테이지 클리어 팡파르
      ;[0, 4, 7, 12].forEach((s, i) => tone(c, t + i * 0.12, N(s - 9), 0.3, 'triangle', 0.45))
      tone(c, t + 0.5, N(7), 0.7, 'triangle', 0.5)
      tone(c, t + 0.5, N(12), 0.7, 'triangle', 0.35)
      break
    case 'levelup': // 레벨업/성장 단계 상승
      ;[0, 4, 7, 12, 16, 19].forEach((s, i) => tone(c, t + i * 0.08, N(s - 5), 0.25, 'triangle', 0.42))
      tone(c, t + 0.55, N(19 - 5), 0.6, 'sine', 0.45)
      break
  }
}
