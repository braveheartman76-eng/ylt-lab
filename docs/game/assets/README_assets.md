# 노량진 형사법 헌터 게임 이미지 팩

`public/hunter-assets/` 폴더를 프로젝트의 정적 파일 경로에 복사하세요. Next.js에서 기본 경로를 사용하는 경우 `/hunter-assets/manifest.json`으로 에셋 목록을 불러올 수 있습니다.

| 폴더 | 구성 |
| --- | --- |
| `characters/` | 남녀 헌터의 대기·달리기·공격 포즈 |
| `enemies/` | 잉크 슬라임, 판례 유령, 철창 몬스터, 모래시계 도깨비, 법전 미믹, 잉크 보스 |
| `npcs/` | 형사법 강사, 서점 주인, 스터디 동료 |
| `backgrounds/` | 노량진역, 학원가 골목, 야간 자습실 |

캐릭터와 몬스터는 투명 PNG입니다. 헌터는 오른쪽을, 악당은 대체로 왼쪽을 향합니다. 반대 방향을 표시할 때는 게임의 렌더러에서 좌우 반전하세요. 각 포즈는 독립 이미지로 제공되며, 달리기와 공격은 각각 한 프레임입니다.

## Canvas 적용 예시

```js
const assetRoot = '/hunter-assets/'
const assets = await fetch(assetRoot + 'manifest.json').then(r => r.json())

async function loadAsset(path) {
  const image = new Image()
  image.src = assetRoot + path
  await image.decode()
  return image
}

const stage = assets.backgrounds.station
const hunter = assets.characters.male
const enemy = assets.enemies.inkSlime
const [background, player, slime] = await Promise.all([
  loadAsset(stage.src),
  loadAsset(hunter.poses.idle),
  loadAsset(enemy.src),
])

function drawSprite(ctx, image, asset, x, y, height) {
  const width = image.naturalWidth * height / image.naturalHeight
  ctx.drawImage(image, x - width * asset.anchor.x, y - height * asset.anchor.y, width, height)
}

function drawScene(ctx) {
  const { width, height } = ctx.canvas
  ctx.drawImage(background, 0, 0, width, height)
  const ground = stage.groundY * height
  drawSprite(ctx, player, hunter, width * 0.22, ground, height * hunter.height)
  drawSprite(ctx, slime, enemy, width * 0.75, ground, height * enemy.height)
}
```

`groundY`는 배경 높이에 대한 발 위치 비율입니다. `anchor`는 각 스프라이트 내부의 정규화된 배치 기준점입니다. 유령과 날아다니는 법전에는 필요에 따라 `floatY`만큼 위로 띄우세요. `height`와 `floatY`는 게임 화면 높이에 대한 비율입니다. 기존 HP, 충돌 판정, 이동 로직을 이어 쓰고 화면에 그리는 이미지를 교체하면 됩니다.
