import type { Metadata } from 'next'
import GameClient from '@/components/game/GameClient'

export const metadata: Metadata = {
  title: '노량진 형사법 헌터',
  description: '형사법 OX·4지선다를 풀며 캐릭터를 키우는 학습게임',
}

export default function GamePage() {
  return <GameClient />
}
