#!/bin/bash
cd "$(dirname "$0")/site"
echo "===== 노량진 형사법 헌터 (테스트 버전) ====="
echo "게임 서버를 켭니다. 잠시 후 브라우저가 열려요. (끄려면 이 창을 닫으세요)"
(sleep 2; open "http://localhost:8080/") &
python3 -m http.server 8080
