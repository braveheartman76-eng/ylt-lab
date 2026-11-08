// TS 엔진(로컬 모드)과 SQL game_submit_attempt(서버 모드)가 같은 결과를 내는지 무작위 순서로 대조한다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { applyAttempt } from '../../src/game/engine/srs.ts'

const UID = '22222222-2222-2222-2222-222222222222'

function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 }

test('TS applyAttempt == SQL game_submit_attempt (무작위 200회, 난이도 1~5)', async () => {
  const db = new PGlite()
  await db.exec(`CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${UID}'::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'authenticated' $$;
    CREATE TABLE profiles (id uuid PRIMARY KEY, email text, name text, role text DEFAULT 'student');
    CREATE FUNCTION current_user_role() RETURNS text LANGUAGE sql AS $$ SELECT 'student' $$;
    INSERT INTO profiles(id,email,name) VALUES ('${UID}','p@example.com','p');`)
  await db.exec(readFileSync('supabase/game/001_game_schema.sql', 'utf8'))
  await db.exec(readFileSync('supabase/game/002_seed_reference.sql', 'utf8'))
  const R = rng(42)
  const N_Q = 5
  const ids = []
  const diffs = []
  for (let i = 1; i <= N_Q; i++) {
    const d = i // 난이도 1..5
    const qid = (await db.query(`INSERT INTO game_questions(subject_id,source_book,source_no,review_status,is_test_data,current_version_id)
      VALUES ('criminal_law','PARITY',$1,'approved',true,NULL) RETURNING id`, [String(i)])).rows[0].id
    const vid = (await db.query(`INSERT INTO game_question_versions(question_id,version_no,statement,answer) VALUES ($1,1,'[테스트]','O') RETURNING id`, [qid])).rows[0].id
    await db.query(`UPDATE game_questions SET current_version_id=$2 WHERE id=$1`, [qid, vid])
    await db.query(`INSERT INTO game_question_metadata(question_id,difficulty_initial) VALUES ($1,$2)`, [qid, d])
    ids.push(qid); diffs.push(d)
  }
  await db.exec(`SET test.uid = '${UID}'`) // (auth.uid 는 고정 스텁)
  const ts = new Map()
  const NOW = 10_000_000_000_000
  for (let step = 0; step < 200; step++) {
    const k = Math.floor(R() * N_Q)
    const correct = R() < 0.6
    const wantDue = R() < 0.5
    // SQL 쪽: 이미 일정이 있으면 예정 상태를 강제
    if (ts.has(ids[k])) {
      await db.query(`UPDATE game_review_schedules SET next_review_at = ${wantDue ? `now() - interval '1 minute'` : `now() + interval '1 day'`} WHERE question_id=$1`, [ids[k]])
    }
    const sel = correct ? 'O' : 'X'
    const sql = (await db.query(`SELECT game_submit_attempt($1,$2,1000) r`, [ids[k], sel])).rows[0].r
    // TS 쪽: 같은 예정 상태로 맞춰서 계산
    let prev = ts.get(ids[k])
    if (prev) prev = { ...prev, nextReviewAt: wantDue ? NOW - 60_000 : NOW + 86_400_000 }
    const r = applyAttempt(prev, ids[k], correct, NOW, diffs[k])
    ts.set(ids[k], r.state)
    const where = `step ${step} q${k + 1} correct=${correct} due=${wantDue}`
    assert.equal(sql.box, r.state.box, 'box ' + where)
    assert.equal(sql.wrong_count, r.state.wrongCount, 'wrong ' + where)
    assert.equal(sql.streak, r.state.streak, 'streak ' + where)
    assert.equal(sql.mastery, r.state.mastery, 'mastery ' + where)
    assert.equal(sql.was_review, r.wasReview, 'review ' + where)
    assert.equal(sql.first_attempt, r.isFirst, 'first ' + where)
    assert.equal(sql.xp_gained, r.reward.xp, 'xp ' + where)
    assert.equal(sql.coins_gained, r.reward.coins, 'coins ' + where)
  }
  const sum = (await db.query(`SELECT xp, coins FROM game_progress`)).rows[0]
  assert.ok(sum.xp > 0)
})
