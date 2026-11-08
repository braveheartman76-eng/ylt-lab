# 노량진 형사법 헌터 — 1단계 분석 및 2단계 착수 보고

## 1. 현재 프로젝트 상태 (실제 확인)
- 저장소 `ylt-lab`: Next.js 16.2.9 + React 19 + Tailwind 4 + Supabase JS. Vercel cron 1건.
- 구현됨: 로그인(profiles, role admin/student), 자료실(Storage), 관리자 자료관리, CBT 모의고사(exams/*, quiz_questions), 교정/교열(proofread, Claude API), PDF/HWPX(jszip) 파싱 API.
- **발견되지 않음**: 기존 HTML 게임 시연본, 캐릭터/스프라이트, TTS 코드, 자동진행 러닝, 수사 미션, 보스전, Phaser, HWPX/PDF 문제집 원본.
  (저장소 전체와 파일시스템에서 `*.hwpx|*.hwp|*game*.html` 검색 → 없음). 따라서 "구현되어 있다"고 가정하지 않았다.
- `.env*` 없음 → 이 환경에서는 Supabase 연결을 시도/검증하지 않았다. 운영 DB는 건드리지 않았다.
- `node_modules` 가 없었음(이번에 devDependency 설치 시 생성). Next 16 docs(`node_modules/next/dist/docs`)는 이번 작업이 Next API를 쓰지 않아 참조하지 않았다. 3단계(화면/API Route)에서 먼저 읽을 것.

## 2. 재사용 가능한 기존 코드
| 대상 | 재사용 방식 |
|---|---|
| `profiles`, `current_user_role()` | 게임 테이블 FK/RLS에서 읽기 전용 의존 |
| `src/lib/auth-context.tsx`, 로그인 페이지 | 게임 로그인에 그대로 사용 |
| `src/lib/supabase*.ts` | 클라이언트/서버 클라이언트 재사용 |
| `api/exams/parse` (Claude 청크 파싱) | 참고만. 게임 문제은행은 AI 추출 대신 **결정적 파서** 사용(정답 임의 생성 방지) |
| jszip HWPX 처리 (`api/proofread`) | 개념 참고 (게임 도구는 Python 표준 라이브러리) |
기존 `quiz_questions`/`exam_*`와는 **의도적으로 분리**(`game_` 접두사).

## 3. 생성 파일
- `supabase/game/001_game_schema.sql` — 게임 전용 스키마·RLS·채점/복습 RPC
- `supabase/game/002_seed_reference.sql` — 과목 2종, 아이템 15종 (문제 내용 없음)
- `tools/ox_import/` — `ox_import.py`, `hwpx_reader.py`, `profile.default.json`, 테스트/가상 픽스처
- `tests/db/game_schema.test.mjs` — 실제 SQL을 PGlite로 실행하는 검증
- `package.json`(`test:game`, devDep `@electric-sql/pglite`), `docs/game/STAGE1_REPORT.md`

## 4. DB 스키마 / 학습 엔진
테이블: game_subjects, game_units(3단계 트리), game_import_batches, game_questions(고정 신원),
game_question_versions(불변 내용·원본기호·법령기준일), game_question_metadata(난이도/중요도/출제빈도 분리),
game_question_sources(조문·판례·기출), game_question_reports, game_player_profiles(직렬),
game_answer_attempts(append-only), game_srs_intervals, game_review_schedules, game_mastery_stats,
game_progress, game_items, game_inventory, game_assessment_results.

핵심 규칙
- 풀이마다 1행 보존, UPDATE/DELETE 트리거 차단. 학습 당시 `question_version_id` 기록 → 개정해도 이력 유지.
- 복습: 오답 box0(30분 뒤) → 1일 → 3일 → 7일 → 14일 → 30일. 첫 풀이 정답은 box2(3일). 오답 시 box-2(간격 단축), `wrong_count`는 감소하지 않음. 간격은 `game_srs_intervals`에서 조정.
- 출제빈도: `verified` 상태에서만 숫자 허용(CHECK). 기본값 `unverified`.
- 보상: 정답이면서 "처음 푸는 문항 또는 복습 예정 문항"일 때만 XP/코인 → 쉬운 문제 반복 파밍 방지. XP·코인(game_progress)과 숙련도(review_schedules/mastery_stats)는 별도.
- 학생은 정답 포함 원본 테이블에 직접 접근 불가. `game_playable_questions`(정답 컬럼 없음) + `game_submit_attempt()` RPC(서버 채점)만 사용. 검수 `approved` + `is_active`인 문항만 출제.
- 원본 기호: `raw_markers`에 원문 그대로 저장, 의미(`meaning`)는 프로필에 `confirmed_by_user`로 확인된 것만 기록. 현재 전부 미해석.

## 5. 실행·테스트 결과
- Python 가져오기 테스트 9건 통과 (HWPX 생성→추출, 정답 인라인/별행, 다중행 해설, 기호 보존·미해석, 단원, 쪽번호, 번호 누락/정답 누락 경고, 결정적 ID, PDF 거짓 처리 방지).
- DB 테스트 7건 통과 (PGlite 위에서 실제 SQL 실행): 가져온 가상 문항은 pending이라 출제 불가 / 오답 누적·당일 재확인·사다리 상승·오답 시 단축 / 모든 풀이 보존 / 파밍 방지 / append-only / 개정 버전 분리 / 단원 통계·복습목록·비활성화 / 출제빈도 CHECK.
- 모든 테스트 문항은 `[테스트]`로 시작하고 `is_test_data=true`.

**검증하지 못한 것(과장 금지)**
- 실제 Supabase(Postgres)에서의 적용 — PGlite는 로컬 WASM Postgres. `auth.uid()`는 스텁이며, 테스트는 슈퍼유저라 **RLS 정책 자체와 GRANT는 강제 검증되지 않음**. 개발용 Supabase 프로젝트에서 RLS 테스트 필요.
- 실제 HWPX 파일 추출 — 가상 HWPX(최소 구조)로만 테스트. 실제 한컴 문서의 표/각주/스타일 구조는 샘플을 받아야 확인 가능.
- PDF 입력 미구현(명시적으로 NotImplementedError).
- 쪽번호는 원고에 `- 12 -` 형태가 있을 때만 기록(추정하지 않음).

## 6. 남은 문제점
- 파서 정규식/프로필은 **추정 형식** 기반. 실제 샘플로 `profile.default.json` 조정 필요.
- 난이도(D1~D5)·중요도 초기값 자동 산정 미구현 — 근거 없는 값 입력을 피하려고 비워 둠(검수 시 입력).
- 적응형 난이도 선택기, 출제 믹스(신규/오답/복습/장기/고난도), 주간 평가 계산, 학습 리포트 쿼리 미구현(3단계).
- 게임 클라이언트(캐릭터·러닝·TTS·보스전·방 꾸미기) 전부 미구현(4단계). 기존 시연본이 없으므로 신규 제작 필요.
- 관리자 검수 UI 미구현(승인은 현재 SQL로만).

## 7. 다음 단계에 필요한 원본 자료
1. **OX 문제집 원본(HWPX 권장, PDF 가능)** — 우선 형법·형사소송법 각 1~2개 장 분량 샘플 (최초 100문항 검증용).
2. **문제 옆 기호의 의미 설명서** (예: ★, ※ 등이 각각 무엇인지) — 확인 전에는 해석하지 않음.
3. 기존 HTML 게임 시연본 파일(캐릭터·TTS·수사미션·보스전 포함)과 사용 중인 캐릭터 이미지 — 저장소/서버 어디에도 없음. 위치를 알려주시거나 업로드 필요.
4. 개발용 Supabase 프로젝트(또는 로컬) 사용 승인 및 접속 정보(코드에 넣지 않고 환경변수로).
5. (출제빈도용) 검증 가능한 기출 목록 — 없으면 '미확인' 유지.
