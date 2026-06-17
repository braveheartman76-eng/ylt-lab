'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import type { Material, MaterialCategory } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'

interface Props {
  category: MaterialCategory
  categoryLabel: string
  description: string
  color: string // tailwind badge color class
}

type FileTab = 'open' | 'study'

const TAB_META: Record<FileTab, { label: string; empty: string }> = {
  open:  { label: '오픈 자료',   empty: '공개된 자료가 아직 없습니다.' },
  study: { label: '스터디 자료', empty: '스터디 전용 자료가 아직 없습니다.' },
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '-'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

export default function SubjectResourcesPage({ category, categoryLabel, description, color }: Props) {
  const [tab, setTab]           = useState<FileTab>('open')
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const { isAdmin } = useAuth()

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/materials?category=${encodeURIComponent(category)}&type=${tab}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setMaterials(d.data ?? [])
      })
      .catch((e) => setError(e instanceof Error ? e.message : '오류가 발생했습니다.'))
      .finally(() => setLoading(false))
  }, [category, tab])

  return (
    <div className="p-8 max-w-4xl">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${color}`}>
            {categoryLabel}
          </span>
          <div>
            <h1 className="text-xl font-bold text-[#1a2a4a]">{categoryLabel}</h1>
            <p className="text-sm text-gray-500 mt-0.5">{description}</p>
          </div>
        </div>
        {isAdmin && (
          <Link
            href="/admin/resources"
            className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 bg-[#c9a84c] text-[#1a2a4a] rounded-lg hover:bg-[#b8943e] transition-colors whitespace-nowrap"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            업로드
          </Link>
        )}
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6 w-fit">
        {(['open', 'study'] as FileTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-6 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t
                ? 'bg-white text-[#1a2a4a] shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {TAB_META[t].label}
          </button>
        ))}
      </div>

      {/* 파일 목록 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <h2 className="font-semibold text-[#1a2a4a] text-sm">{TAB_META[tab].label}</h2>
          {!loading && (
            <span className="text-xs text-gray-400">{materials.length}건</span>
          )}
        </div>

        {loading ? (
          <div className="px-6 py-12 flex justify-center">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Spinner />
              불러오는 중...
            </div>
          </div>
        ) : error ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-red-500 mb-1">데이터를 불러오지 못했습니다.</p>
            <p className="text-xs text-gray-400">{error}</p>
          </div>
        ) : materials.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-500 mb-1">등록된 자료가 없습니다</p>
            <p className="text-xs text-gray-400">{TAB_META[tab].empty}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500">
                <th className="text-left px-6 py-2.5 font-medium">파일명</th>
                <th className="text-left px-4 py-2.5 font-medium w-28">등록일</th>
                <th className="text-left px-4 py-2.5 font-medium w-20">크기</th>
                <th className="px-4 py-2.5 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {materials.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-3.5">
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                      </svg>
                      <span className="text-sm text-gray-800">{item.title}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-gray-400">
                    {new Date(item.created_at).toLocaleDateString('ko-KR')}
                  </td>
                  <td className="px-4 py-3.5 text-xs text-gray-400">
                    {formatFileSize(item.file_size)}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <a
                      href={item.file_url}
                      download
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-[#1a2a4a] font-medium px-2.5 py-1.5 rounded-full bg-[#1a2a4a]/5 hover:bg-[#1a2a4a]/15 transition-colors whitespace-nowrap"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      다운로드
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
