// 성장 단계(world.ts)와 성장 팩 manifest 가 서로 맞는지, 규칙이 의도대로 동작하는지 검사한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { TIERS, tierOf, unlockedPets, nextTier, bossFor, bossForm, stageHp, enemyKeyFor, isBossStage } from '../../src/game/world.ts'

const ROOT = 'public/hunter-assets/'
const prog = JSON.parse(readFileSync(ROOT + 'progression/progression-manifest.json', 'utf8'))
const base = JSON.parse(readFileSync(ROOT + 'manifest.json', 'utf8'))

test('성장 팩 manifest 가 가리키는 이미지 28개(펫8·무기4·보스6·헌터8·배경2)가 모두 존재', () => {
  const files = [
    ...Object.values(prog.pets), ...Object.values(prog.weapons), ...Object.values(prog.bosses),
    ...Object.values(prog.characters), ...Object.values(prog.backgrounds),
  ].map(x => x.src)
  assert.equal(files.length, 8 + 4 + 6 + 8 + 2)
  assert.deepEqual(files.filter(f => !existsSync(ROOT + f)), [])
})

test('TIERS 와 manifest.exampleTiers 가 일치 (펫/무기/보스/헌터 세트/배경)', () => {
  assert.equal(TIERS.length, prog.exampleTiers.length)
  for (const t of TIERS) {
    const ex = prog.exampleTiers.find(e => e.tier === t.tier)
    assert.deepEqual(t.pets, ex.petUnlocks, `tier${t.tier} pets`)
    assert.equal(t.heroSet, ex.hunterSet)
    const w = ex.weapon === 'starterWeapon' ? null : ex.weapon
    assert.equal(t.weapon, w)
    if (t.weapon) assert.ok(prog.weapons[t.weapon], t.weapon)
    for (const p of t.pets) assert.ok(prog.pets[p], p)
    // 보스: 기본 팩(inkBoss) 또는 성장 팩
    const bossExists = t.boss === 'inkBoss' ? !!base.enemies.inkBoss : !!prog.bosses[t.boss]
    assert.ok(bossExists, t.boss)
    // 보스 전용 배경: 기본 팩 또는 성장 팩에 존재
    if (t.bossBg) assert.ok(base.backgrounds[t.bossBg] || prog.backgrounds[t.bossBg], t.bossBg)
    // 정예/전설 헌터 그림 세트(남/여 × 대기/공격)
    if (t.heroSet !== 'starter') for (const h of ['male', 'female']) for (const pose of ['ready', 'attack']) {
      assert.ok(prog.characters[`${h}-${t.heroSet}-${pose}`], `${h}-${t.heroSet}-${pose}`)
    }
  }
  assert.ok(prog.bosses['obsidian-king'] && prog.bosses['obsidian-king-enraged'] && prog.bosses['abyssal-colossus'])
})

test('레벨 → 성장 단계 경계값', () => {
  const at = l => tierOf(l).tier
  assert.deepEqual([1, 2, 3, 5, 6, 9, 10, 14, 15, 99].map(at), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5])
  assert.equal(nextTier(5), null)
  assert.equal(nextTier(1).minLevel, 3)
})

test('펫은 단계가 오를수록 누적 해금(총 8종), 무기·보스가 단계별로 바뀐다', () => {
  assert.equal(unlockedPets(1).length, 2)
  assert.equal(unlockedPets(3).length, 6)
  assert.deepEqual([...unlockedPets(5)].sort(), Object.keys(prog.pets).sort())
  assert.deepEqual(TIERS.map(t => t.weapon), [null, 'crystal-sword', 'verdict-hammer', 'azure-dragon-glaive', 'justice-greatsword'])
})

test('보스: 단계별 보스, 전설 단계는 심연 괴수 ↔ 흑요석 용왕 교대, 절반 이하 체력에서 폭주', () => {
  assert.equal(bossFor(5, 1), 'inkBoss')
  assert.equal(bossFor(5, 2), 'iron-warden')
  assert.equal(bossFor(5, 3), 'crimson-ink-demon')
  assert.equal(bossFor(5, 4), 'magma-dragon')
  assert.deepEqual([5, 10, 15, 20].map(s => bossFor(s, 5)), ['abyssal-colossus', 'obsidian-king', 'abyssal-colossus', 'obsidian-king'])
  assert.equal(bossForm('obsidian-king', 5, 8), 'obsidian-king')
  assert.equal(bossForm('obsidian-king', 4, 8), 'obsidian-king-enraged')
  assert.equal(bossForm('magma-dragon', 1, 8), 'magma-dragon')
})

test('스테이지: 보스는 체력 8, 일반 5. 일반 몬스터 5종이 보스 스테이지를 건너뛰며 순환', () => {
  assert.equal(stageHp(5), 8); assert.equal(stageHp(4), 5); assert.ok(isBossStage(10))
  const seq = [1, 2, 3, 4, 6, 7].map(s => enemyKeyFor(s))
  assert.deepEqual(seq, ['inkSlime', 'falsePrecedentGhost', 'prisonCage', 'hourglassGoblin', 'statuteMimic', 'inkSlime'])
  assert.equal(enemyKeyFor(5, 2), 'iron-warden')
})
