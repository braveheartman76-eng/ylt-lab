import HeroBanner from '@/components/HeroBanner'
import { supabaseServer } from '@/lib/supabase-server'

export const revalidate = 60 // 60초마다 재검증

export default async function Home() {
  const { data: notices } = await supabaseServer
    .from('notices')
    .select('*')
    .eq('is_active', true)
    .order('order', { ascending: true })

  return (
    <div className="p-8 max-w-4xl">
      <HeroBanner notices={notices ?? []} />

      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          { label: '등록 자료', value: '124', desc: '자료실 총 자료 수' },
          { label: '검수 완료', value: '38', desc: '오탈자 검수 건수' },
          { label: '최근 업데이트', value: '3', desc: '이번 주 신규 자료' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
            <p className="text-2xl font-bold text-[#1a2a4a]">{stat.value}</p>
            <p className="text-sm font-semibold text-gray-700 mt-1">{stat.label}</p>
            <p className="text-xs text-gray-400 mt-0.5">{stat.desc}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-[#1a2a4a] text-sm">공지사항</h2>
        </div>
        {!notices || notices.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-gray-400">
            등록된 공지사항이 없습니다.
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {notices.map((notice) => (
              <li key={notice.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-gray-50 transition-colors cursor-pointer">
                <span className="text-xs text-gray-400 w-24 flex-shrink-0">
                  {new Date(notice.created_at).toLocaleDateString('ko-KR')}
                </span>
                <span className="flex-1 text-sm text-gray-700">{notice.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
