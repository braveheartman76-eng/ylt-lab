// 브라우저 Web Speech API 기반 TTS. 독립 모듈이라 나중에 고품질 음성 파일 재생으로 교체할 수 있다.
// 모바일 브라우저는 사용자 터치 후에만 재생되므로 unlockTts()를 첫 터치(게임 시작 버튼)에서 호출한다.

export interface TtsSettings {
  enabled: boolean
  rate: number // 0.7 ~ 1.5
}

export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window

let voice: SpeechSynthesisVoice | null = null

function pickVoice() {
  if (!ttsSupported()) return null
  const vs = window.speechSynthesis.getVoices()
  voice = vs.find(v => v.lang?.toLowerCase().startsWith('ko')) ?? null
  return voice
}

/** 사용자 제스처 안에서 호출: 빈 발화를 한 번 재생해 모바일 오디오 잠금을 푼다. */
export function unlockTts() {
  if (!ttsSupported()) return
  const u = new SpeechSynthesisUtterance(' ')
  u.volume = 0
  window.speechSynthesis.speak(u)
  pickVoice()
}

export function speak(text: string, s: TtsSettings) {
  if (!s.enabled || !ttsSupported() || !text.trim()) return
  const synth = window.speechSynthesis
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ko-KR'
  u.rate = Math.min(1.5, Math.max(0.7, s.rate))
  const v = voice ?? pickVoice()
  if (v) u.voice = v
  synth.speak(u)
}

export function stopSpeaking() {
  if (ttsSupported()) window.speechSynthesis.cancel()
}

/** 보기 좋은 기호를 읽기 좋게: 선지 번호/○× 등 */
export function readable(text: string) {
  return text.replace(/㉠/g, '가').replace(/㉡/g, '나').replace(/㉢/g, '다').replace(/㉣/g, '라').replace(/㉤/g, '마')
    .replace(/ㄱ\./g, '가.').replace(/ㄴ\./g, '나.').replace(/ㄷ\./g, '다.').replace(/ㄹ\./g, '라.')
}
