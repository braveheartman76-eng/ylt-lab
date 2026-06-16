'use client'

export default function FloatingButtons() {
  return (
    <div className="fixed bottom-6 right-6 flex flex-col gap-3 z-50">
      {/* 카카오톡 오픈채팅 */}
      <a
        href="#"
        title="카카오 오픈채팅"
        className="w-12 h-12 rounded-full bg-[#FEE500] hover:bg-[#F5DC00] shadow-lg flex items-center justify-center transition-all hover:scale-110 hover:shadow-xl"
      >
        <svg viewBox="0 0 24 24" className="w-6 h-6" fill="#3C1E1E">
          <path d="M12 3C6.477 3 2 6.477 2 10.5c0 2.611 1.574 4.91 3.963 6.283L5 21l4.173-2.087C10.069 19.293 11.02 19.5 12 19.5c5.523 0 10-3.477 10-7.5S17.523 3 12 3z" />
        </svg>
      </a>

      {/* 네이버 카페 */}
      <a
        href="#"
        title="네이버 카페"
        className="w-12 h-12 rounded-full bg-[#03C75A] hover:bg-[#02B350] shadow-lg flex items-center justify-center transition-all hover:scale-110 hover:shadow-xl"
      >
        <svg viewBox="0 0 24 24" className="w-6 h-6" fill="white">
          <path d="M16.273 12.845L7.376 3H3v18h4.727v-9.845L16.624 21H21V3h-4.727z" />
        </svg>
      </a>
    </div>
  )
}
