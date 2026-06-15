export default function Home() {
  return (
    <div className="p-8 max-w-4xl">
      {/* 히어로 */}
      <div className="bg-gradient-to-r from-[#1a2a4a] to-[#243558] rounded-xl p-8 text-white mb-8 shadow-md">
        <p className="text-[#c9a84c] text-sm font-semibold tracking-widest uppercase mb-2">
          Criminal Law Research Laboratory
        </p>
        <h1 className="text-3xl font-bold leading-snug mb-3">
          이윤탁 형사법 연구실
        </h1>
        <p className="text-white/70 text-base leading-relaxed max-w-xl">
          형사법의 이론과 실무를 연구하고 발전시키기 위한 학술 공간입니다.
          형법·형사소송법 분야의 깊이 있는 연구를 통해 법치주의 실현에 기여합니다.
        </p>
      </div>

      {/* 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {[
          { label: '연구 프로젝트', value: '12', desc: '진행 중인 연구' },
          { label: '출판 논문', value: '48', desc: '학술지 게재' },
          { label: '세미나', value: '6', desc: '올해 개최' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <p className="text-3xl font-bold text-[#1a2a4a]">{stat.value}</p>
            <p className="text-sm font-semibold text-gray-700 mt-1">{stat.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{stat.desc}</p>
          </div>
        ))}
      </div>

      {/* 최근 활동 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-[#1a2a4a]">최근 활동</h2>
          <span className="text-xs text-[#c9a84c] font-medium cursor-pointer hover:underline">전체보기</span>
        </div>
        <ul className="divide-y divide-gray-50">
          {[
            { date: '2026.06.10', title: '형사소송법 개정안 분석 세미나 개최', tag: '세미나' },
            { date: '2026.05.28', title: '디지털 증거의 증거능력에 관한 연구 논문 게재', tag: '출판물' },
            { date: '2026.05.15', title: '2026년 형사법 학술대회 발표', tag: '학술발표' },
            { date: '2026.04.30', title: '신임 연구원 모집 공고', tag: '공지사항' },
          ].map((item) => (
            <li key={item.title} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors cursor-pointer">
              <span className="text-xs text-gray-400 w-24 flex-shrink-0">{item.date}</span>
              <span className="flex-1 text-sm text-gray-700">{item.title}</span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#1a2a4a]/10 text-[#1a2a4a] font-medium flex-shrink-0">
                {item.tag}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
