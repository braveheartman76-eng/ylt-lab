'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'

const menu = [
  {
    title: '홈',
    href: '/',
    adminOnly: false,
    items: [
      { label: '연구실 소개', href: '/' },
      { label: '공지사항', href: '/?tab=notice' },
      { label: '최근 활동', href: '/?tab=activity' },
    ],
  },
  {
    title: '자료실',
    href: '/resources',
    adminOnly: false,
    items: [
      { label: '형법',     href: '/resources/criminal-law' },
      { label: '형사소송법', href: '/resources/procedure' },
      { label: '교정학',   href: '/resources/corrections' },
      { label: '노동법',   href: '/resources/labor' },
    ],
  },
  {
    title: '오탈자검수',
    href: '/proofreading',
    adminOnly: true,
    items: [
      { label: '검수 요청', href: '/proofreading/request' },
      { label: '검수 현황', href: '/proofreading/status' },
      { label: '완료 목록', href: '/proofreading/done' },
    ],
  },
  {
    title: '관리자',
    href: '/admin',
    adminOnly: false,
    items: [
      { label: '자료 관리', href: '/admin/resources' },
      { label: '검수 관리', href: '/admin/proofreading' },
      { label: '회원 관리', href: '/admin/users' },
      { label: '설정', href: '/admin/settings' },
    ],
  },
]

export default function Sidebar() {
  const pathname = usePathname()
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    setIsAdmin(localStorage.getItem('isAdmin') === 'true')
  }, [])

  const visibleMenu = menu.filter((s) => !s.adminOnly || isAdmin)

  const activeSection = visibleMenu.find((section) =>
    section.href === '/'
      ? pathname === '/'
      : pathname.startsWith(section.href)
  )

  return (
    <aside className="w-52 bg-[#152238] text-white flex-shrink-0 overflow-y-auto">
      <nav className="py-3">
        {visibleMenu.map((section) => {
          const isActive = section === activeSection
          return (
            <div key={section.href} className="mb-0.5">
              <Link
                href={section.href}
                className={`flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold transition-colors border-l-2 ${
                  isActive
                    ? 'border-[#c9a84c] bg-white/10 text-white'
                    : 'border-transparent text-white/50 hover:text-white/80 hover:bg-white/5'
                }`}
              >
                {section.title}
              </Link>
              {isActive && (
                <ul className="pb-2">
                  {section.items.map((item) => {
                    const itemActive = pathname === item.href
                    return (
                      <li key={item.label}>
                        <Link
                          href={item.href}
                          className={`flex items-center gap-2 pl-7 pr-4 py-1.5 text-[12px] transition-colors ${
                            itemActive
                              ? 'text-[#c9a84c] font-medium'
                              : 'text-white/60 hover:text-white'
                          }`}
                        >
                          <span className={`w-1 h-1 rounded-full flex-shrink-0 ${itemActive ? 'bg-[#c9a84c]' : 'bg-white/30'}`} />
                          {item.label}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
