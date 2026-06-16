const adminMenus = [
  {
    title: '자료 관리',
    desc: '자료실 파일 업로드·수정·삭제',
    href: '/admin/resources',
    count: '124개',
    icon: '📁',
  },
  {
    title: '검수 관리',
    desc: '오탈자 검수 요청 처리 및 배정',
    href: '/admin/proofreading',
    count: '2건 대기',
    icon: '✏️',
  },
  {
    title: '회원 관리',
    desc: '연구실 구성원 계정 관리',
    href: '/admin/users',
    count: '8명',
    icon: '👤',
  },
  {
    title: '설정',
    desc: '사이트 기본 정보 및 환경 설정',
    href: '/admin/settings',
    count: '',
    icon: '⚙️',
  },
]

const recentLogs = [
  { action: '자료 업로드', target: '2026 형사소송법 개정안 분석.pdf', user: '관리자', time: '10분 전' },
  { action: '검수 완료', target: 'PRF-022 디지털 증거 연구논문', user: '관리자', time: '2시간 전' },
  { action: '회원 추가', target: '박연구 (연구원)', user: '관리자', time: '어제' },
  { action: '자료 삭제', target: '구버전 형법총론 2024.pdf', user: '관리자', time: '2일 전' },
]

export default function AdminPage() {
  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[#1a2a4a]">관리자</h1>
        <p className="text-sm text-gray-500 mt-1">사이트 콘텐츠와 구성원을 관리합니다.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        {adminMenus.map((menu) => (
          <a
            key={menu.href}
            href={menu.href}
            className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:border-[#1a2a4a]/20 hover:shadow-md transition-all cursor-pointer flex items-start gap-4"
          >
            <span className="text-2xl">{menu.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-[#1a2a4a] text-sm">{menu.title}</p>
                {menu.count && (
                  <span className="text-xs text-[#c9a84c] font-medium">{menu.count}</span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{menu.desc}</p>
            </div>
          </a>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-[#1a2a4a] text-sm">최근 활동 로그</h2>
        </div>
        <ul className="divide-y divide-gray-50">
          {recentLogs.map((log, i) => (
            <li key={i} className="flex items-center gap-4 px-6 py-3">
              <span className="text-xs font-medium text-[#1a2a4a] bg-[#1a2a4a]/10 px-2 py-0.5 rounded w-20 text-center flex-shrink-0">
                {log.action}
              </span>
              <span className="flex-1 text-sm text-gray-700 truncate">{log.target}</span>
              <span className="text-xs text-gray-400 flex-shrink-0">{log.time}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
