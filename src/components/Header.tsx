import Link from 'next/link'

const navItems = [
  { label: '연구실 소개', href: '/about' },
  { label: '연구 활동', href: '/research' },
  { label: '출판물', href: '/publications' },
  { label: '강의', href: '/lectures' },
  { label: '공지사항', href: '/notice' },
  { label: '문의', href: '/contact' },
]

export default function Header() {
  return (
    <header className="h-16 bg-[#1a2a4a] text-white flex items-center justify-between px-6 shadow-lg z-20 flex-shrink-0">
      <Link href="/" className="flex items-center gap-3">
        <div className="w-9 h-9 bg-[#c9a84c] rounded flex items-center justify-center text-[#1a2a4a] font-bold text-base select-none">
          형
        </div>
        <div className="leading-tight">
          <p className="text-[11px] text-white/60 tracking-widest uppercase">Criminal Law Lab</p>
          <p className="text-[15px] font-semibold tracking-tight">이윤탁 형사법 연구실</p>
        </div>
      </Link>

      <nav className="hidden md:flex items-center gap-1">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="px-3 py-1.5 text-sm text-white/80 hover:text-white hover:bg-white/10 rounded transition-colors"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}
