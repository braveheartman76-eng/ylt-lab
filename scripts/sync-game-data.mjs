// npm run dev 직전에 자동 실행(predev): game-content/questions.json 이 있으면 게임이 읽는 위치로 복사한다.
// game-content/ 는 웹에 공개되지 않는 폴더이고, 복사 대상(public/game-data/questions.local.json)은 gitignore 이며
// 운영 빌드(next build)에서는 이 스크립트가 실행되지 않으므로 문제·정답이 배포 사이트에 공개되지 않는다.
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs'

const src = 'game-content/questions.json'
const dst = 'public/game-data/questions.local.json'
if (!existsSync(src)) {
  console.log('[game-data] game-content/questions.json 없음 → 테스트 샘플 문제로 실행합니다.')
} else {
  mkdirSync('public/game-data', { recursive: true })
  copyFileSync(src, dst)
  const n = JSON.parse(readFileSync(src, 'utf8')).questions.length
  console.log(`[game-data] 문제 ${n}개를 게임에 연결했습니다.`)
}
