import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { wrapTitle, pickTemplate, hashStr } from '../../src/game/gates.ts'

test('간판 줄바꿈: 짧으면 1줄, 긴 이름은 2줄(' + "' — '" + ' 기준 우선), 글자가 사라지지 않는다', () => {
  assert.deepEqual(wrapTitle('대법원규칙'), ['대법원규칙'])
  assert.deepEqual(wrapTitle('헌법 명시 — 신체의 자유'), ['헌법 명시', '신체의 자유'])
  const two = wrapTitle('위법수집증거배제법칙의 적용범위')
  assert.equal(two.length, 2)
  assert.equal(two.join(' ').replace(/\s/g, ''), '위법수집증거배제법칙의적용범위')
})

test('문제집 소제목 전부: 간판이 1~3줄이고 글자가 보존된다', () => {
  const rows = readFileSync('game-content/questions.json', 'utf8')
  const topics = [...new Set(JSON.parse(rows).questions.map(q => q.topic))]
  assert.ok(topics.length >= 30)
  for (const t of topics) {
    const lines = wrapTitle(t)
    assert.ok(lines.length >= 1 && lines.length <= 3, t)
    assert.equal(lines.join('').replace(/[\s—–]/g, ''), t.replace(/[\s—–]/g, ''), t)
    assert.ok(lines.every(l => l.length <= 16), t + ' → ' + lines.join('|'))
  }
})

test('문 틀 선택: 같은 대제목은 항상 같은 문, 해시는 결정적', () => {
  const tpl = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
  assert.equal(pickTemplate(tpl, '형사소송법의 적용범위'), pickTemplate(tpl, '형사소송법의 적용범위'))
  assert.equal(hashStr('x'), hashStr('x'))
  const used = new Set(['의의', '법원', '적용범위', '실체적 진실주의', '적정절차', '신속한 재판', '기본구조'].map(s => pickTemplate(tpl, s)))
  assert.ok(used.size >= 3, '대제목마다 다양한 문 색이 쓰인다')
})
