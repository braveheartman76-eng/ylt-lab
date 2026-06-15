import Link from 'next/link'

const menu = [
  {
    title: '연구실 소개',
    items: [
      { label: '인사말', href: '/about' },
      { label: '연구실 소개', href: '/about/lab' },
      { label: '연구진', href: '/about/members' },
      { label: '오시는 길', href: '/about/location' },
    ],
  },
  {
    title: '연구 활동',
    items: [
      { label: '연구 프로젝트', href: '/research/projects' },
      { label: '학술 발표', href: '/research/presentations' },
      { label: '세미나', href: '/research/seminars' },
    ],
  },
  {
    title: '출판물',
    items: [
      { label: '저서', href: '/publications/books' },
      { label: '논문', href: '/publications/papers' },
      { label: '기타 자료', href: '/publications/etc' },
    ],
  },
  {
    title: '강의',
    items: [
      { label: '형법 총론', href: '/lectures/general' },
      { label: '형법 각론', href: '/lectures/special' },
      { label: '형사소송법', href: '/lectures/procedure' },
    ],
  },
  {
    title: '공지사항',
    items: [
      { label: '공지사항', href: '/notice' },
      { label: '새소식', href: '/notice/news' },
    ],
  },
]

export default function Sidebar() {
  return (
    <aside className="w-52 bg-[#152238] text-white flex-shrink-0 overflow-y-auto">
      <nav className="py-2">
        {menu.map((section) => (
          <div key={section.title} className="mb-1">
            <div className="px-4 py-2.5 text-[11px] font-bold text-[#c9a84c] uppercase tracking-widest border-b border-white/10">
              {section.title}
            </div>
            <ul className="py-1">
              {section.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex items-center gap-2 px-5 py-2 text-[13px] text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <span className="w-1 h-1 rounded-full bg-[#c9a84c]/60 flex-shrink-0" />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )
}
