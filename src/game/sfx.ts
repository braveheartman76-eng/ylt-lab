// 효과음/배경음: 파일 없이 WebAudio 로 직접 합성한다(저작권·용량 문제 없음). 모바일은 사용자 터치 후에만 재생되므로
// unlockSfx()를 첫 터치(공부 시작 버튼)에서 호출한다. 설정은 configureSfx()로 전달(켜기/끄기, 볼륨, 배경음악).
export type SfxName =
  | 'select' | 'tension' | 'attack' | 'correct' | 'critical' | 'enemyAttack' | 'hit' | 'wrong'
  | 'coin' | 'gate' | 'ambush' | 'clear' | 'levelup'

export interface SfxSettings { enabled: boolean; volume: number; bgm?: boolean }

type AC = typeof AudioContext
let ctx: AudioContext | null = null
let master: GainNode | null = null
let cfg: Required<SfxSettings> = { enabled: true, volume: 0.6, bgm: false }
let noiseBuf: AudioBuffer | null = null

export function configureSfx(s: SfxSettings) {
  cfg = { enabled: s.enabled, volume: Math.min(1, Math.max(0, s.volume)), bgm: !!s.bgm }
  if (master) master.gain.value = cfg.volume * 0.55
  if (!cfg.enabled || !cfg.bgm) stopBgm()
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
      master.gain.value = cfg.volume * 0.55
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

function tone(c: AudioContext, t0: number, freq: number, dur: number, type: OscillatorType, gain: number, endFreq?: number, out: AudioNode = master!) {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t0)
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g).connect(out)
  o.start(t0)
  o.stop(t0 + dur + 0.02)
}

/** 잡음. cutoff 가 endCutoff 로 빠르게 변하면 '쉬익' 하는 휘두름 소리가 된다. */
function noise(c: AudioContext, t0: number, dur: number, gain: number, cutoff: number, endCutoff?: number, type: BiquadFilterType = 'lowpass', out: AudioNode = master!) {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.6), c.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  const s = c.createBufferSource()
  s.buffer = noiseBuf
  const f = c.createBiquadFilter()
  f.type = type
  f.frequency.value = cutoff
  if (endCutoff) f.frequency.exponentialRampToValueAtTime(endCutoff, t0 + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  s.connect(f).connect(g).connect(out)
  s.start(t0)
  s.stop(t0 + Math.min(dur + 0.02, 0.58))
}

/** 쿵! 하는 저음 킥(타격감의 핵심): 사인파가 빠르게 내려가며 + 짧은 클릭 */
function kick(c: AudioContext, t0: number, gain = 0.9, f0 = 170, f1 = 42, dur = 0.22) {
  tone(c, t0, f0, dur, 'sine', gain, f1)
  noise(c, t0, 0.04, gain * 0.5, 3500)
}

const N = (semitonesFromA4: number) => 440 * Math.pow(2, semitonesFromA4 / 12)

export function playSfx(name: SfxName) {
  if (!cfg.enabled || cfg.volume <= 0) return
  const c = ensure()
  if (!c || !master) return
  const t = c.currentTime + 0.01
  switch (name) {
    case 'select': // 선택 '딱'
      tone(c, t, 1100, 0.05, 'square', 0.22, 700)
      kick(c, t, 0.35, 140, 70, 0.08)
      break
    case 'tension': // 대치: 심장 박동 같은 북소리가 빨라지며 + 위로 차오르는 잡음
      ;[0, 0.17, 0.31, 0.42, 0.51].forEach((d, i) => kick(c, t + d, 0.45 + i * 0.1, 120 + i * 12, 55, 0.14))
      noise(c, t, 0.58, 0.22, 400, 5000, 'highpass')
      tone(c, t, 90, 0.6, 'sawtooth', 0.12, 220)
      break
    case 'attack': // 휘두름: 쉬이익 + 날카로운 내려침
      noise(c, t, 0.2, 0.55, 700, 6000, 'bandpass')
      tone(c, t, 1000, 0.16, 'sawtooth', 0.16, 220)
      break
    case 'correct': // 명중: 쾅 + 균열 + 밝은 파워 코드
      kick(c, t, 1, 190, 40, 0.26)
      noise(c, t, 0.12, 0.7, 6000, 900)
      ;[N(-5), N(2), N(7)].forEach(f => tone(c, t + 0.03, f, 0.3, 'square', 0.16))
      tone(c, t + 0.1, N(14), 0.35, 'triangle', 0.4)
      break
    case 'critical': // 크리티컬: 쌍킥 + 크래시 + 상승 아르페지오 + 낮은 폭발
      kick(c, t, 1, 210, 36, 0.34)
      kick(c, t + 0.1, 1, 190, 34, 0.34)
      noise(c, t, 0.5, 0.85, 8000, 700)
      ;[0, 4, 7, 12, 16].forEach((s, i) => tone(c, t + 0.08 + i * 0.06, N(s - 9), 0.22, 'square', 0.22))
      tone(c, t + 0.4, N(19), 0.5, 'triangle', 0.5)
      tone(c, t, 55, 0.5, 'sawtooth', 0.35, 30)
      break
    case 'enemyAttack': // 악당 덮치기: 으르렁(떨림) + 거친 쉬익
      tone(c, t, 210, 0.38, 'sawtooth', 0.3, 80)
      tone(c, t, 217, 0.38, 'square', 0.14, 85)
      noise(c, t + 0.12, 0.26, 0.55, 500, 4500, 'bandpass')
      break
    case 'hit': // 내가 맞음: 묵직한 퍽 + 우지끈
      kick(c, t, 1, 150, 32, 0.32)
      noise(c, t, 0.3, 0.8, 1400, 250)
      tone(c, t, 72, 0.26, 'square', 0.3, 40)
      break
    case 'wrong': // 오답: 하강하는 불협화음
      tone(c, t, 233, 0.45, 'sawtooth', 0.26, 98)
      tone(c, t, 165, 0.45, 'square', 0.18, 70)
      noise(c, t, 0.2, 0.3, 1800, 300)
      break
    case 'coin': // 짧은 반짝
      tone(c, t, N(15), 0.07, 'square', 0.16)
      tone(c, t + 0.06, N(22), 0.14, 'square', 0.16)
      break
    case 'gate': // 문 통과: 웅장한 차임
      ;[0, 4, 7, 12].forEach((s, i) => tone(c, t + i * 0.08, N(s), 0.42, 'triangle', 0.3))
      kick(c, t, 0.35, 110, 55, 0.18)
      break
    case 'ambush': // 불시 공격 경고: 사이렌
      for (let i = 0; i < 4; i++) tone(c, t + i * 0.14, i % 2 ? 360 : 520, 0.12, 'square', 0.22)
      break
    case 'clear': // 스테이지 클리어: 파워 팡파르
      ;[0, 4, 7, 12].forEach((s, i) => { tone(c, t + i * 0.11, N(s - 9), 0.3, 'sawtooth', 0.22); tone(c, t + i * 0.11, N(s - 21), 0.3, 'square', 0.2) })
      ;[N(7), N(12), N(16)].forEach(f => tone(c, t + 0.5, f, 0.8, 'triangle', 0.4))
      kick(c, t + 0.5, 0.9, 180, 40, 0.3)
      noise(c, t + 0.5, 0.6, 0.5, 7000, 1500)
      break
    case 'levelup': // 레벨업/성장: 빠르게 오르는 상승음 + 반짝
      ;[0, 4, 7, 12, 16, 19, 24].forEach((s, i) => tone(c, t + i * 0.07, N(s - 5), 0.22, 'triangle', 0.4))
      tone(c, t + 0.55, N(24 - 5), 0.7, 'sine', 0.45)
      kick(c, t, 0.5, 150, 50, 0.2)
      break
  }
}

// ───────────────────────── 전투 배경음악(선택): 8비트 느낌의 빠른 루프. 효과음보다 훨씬 작게.
let bgmTimer: ReturnType<typeof setInterval> | null = null
let bgmStep = 0
let bgmNext = 0
const BPM = 142
const STEP_S = 60 / BPM / 2 // 8분음표
const BASS = [-24, -24, -21, -24, -17, -24, -22, -24] // A 단조 베이스 라인(반음)
const LEAD = [0, 3, 7, 3, 0, 5, 7, 12] // 짧은 리드 멜로디(마디 단위 반복)

function bgmSchedule(c: AudioContext, step: number, t0: number) {
  const i = step % 8
  const bar = Math.floor(step / 8) % 4
  tone(c, t0, N(BASS[i]), STEP_S * 0.9, 'square', 0.07)
  if (i % 4 === 0) kick(c, t0, 0.32, 130, 48, 0.12) // 1·3박 킥
  if (i % 4 === 2) noise(c, t0, 0.07, 0.16, 5000, 1500, 'highpass') // 2·4박 스네어
  noise(c, t0, 0.03, 0.05, 9000, 6000, 'highpass') // 8분 하이햇
  if (bar % 2 === 1 && i % 2 === 0) tone(c, t0, N(LEAD[i] - 5 + (bar === 3 ? 5 : 0)), STEP_S * 1.4, 'triangle', 0.07)
}

export function startBgm() {
  if (!cfg.enabled || !cfg.bgm || bgmTimer) return
  const c = ensure()
  if (!c || !master) return
  bgmStep = 0
  bgmNext = c.currentTime + 0.05
  const pump = () => {
    if (!ctx) return
    while (bgmNext < ctx.currentTime + 0.15) { bgmSchedule(ctx, bgmStep, bgmNext); bgmNext += STEP_S; bgmStep++ }
  }
  pump()
  bgmTimer = setInterval(pump, 40)
}

export function stopBgm() {
  if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null }
}

export const bgmPlaying = () => bgmTimer !== null
