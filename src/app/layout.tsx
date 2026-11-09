import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import Header from '@/components/Header'
import Sidebar from '@/components/Sidebar'
import FloatingButtons from '@/components/FloatingButtons'
import { AuthProvider } from '@/lib/auth-context'

const geist = Geist({ subsets: ['latin'], variable: '--font-geist' })

export const metadata: Metadata = {
  title: '이윤탁 형사법 연구실',
  description: '형사법 연구 및 학술 활동을 위한 이윤탁 형사법 연구실 공식 사이트',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${geist.variable} h-full print:h-auto`}>
      <body className="h-full flex flex-col antialiased print:block print:h-auto bg-[#f5f7fa]">
        <AuthProvider>
          <Header />
          <div className="flex flex-1 overflow-hidden print:block print:overflow-visible">
            <Sidebar />
            <main className="flex-1 overflow-y-auto print:overflow-visible">
              {children}
            </main>
          </div>
          <FloatingButtons />
        </AuthProvider>
      </body>
    </html>
  )
}
