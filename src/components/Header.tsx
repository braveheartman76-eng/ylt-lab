'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  { label: '홈', href: '/' },
  { label: '자료실', href: '/resources' },
  { label: '오탈자검수', href: '/proofreading' },
  { label: '관리자', href: '/admin' },
]

export default function Header() {
  const pathname = usePathname()

  return (
    <header className="h-16 bg-[#1a2a4a] text-white flex items-center justify-between px-6 shadow-lg z-20 flex-shrink-0">
      <Link href="/" className="flex items-center gap-3">
        <div className="w-9 h-9 bg-[#c9a84c] rounded flex items-center justify-center text-[#1a2a4a] font-bold text-base select-none">
          형
        </div>
        <div className="leading-tight">
          <p className="text-[10px] text-white/50 tracking-widest uppercase">Criminal Law Lab</p>
          <p className="text-[15px] font-semibold tracking-tight">이윤탁 형사법 연구실</p>
        </div>
      </Link>

      <nav className="flex items-center gap-1">
        {navItems.map((item) => {
          const active = item.href === '/'
            ? pathname === '/'
            : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`px-4 py-1.5 text-sm rounded transition-colors ${
                active
                  ? 'bg-white/20 text-white font-medium'
                  : 'text-white/70 hover:text-white hover:bg-white/10'
              }`}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}
