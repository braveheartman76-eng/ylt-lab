@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ===== 노량진 형사법 헌터 (테스트 버전) =====
echo 게임 서버를 켭니다. 잠시 후 브라우저가 열려요.
echo (게임을 끝내려면 이 검은 창을 닫으세요)
start "" cmd /c "timeout /t 3 >nul & start http://localhost:8080/"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"
