# 노량진 형사법 헌터 달리기 프레임

남녀 헌터의 입문·정예·전설 복장에 각각 달리기 프레임 8장씩 들어 있습니다. 각 파일은 투명 PNG이며, 캐릭터는 오른쪽을 향합니다. 캔버스는 480×384px, 발 기준선은 y=372px, 캐릭터를 놓는 중심선은 x=240px입니다.

| 복장 | 남자 | 여자 |
| --- | --- | --- |
| 입문 | `male-run-1.png` ~ `male-run-8.png` | `female-run-1.png` ~ `female-run-8.png` |
| 정예 | `male-veteran-run-1.png` ~ `male-veteran-run-8.png` | `female-veteran-run-1.png` ~ `female-veteran-run-8.png` |
| 전설 | `male-legendary-run-1.png` ~ `male-legendary-run-8.png` | `female-legendary-run-1.png` ~ `female-legendary-run-8.png` |

`public/hunter-assets/animation/run/`을 게임의 같은 경로에 복사한 뒤, `src/game/anim.ts`의 달리기 프레임 배열에 해당 복장의 1~8번 파일을 연결하세요. 프레임이 반복될 때는 8번 다음에 1번을 표시합니다. 이미지 경로, 배열 순서, 기준 좌표는 `run-manifest.json`에 있습니다.

`run-preview.gif`는 80ms 간격으로 8장을 순서대로 재생합니다. 위부터 입문·정예·전설, 각 줄의 왼쪽은 남자, 오른쪽은 여자입니다. 실제 속도는 게임에서 사용하는 `anim.ts` 타이밍을 적용하세요.
