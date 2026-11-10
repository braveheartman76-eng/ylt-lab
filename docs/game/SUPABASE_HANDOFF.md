# Supabase 개발 프로젝트 준비 — 인수인계

이 문서는 사용자 PC에서 도는 로컬 세션(브라우저 조작 가능)이 이어서 할 일을 적은 것이다.
게임 전체 현황은 `docs/game/STATUS.md` 참고.

## 지켜야 할 것
- 운영 프로젝트 `content-sales-site` (조직 `braveheartman76@gmail.com's Org`, 서울)는 **절대 변경 금지**. SQL 실행·설정 변경·정지·삭제 모두 하지 않는다.
- 프로젝트 삭제/정지, 유료 플랜 변경은 하지 않는다. 필요해 보이면 사용자에게 묻는다.
- DB 비밀번호, service_role(secret) 키는 채팅·저장소·문서에 남기지 않는다. 저장소에는 URL과 anon(publishable) 키도 커밋하지 않는다(`.env.local` 에만).
- 문제 정답/법적 근거를 임의로 바꾸지 않는다.

## 현재 상태
- 무료 프로젝트 자리 1개가 비어 있다(사용자가 고장 난 빈 프로젝트 `CODEX` 를 삭제함).
- 새 개발 프로젝트는 아직 없을 수 있다. 먼저 대시보드에서 `noryangjin-hunter-dev` 가 있는지 확인한다.
- SQL 은 PGlite 로만 검증됨(`npm run test:game` 의 tests/db). 실제 Supabase 에서는 미검증.

## 할 일
1. https://supabase.com/dashboard → 조직 `braveheartman76@gmail.com's Org` → New project
   - 이름 `noryangjin-hunter-dev`, 지역 Northeast Asia (Seoul), 무료 플랜
   - DB 비밀번호는 Generate 로 만들고 사용자가 보관하도록 안내(읽거나 기록하지 않는다)
   - 비용이 발생하는 화면이 나오면 멈추고 사용자에게 확인
2. 새 프로젝트의 SQL Editor 에서 아래 파일 내용을 **순서대로** 각각 실행
   - `supabase/game/000_bootstrap.sql`
   - `supabase/game/001_game_schema.sql`
   - `supabase/game/002_seed_reference.sql`
   오류가 나면 SQL 을 임의로 고쳐 넘기지 말고 오류 문구를 기록해 보고한다.
3. 확인: Table Editor 에 `profiles` 와 `game_` 로 시작하는 테이블들이 보이고, 모두 RLS enabled 인지 확인.
4. Project Settings → API 에서 Project URL 과 anon/publishable 키를 읽어 저장소 루트 `.env.local` 에 기록
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`). `.env.local` 이 gitignore 대상인지 먼저 확인.
   기존 `.env.local` 에 운영 프로젝트 값이 이미 있으면 덮어쓰지 말고 사용자에게 묻는다.
5. 결과 보고: 한 것 / 못 한 것 / 오류 문구.

## 그다음(코드 작업, 아직 미구현)
로그인 화면, `game_submit_attempt` RPC 로 서버 저장, 로컬 기록 이전, 선생님용 통계, 문항 검수 화면.
