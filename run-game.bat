@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo [1/4] 최신 버전 받는 중...
git pull
echo [2/4] 필요한 프로그램 설치 확인 중... (처음에는 몇 분 걸려요)
call npm install
if not exist .env.local (
  echo [3/4] 임시 설정 파일 만드는 중...
  echo NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321> .env.local
  echo NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy-local-only>> .env.local
  echo SUPABASE_SERVICE_ROLE_KEY=dummy-local-only>> .env.local
) else (
  echo [3/4] 설정 파일 확인 완료
)
echo [4/4] 게임 서버를 켭니다. 잠시 후 브라우저가 열려요. (끄려면 이 창에서 Ctrl+C)
start "" cmd /c "timeout /t 10 >nul & start http://localhost:3000/game"
call npm run dev
