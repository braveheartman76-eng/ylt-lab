'use client'

import { usePathname } from 'next/navigation'
import Header from '@/components/Header'
import Sidebar from '@/components/Sidebar'
import FloatingButtons from '@/components/FloatingButtons'

/** 사이트 공통 헤더/사이드바. 게임(/game)은 모바일 전체 화면을 써야 하므로 사이트 틀 없이 본문만 그린다. */
export default function SiteChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  if (path === '/game' || path?.startsWith('/game/')) {
    return <main className="flex-1 overflow-y-auto">{children}</main>
  }
  return (
    <>
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
      <FloatingButtons />
    </>
  )
}
