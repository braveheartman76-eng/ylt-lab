// 새 Supabase 프로젝트와 같은 조건(000 → 001 → 002 적용, authenticated 에 모든 테이블 권한 기본 부여)에서
// RLS/권한이 실제로 막는지 SET ROLE 로 강제 검증한다. (이전 테스트는 슈퍼유저라 RLS 를 우회했다)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const STUDENT = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'
const TEACHER = '33333333-3333-3333-3333-333333333333'

async function setup() {
  const db = new PGlite()
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT CASE WHEN nullif(current_setting('test.uid', true),'') IS NULL THEN 'anon' ELSE 'authenticated' END $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated;
  `)
  for (const f of ['000_bootstrap', '001_game_schema', '002_seed_reference']) await db.exec(readFileSync(`supabase/game/${f}.sql`, 'utf8'))
  // Supabase 기본값 흉내: public 의 모든 테이블/함수 권한이 authenticated 에 기본 부여되어 있고, RLS 가 접근을 정한다
  await db.exec(`GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
    REVOKE UPDATE ON public.profiles FROM authenticated; REVOKE INSERT, DELETE ON public.profiles FROM authenticated; GRANT UPDATE (name) ON public.profiles TO authenticated;`)
  for (const [id, email] of [[STUDENT, 's@example.com'], [OTHER, 'o@example.com'], [TEACHER, 't@example.com']]) await db.query(`INSERT INTO auth.users(id,email) VALUES ($1,$2)`, [id, email])
  await db.exec(`UPDATE profiles SET role='admin' WHERE id='${TEACHER}'`)
  // 승인된 문항 1개
  await db.exec(`
    INSERT INTO game_questions(id,subject_id,source_book,source_no,review_status,is_test_data) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','criminal_procedure','TEST','1','approved',true);
    INSERT INTO game_question_versions(id,question_id,version_no,statement,answer,explanation) VALUES ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',1,'[테스트] 문장','O','[테스트] 해설');
    UPDATE game_questions SET current_version_id='bbbbbbbb-0000-0000-0000-000000000001';
    INSERT INTO game_question_metadata(question_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000001');`)
  return db
}
const as = async (db, uid) => { await db.exec(`RESET ROLE; SET test.uid = '${uid ?? ''}'; SET ROLE authenticated`) }
const denied = (p) => assert.rejects(p, /permission denied|violates row-level security|new row violates/i)
const Q = 'aaaaaaaa-0000-0000-0000-000000000001'

test('새 프로젝트 준비: 가입하면 profiles 가 student 로 자동 생성', async () => {
  const db = await setup()
  const r = (await db.query(`SELECT role, email FROM profiles WHERE id=$1`, [STUDENT])).rows[0]
  assert.deepEqual(r, { role: 'student', email: 's@example.com' })
})

test('보안: 학생은 자기 role 을 admin 으로 바꿀 수 없다(이름만 수정 가능), 다른 사람 프로필은 못 본다', async () => {
  const db = await setup()
  await as(db, STUDENT)
  await denied(db.query(`UPDATE profiles SET role='admin' WHERE id='${STUDENT}'`))
  await db.query(`UPDATE profiles SET name='새이름' WHERE id='${STUDENT}'`)
  assert.equal((await db.query(`SELECT name FROM profiles WHERE id='${STUDENT}'`)).rows[0].name, '새이름')
  assert.equal((await db.query(`SELECT count(*)::int n FROM profiles`)).rows[0].n, 1, '본인 프로필만 보임')
  await denied(db.query(`INSERT INTO profiles(id,email) VALUES (gen_random_uuid(),'x@x')`))
  assert.equal((await db.query(`SELECT current_user_role() r`)).rows[0].r, 'student')
})

test('보안: 학생은 정답이 든 원본 문항/버전 테이블을 읽을 수 없고, 조회용 뷰에는 정답이 없다', async () => {
  const db = await setup()
  await as(db, STUDENT)
  assert.equal((await db.query(`SELECT count(*)::int n FROM game_questions`)).rows[0].n, 0)
  assert.equal((await db.query(`SELECT count(*)::int n FROM game_question_versions`)).rows[0].n, 0)
  const v = await db.query(`SELECT * FROM game_playable_questions`)
  assert.equal(v.rows.length, 1)
  assert.ok(!('answer' in v.rows[0]) && !('explanation' in v.rows[0]))
  await denied(db.query(`INSERT INTO game_questions(subject_id,source_book,source_no) VALUES ('criminal_law','X','9')`))
  await denied(db.query(`UPDATE game_questions SET review_status='approved'`).then(r => { if (r.affectedRows === 0) throw new Error('permission denied (0 rows)'); return r }))
})

test('보안: 학생은 채점 함수로만 기록을 남기고, 직접 쓰기/조작은 불가, 남의 기록은 못 본다', async () => {
  const db = await setup()
  await as(db, STUDENT)
  const r = (await db.query(`SELECT game_submit_attempt($1,'X',900) r`, [Q])).rows[0].r
  assert.equal(r.is_correct, false); assert.equal(r.correct_answer, 'O')
  // 직접 INSERT/UPDATE/DELETE 불가(RLS 정책 없음)
  await denied(db.query(`INSERT INTO game_answer_attempts(user_id,question_id,question_version_id,selected,is_correct,attempt_no,was_review,wrong_count_after,review_count_after,streak_after,mastery_after,next_review_after) VALUES ('${STUDENT}','${Q}','bbbbbbbb-0000-0000-0000-000000000001','O',true,1,false,0,0,1,40,now())`))
  await denied(db.query(`UPDATE game_review_schedules SET next_review_at = now() + interval '30 days'`).then(x => { if (x.affectedRows === 0) throw new Error('permission denied (0 rows)'); return x }))
  await denied(db.query(`UPDATE game_progress SET coins = 999999`).then(x => { if (x.affectedRows === 0) throw new Error('permission denied (0 rows)'); return x }))
  await denied(db.query(`DELETE FROM game_answer_attempts`).then(x => { if (x.affectedRows === 0) throw new Error('permission denied (0 rows)'); return x }))
  assert.equal((await db.query(`SELECT count(*)::int n FROM game_answer_attempts`)).rows[0].n, 1, '본인 기록은 보임')
  await as(db, OTHER)
  assert.equal((await db.query(`SELECT count(*)::int n FROM game_answer_attempts`)).rows[0].n, 0, '다른 학생 기록은 안 보임')
  assert.equal((await db.query(`SELECT count(*)::int n FROM game_review_schedules`)).rows[0].n, 0)
  assert.equal((await db.query(`SELECT count(*)::int n FROM game_progress`)).rows[0].n, 0)
})

test('비로그인(anon)은 채점 함수를 호출할 수 없다', async () => {
  const db = await setup()
  await db.exec(`RESET ROLE; SET test.uid = ''; SET ROLE anon`)
  await assert.rejects(db.query(`SELECT game_submit_attempt($1,'O',1)`, [Q]), /permission denied|로그인이 필요/)
})

test('선생님(admin)은 원본 문항·모든 학생 기록을 볼 수 있다', async () => {
  const db = await setup()
  await as(db, STUDENT); await db.query(`SELECT game_submit_attempt($1,'O',900)`, [Q])
  await as(db, TEACHER)
  assert.equal((await db.query(`SELECT count(*)::int n FROM game_questions`)).rows[0].n, 1)
  assert.equal((await db.query(`SELECT count(*)::int n FROM game_answer_attempts`)).rows[0].n, 1)
  assert.equal((await db.query(`SELECT count(*)::int n FROM profiles`)).rows[0].n, 3)
  assert.equal((await db.query(`SELECT current_user_role() r`)).rows[0].r, 'admin')
})
