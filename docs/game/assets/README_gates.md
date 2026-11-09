# 노량진 형사법 헌터 단원 입구

`public/hunter-assets/gates/`를 기존 게임 프로젝트의 같은 경로에 복사하세요. 각 문은 입구 안쪽과 외곽이 투명한 개별 PNG입니다. `gate-manifest.json`에 원고 순서대로 8개 단원명, 지문 번호, 간판의 글자 영역, 바닥 기준점을 넣었습니다.

**화면 흐름**  
횡스크롤 이동 → 단원명 간판 확인 → 문 중앙 통과 → 해당 단원 첫 문제 출제 → 단원 문제를 마치면 다음 문으로 이동

`questionRefs`는 전달받은 원고의 번호입니다. 문제은행의 실제 ID가 따로 있으면 출제 함수에서 번호를 해당 ID에 매핑하세요. 출제 중에는 스크롤과 입구 판정을 멈추고, 단원 문제를 모두 처리한 뒤 다음 입구를 활성화합니다.

## Canvas에서 문과 단원명 그리기

```js
const gateRoot = '/hunter-assets/gates/'
const { gates, displayHeight } = await fetch(gateRoot + 'gate-manifest.json').then(r => r.json())
const images = new Map(await Promise.all(gates.map(async gate => {
  const image = new Image()
  image.src = gateRoot + gate.src
  await image.decode()
  return [gate.id, image]
})))

function drawGate(ctx, gate, screenX, groundY, viewportHeight) {
  const image = images.get(gate.id)
  const height = viewportHeight * displayHeight
  const width = height * image.naturalWidth / image.naturalHeight
  const x = screenX - width * gate.anchor.x
  const y = groundY - height * gate.anchor.y
  ctx.drawImage(image, x, y, width, height)

  const box = gate.labelBox
  const labelX = x + width * (box.x + box.width / 2)
  const labelY = y + height * (box.y + box.height / 2)
  const maxWidth = width * box.width
  const maxHeight = height * box.height
  let size = Math.min(21, maxHeight / (gate.labelLines.length * 1.16))

  ctx.save()
  function setFont() {
    ctx.font = `800 ${size}px "Pretendard", "Noto Sans KR", "Malgun Gothic", sans-serif`
  }
  setFont()
  const widest = Math.max(...gate.labelLines.map(line => ctx.measureText(line).width))
  if (widest > maxWidth) {
    size *= maxWidth / widest
    setFont()
  }
  ctx.fillStyle = '#251c16'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  gate.labelLines.forEach((line, index) => {
    const offset = (index - (gate.labelLines.length - 1) / 2) * size * 1.12
    ctx.fillText(line, labelX, labelY + offset)
  })
  ctx.restore()
}
```

`groundY`는 픽셀 값입니다. 앞서 전달한 배경의 `groundY` 비율에 화면 높이를 곱해 사용하면 됩니다. `screenX`는 문 중앙의 월드 좌표에서 카메라의 월드 좌표를 뺀 값입니다.

## 통과 판정 예제

```js
// 기존 게임에서 쓰는 월드 좌표로 판정합니다.
function crossesTopicGate(previousPlayerX, playerX, gateWorldX) {
  return previousPlayerX < gateWorldX && playerX >= gateWorldX
}

function checkTopicGate(previousPlayerX, playerX, activeGate, progress, startTopic) {
  if (!activeGate || progress.topicInProgress || progress.completed.has(activeGate.id)) return
  if (!crossesTopicGate(previousPlayerX, playerX, activeGate.worldX)) return

  progress.topicInProgress = true
  startTopic(activeGate.title, activeGate.questionRefs)
}
```

예제는 왼쪽에서 오른쪽으로 이동하는 진행을 기준으로 합니다. 단원 종료 콜백에서 `progress.completed`에 단원 ID를 기록하고, `topicInProgress`를 해제한 뒤 다음 문을 활성화하세요.
