// 그림 자료(manifest)가 가리키는 파일이 모두 존재하는지, 단원 문 8개가 문제집 소제목과 매핑되는지 점검한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

const ROOT = 'public/hunter-assets/'
const manifest = JSON.parse(readFileSync(ROOT + 'manifest.json', 'utf8'))
const gm = JSON.parse(readFileSync(ROOT + 'gates/gate-manifest.json', 'utf8'))

test('manifest.json 이 가리키는 배경/캐릭터/몬스터/NPC 파일이 모두 존재', () => {
  const files = []
  for (const b of Object.values(manifest.backgrounds)) files.push(b.src)
  for (const c of Object.values(manifest.characters)) files.push(...Object.values(c.poses))
  for (const e of Object.values(manifest.enemies)) files.push(e.src)
  for (const n of Object.values(manifest.npcs)) files.push(n.src)
  const missing = files.filter(f => !existsSync(ROOT + f))
  assert.deepEqual(missing, [])
  assert.ok(files.length >= 18)
})

test('단원 문 8개: 파일 존재, 간판 글자영역/통과영역이 0~1 범위, 문제 번호 중복 없음', () => {
  assert.equal(gm.gates.length, 8)
  const seen = new Set()
  for (const g of gm.gates) {
    assert.ok(existsSync(ROOT + 'gates/' + g.src), g.src)
    for (const box of [g.labelBox, g.openingBox]) {
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1.0001 && box.y + box.height <= 1.0001, g.id)
    }
    assert.ok(g.labelLines.join('').replace(/\s/g, '').length >= g.title.replace(/\s|—/g, '').length - 2, g.id + ' 간판 글자')
    for (const r of g.questionRefs) { assert.ok(!seen.has(r), '중복 번호 ' + r); seen.add(r) }
  }
  assert.equal(seen.size, 24) // 붙여준 원고 24문항(1~15, 변형 포함)을 빠짐없이 덮는다
})

test('게임 캐릭터 이미지는 모두 같은 크기(포즈 전환 시 튀지 않음)', () => {
  const dims = new Set()
  for (const k of ['male', 'female']) for (const p of ['idle', 'run', 'attack']) {
    const b = readFileSync(ROOT + manifest.characters[k].poses[p])
    dims.add(`${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`)
  }
  assert.equal(dims.size, 1)
})

test('달리기 프레임: 6벌 × 8장이 모두 존재하고 480×384, 표시 크기 보정값(run-fit)이 있다', () => {
  const dir = ROOT + 'animation/run/'
  const run = JSON.parse(readFileSync(dir + 'run-manifest.json', 'utf8'))
  const fit = JSON.parse(readFileSync(dir + 'run-fit.json', 'utf8')).heightPct
  const keys = ['male', 'female', 'male-veteran', 'female-veteran', 'male-legendary', 'female-legendary']
  assert.deepEqual(Object.keys(run.sets).sort(), [...keys].sort())
  for (const k of keys) {
    const frames = run.sets[k]
    assert.equal(frames.length, 8, k)
    for (const url of frames) {
      const f = dir + url.split('/').pop()
      assert.ok(existsSync(f), f)
      const b = readFileSync(f)
      assert.equal(`${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`, '480x384', f)
    }
    assert.ok(fit[k] > 0.3 && fit[k] < 0.5, `${k} fit ${fit[k]}`)
  }
})
