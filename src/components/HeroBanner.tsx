'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Notice } from '@/lib/supabase'

interface Props {
  notices: Notice[]
}

export default function HeroBanner({ notices }: Props) {
  const [current, setCurrent] = useState(0)
  const [paused, setPaused] = useState(false)

  const prev = () => setCurrent((c) => (c - 1 + notices.length) % notices.length)
  const next = useCallback(
    () => setCurrent((c) => (c + 1) % notices.length),
    [notices.length]
  )

  useEffect(() => {
    setCurrent(0)
  }, [notices])

  useEffect(() => {
    if (paused || notices.length <= 1) return
    const timer = setInterval(next, 4000)
    return () => clearInterval(timer)
  }, [paused, next, notices.length])

  // 빈 상태
  if (notices.length === 0) {
    return (
      <div className="bg-[#1a2a4a] rounded-xl px-10 py-8 text-white mb-6 shadow-md">
        <p className="text-[10px] text-white/40 tracking-widest uppercase mb-2">
          Criminal Law Research Laboratory
        </p>
        <h2 className="text-lg font-bold mb-1">이윤탁 형사법 연구실</h2>
        <p className="text-sm text-white/50">등록된 공지사항이 없습니다.</p>
      </div>
    )
  }

  const slide = notices[current]

  return (
    <div
      className="relative bg-[#1a2a4a] text-white rounded-xl overflow-hidden shadow-md mb-6"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* 슬라이드 */}
      <div className="px-10 py-8 min-h-36">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-bold tracking-widest uppercase text-[#c9a84c] border border-[#c9a84c]/50 px-2 py-0.5 rounded">
            공지
          </span>
          <span className="text-[11px] text-white/40">
            {new Date(slide.created_at).toLocaleDateString('ko-KR')}
          </span>
        </div>
        <h2 className="text-lg font-bold mb-1.5 leading-snug">{slide.title}</h2>
        {slide.content && (
          <p className="text-sm text-white/60 leading-relaxed">{slide.content}</p>
        )}
        {slide.link_url && (
          <a
            href={slide.link_url}
            className="inline-block mt-3 text-xs text-[#c9a84c] hover:underline"
          >
            자세히 보기 →
          </a>
        )}
      </div>

      {/* 좌우 화살표 (슬라이드 2개 이상일 때만) */}
      {notices.length > 1 && (
        <>
          <button
            onClick={prev}
            className="absolute left-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white/70 hover:text-white text-lg"
            aria-label="이전"
          >
            ‹
          </button>
          <button
            onClick={next}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white/70 hover:text-white text-lg"
            aria-label="다음"
          >
            ›
          </button>
        </>
      )}

      {/* 하단 점 */}
      {notices.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 pb-3">
          {notices.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`rounded-full transition-all ${
                i === current
                  ? 'w-4 h-1.5 bg-[#c9a84c]'
                  : 'w-1.5 h-1.5 bg-white/30 hover:bg-white/50'
              }`}
              aria-label={`슬라이드 ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
