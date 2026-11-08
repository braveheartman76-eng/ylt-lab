// 게임 스키마/복습 엔진 검증: 실제 SQL 을 PGlite(WASM Postgres)에 적용해 실행한다.
// 문항은 모두 가상 테스트 데이터(tools/ox_import/tests/fixtures)이다.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const UID = '11111111-1111-1111-1111-111111111111'

async function setup() {
  const db = new PGlite()
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated' $$;
    CREATE TABLE profiles (id uuid PRIMARY KEY, email text, name text, role text DEFAULT 'student');
    CREATE FUNCTION current_user_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT role FROM profiles WHERE id = auth.uid() $$;
    INSERT INTO profiles(id,email,name) VALUES ('${UID}','t@example.com','테스트학생');
  `)
  await db.exec(readFileSync('supabase/game/001_game_schema.sql', 'utf8'))
  await db.exec(readFileSync('supabase/game/002_seed_reference.sql', 'utf8'))
  const out = mkdtempSync(join(tmpdir(), 'oximp-'))
  execFileSync('python3', ['-I', 'tools/ox_import/ox_import.py', 'tools/ox_import/tests/fixtures/test_questions.txt',
    '--book', 'TEST-FIXTURE', '--out', out, '--test-data'], { stdio: 'pipe' })
  await db.exec(readFileSync(join(out, 'seed.sql'), 'utf8'))
  await db.exec(`UPDATE game_questions SET review_status='approved'`)
  await db.exec(`SET test.uid = '${UID}'`)
  return db
}

const q = async (db, no) =>
  (await db.query(`SELECT id FROM game_questions WHERE source_no=$1`, [no])).rows[0].id
const submit = async (db, id, sel) =>
  (await db.query(`SELECT game_submit_attempt($1,$2,1500) AS r`, [id, sel])).rows[0].r

test('import seeds pending test questions; unapproved cannot be served', async () => {
  const db = new PGlite()
  // 별도 인스턴스: 승인 전 상태 확인
  await db.exec(`CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${UID}'::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT 'authenticated' $$;
    CREATE TABLE profiles (id uuid PRIMARY KEY, email text, name text, role text DEFAULT 'student');
    CREATE FUNCTION current_user_role() RETURNS text LANGUAGE sql AS $$ SELECT 'student' $$;
    INSERT INTO profiles(id,email,name) VALUES ('${UID}','t@example.com','t');`)
  await db.exec(readFileSync('supabase/game/001_game_schema.sql', 'utf8'))
  await db.exec(readFileSync('supabase/game/002_seed_reference.sql', 'utf8'))
  const out = mkdtempSync(join(tmpdir(), 'oximp-'))
  execFileSync('python3', ['-I', 'tools/ox_import/ox_import.py', 'tools/ox_import/tests/fixtures/test_questions.txt',
    '--book', 'TEST-FIXTURE', '--out', out, '--test-data'], { stdio: 'pipe' })
  await db.exec(readFileSync(join(out, 'seed.sql'), 'utf8'))
  const c = (await db.query(`SELECT count(*)::int n, bool_and(is_test_data) t, bool_and(review_status='pending') p FROM game_questions`)).rows[0]
  assert.deepEqual(c, { n: 3, t: true, p: true })
  const id = (await db.query(`SELECT id FROM game_questions LIMIT 1`)).rows[0].id
  await assert.rejects(db.query(`SELECT game_submit_attempt($1,'O',1)`, [id]), /출제 가능한 문항이 아닙니다/)
  const f = (await db.query(`SELECT exam_frequency, exam_frequency_status FROM game_question_metadata LIMIT 1`)).rows[0]
  assert.deepEqual(f, { exam_frequency: null, exam_frequency_status: 'unverified' })
})

test('wrong answer: accumulates, same-day review, never deleted; correct climbs ladder', async () => {
  const db = await setup()
  const id = await q(db, '1') // 정답 O

  let r = await submit(db, id, 'X') // 첫 풀이 오답
  assert.equal(r.is_correct, false)
  assert.equal(r.box, 0)
  assert.equal(r.wrong_count, 1)
  assert.equal(r.correct_answer, 'O')
  assert.equal(r.xp_gained, 0)
  let s = (await db.query(`SELECT extract(epoch from next_review_at - now())::int AS sec FROM game_review_schedules`)).rows[0]
  assert.ok(s.sec > 25 * 60 && s.sec <= 30 * 60, '오답 직후 당일(30분) 재확인')

  // 복습 시점이 되었다고 가정
  const due = async () => db.exec(`UPDATE game_review_schedules SET next_review_at = now() - interval '1 minute'`)
  await due()
  r = await submit(db, id, 'O')
  assert.equal(r.was_review, true)
  assert.equal(r.box, 1) // 다음 날
  assert.equal(r.wrong_count, 1) // 오답 이력은 지워지지 않음
  assert.ok(r.xp_gained > 0)

  const expectedBox = [2, 3, 4, 5, 5]
  for (const b of expectedBox) {
    await due()
    r = await submit(db, id, 'O')
    assert.equal(r.box, b)
  }
  assert.equal(r.streak, 6)
  assert.equal(r.mastery, 100)
  const days = (await db.query(`SELECT extract(day from next_review_at - now())::int d FROM game_review_schedules`)).rows[0].d
  assert.ok(days >= 29, '최고 단계는 30일 간격')

  // 중간에 틀리면 간격 단축 (box 5 → 3), 누적 오답 증가
  await due()
  r = await submit(db, id, 'X')
  assert.equal(r.box, 3)
  assert.equal(r.wrong_count, 2)
  assert.equal(r.streak, 0)

  const n = (await db.query(`SELECT count(*)::int n, count(*) FILTER (WHERE NOT is_correct)::int w FROM game_answer_attempts`)).rows[0]
  assert.deepEqual(n, { n: 8, w: 2 }) // 모든 풀이가 개별 기록으로 보존
  const last = (await db.query(`SELECT attempt_no FROM game_answer_attempts ORDER BY attempted_at DESC, attempt_no DESC LIMIT 1`)).rows[0]
  assert.equal(last.attempt_no, 8)
})

test('no reward farming: correct but not due / not first gives 0 xp', async () => {
  const db = await setup()
  const id = await q(db, '3')
  let r = await submit(db, id, 'O') // 첫 풀이 정답
  assert.equal(r.box, 2)
  assert.ok(r.xp_gained > 0)
  r = await submit(db, id, 'O') // 복습 예정 아님
  assert.equal(r.was_review, false)
  assert.equal(r.xp_gained, 0)
  assert.equal(r.coins_gained, 0)
})

test('attempts and question versions are append-only', async () => {
  const db = await setup()
  const id = await q(db, '2')
  await submit(db, id, 'X')
  await assert.rejects(db.exec(`DELETE FROM game_answer_attempts`), /append-only/)
  await assert.rejects(db.exec(`UPDATE game_answer_attempts SET is_correct = NOT is_correct`), /append-only/)
  await assert.rejects(db.exec(`UPDATE game_question_versions SET answer='O'`), /append-only/)
})

test('revision: new version keeps old attempts pointing at the version studied', async () => {
  const db = await setup()
  const id = await q(db, '1')
  await submit(db, id, 'O')
  const v1 = (await db.query(`SELECT current_version_id v FROM game_questions WHERE id=$1`, [id])).rows[0].v
  const v2 = (await db.query(`
    INSERT INTO game_question_versions(question_id,version_no,statement,answer,explanation,change_note)
    VALUES ($1,2,'[테스트] 개정된 가상 문항','X','개정 해설','법령 개정(가상)') RETURNING id`, [id])).rows[0].id
  await db.query(`UPDATE game_questions SET current_version_id=$2 WHERE id=$1`, [id, v2])
  await db.exec(`UPDATE game_review_schedules SET next_review_at = now() - interval '1 minute'`)
  const r = await submit(db, id, 'X') // 개정판 기준 정답
  assert.equal(r.is_correct, true)
  const rows = (await db.query(`SELECT question_version_id v FROM game_answer_attempts ORDER BY attempt_no`)).rows
  assert.equal(rows[0].v, v1)
  assert.equal(rows[1].v, v2)
})

test('unit mastery stats, due list and deactivated questions', async () => {
  const db = await setup()
  const a = await q(db, '1'), b = await q(db, '2')
  await submit(db, a, 'X')  // 오답
  await submit(db, b, 'X')  // 정답
  const st = (await db.query(`SELECT sum(attempts)::int a, sum(correct)::int c, sum(first_attempts)::int f, sum(first_correct)::int fc FROM game_mastery_stats`)).rows[0]
  assert.deepEqual(st, { a: 2, c: 1, f: 2, fc: 1 })
  await db.exec(`UPDATE game_review_schedules SET next_review_at = now() - interval '1 minute' WHERE question_id='${a}'`)
  const dueRows = (await db.query(`SELECT * FROM game_due_reviews(10)`)).rows
  assert.equal(dueRows.length, 1)
  assert.equal(dueRows[0].question_id, a)
  assert.ok(!('answer' in dueRows[0]), '복습 목록에 정답 미노출')
  await db.exec(`UPDATE game_questions SET is_active=false, deactivated_reason='법령 개정(가상)' WHERE id='${a}'`)
  assert.equal((await db.query(`SELECT * FROM game_due_reviews(10)`)).rows.length, 0)
  await assert.rejects(submit(db, a, 'O'), /출제 가능한 문항이 아닙니다/)
  const pq = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='game_playable_questions'`)).rows.map(x => x.column_name)
  assert.ok(!pq.includes('answer') && !pq.includes('explanation'))
})

test('exam_frequency requires verified status', async () => {
  const db = await setup()
  const id = await q(db, '1')
  await assert.rejects(db.query(`UPDATE game_question_metadata SET exam_frequency=3 WHERE question_id=$1`, [id]), /freq_requires_verified/)
  await db.query(`UPDATE game_question_metadata SET exam_frequency=3, exam_frequency_status='verified' WHERE question_id=$1`, [id])
})
