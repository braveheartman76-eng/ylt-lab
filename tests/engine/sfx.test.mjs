// 효과음 모듈 검사: 브라우저 오디오 장치를 흉내 낸 가짜 객체로 '소리 재료를 실제로 만드는지' 확인한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const counts = { osc: 0, noise: 0 }
const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} })
class FakeAC {
  constructor() { this.currentTime = 0; this.state = 'suspended'; this.sampleRate = 44100; this.destination = { dest: true }; FakeAC.last = this }
  resume() { this.state = 'running' }
  createGain() { const g = { gain: param(), connect(n) { return n } }; if (!this.master) this.master = g; return g } // 첫 번째 gain 이 마스터 볼륨
  createOscillator() { counts.osc++; return { type: '', frequency: param(), connect(n) { return n }, start() {}, stop() {} } }
  createBiquadFilter() { return { type: '', frequency: { value: 0, exponentialRampToValueAtTime() {} }, connect(n) { return n } } }
  createBuffer(_c, len) { return { getChannelData: () => new Float32Array(len) } }
  createBufferSource() { counts.noise++; return { buffer: null, connect(n) { return n }, start() {}, stop() {} } }
}

test('window 가 없는 환경(서버/테스트)에서는 아무 일도 하지 않고 오류도 없다', async () => {
  const { playSfx, unlockSfx, configureSfx } = await import('../../src/game/sfx.ts')
  configureSfx({ enabled: true, volume: 1 })
  assert.doesNotThrow(() => { unlockSfx(); playSfx('correct') })
})

test('모든 효과음이 실제로 소리 재료를 만들고, 꺼짐/볼륨 0 이면 조용하며, 볼륨이 범위로 제한된다', async () => {
  globalThis.window = { AudioContext: FakeAC }
  const { playSfx, unlockSfx, configureSfx } = await import('../../src/game/sfx.ts?fresh=1')
  const names = ['select', 'tension', 'attack', 'correct', 'critical', 'enemyAttack', 'hit', 'wrong', 'coin', 'gate', 'ambush', 'clear', 'levelup']
  configureSfx({ enabled: true, volume: 0.6 })
  unlockSfx()
  assert.equal(FakeAC.last.state, 'running', '첫 터치에서 오디오 잠금 해제(resume)')
  for (const n of names) {
    const before = counts.osc + counts.noise
    playSfx(n)
    assert.ok(counts.osc + counts.noise > before, n + ' 소리 재료 생성')
  }
  const total = counts.osc + counts.noise
  configureSfx({ enabled: false, volume: 0.6 }); playSfx('critical')
  configureSfx({ enabled: true, volume: 0 }); playSfx('critical')
  assert.equal(counts.osc + counts.noise, total, '꺼짐/볼륨 0 이면 재생 없음')
  configureSfx({ enabled: true, volume: 9 })
  assert.equal(FakeAC.last.master.gain.value, 0.55, '볼륨 9 → 상한 1 (마스터 게인 0.55)')
  configureSfx({ enabled: true, volume: -3 })
  assert.equal(FakeAC.last.master.gain.value, 0, '음수 볼륨 → 0')
  delete globalThis.window
})

test('임팩트 소리(정답/크리티컬/내가 맞음)는 일반 소리보다 소리 재료가 훨씬 많아 묵직하다', async () => {
  globalThis.window = { AudioContext: FakeAC }
  const { playSfx, unlockSfx, configureSfx } = await import('../../src/game/sfx.ts?fresh=2')
  configureSfx({ enabled: true, volume: 0.6 }); unlockSfx()
  const measure = n => { const b = counts.osc + counts.noise; playSfx(n); return counts.osc + counts.noise - b }
  assert.ok(measure('critical') >= 8, 'critical 은 쌍킥+크래시+아르페지오')
  assert.ok(measure('correct') >= 5 && measure('hit') >= 4 && measure('tension') >= 6)
  assert.ok(measure('critical') > measure('coin'))
  delete globalThis.window
})

test('배경음악: 켜면 박자에 맞춰 소리가 계속 예약되고, 끄면 멈추며, 꺼짐 설정이면 시작하지 않는다', async () => {
  globalThis.window = { AudioContext: FakeAC }
  const { configureSfx, unlockSfx, startBgm, stopBgm, bgmPlaying } = await import('../../src/game/sfx.ts?fresh=3')
  configureSfx({ enabled: true, volume: 0.6, bgm: false }); unlockSfx()
  startBgm()
  assert.equal(bgmPlaying(), false, 'bgm 설정이 꺼져 있으면 시작 안 함')
  configureSfx({ enabled: true, volume: 0.6, bgm: true })
  const before = counts.osc + counts.noise
  startBgm()
  assert.equal(bgmPlaying(), true)
  assert.ok(counts.osc + counts.noise > before, '시작하면 첫 마디가 예약됨')
  configureSfx({ enabled: true, volume: 0.6, bgm: false }) // 설정을 끄면 자동 정지
  assert.equal(bgmPlaying(), false)
  stopBgm()
  delete globalThis.window
})
