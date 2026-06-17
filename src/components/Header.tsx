'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'

const navItems = [
  { label: '홈', href: '/' },
  { label: '자료실', href: '/resources' },
  { label: '오탈자검수', href: '/proofreading' },
  { label: '관리자', href: '/admin' },
]

export default function Header() {
  const pathname = usePathname()
  const { profile, isLoading, signOut } = useAuth()

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

      <div className="flex items-center gap-1">
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

        <div className="ml-2 pl-3 border-l border-white/20 flex items-center gap-2">
          {!isLoading && (
            profile ? (
              <>
                <span className="text-sm text-white/80 max-w-[120px] truncate">
                  {profile.name}
                  {profile.role === 'admin' && (
                    <span className="ml-1 text-[10px] bg-[#c9a84c] text-[#1a2a4a] font-bold px-1.5 py-0.5 rounded">
                      관리자
                    </span>
                  )}
                </span>
                <button
                  onClick={signOut}
                  className="px-3 py-1.5 text-sm text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors"
                >
                  로그아웃
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="px-4 py-1.5 text-sm bg-[#c9a84c] text-[#1a2a4a] font-semibold rounded hover:bg-[#b8943e] transition-colors"
              >
                로그인
              </Link>
            )
          )}
        </div>
      </div>
    </header>
  )
}
