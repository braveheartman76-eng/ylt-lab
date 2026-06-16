'use client'

import { useState, useEffect, useRef } from 'react'
import type { Material, MaterialCategory } from '@/lib/supabase'

type FilterCategory = 'ALL' | MaterialCategory

const CATEGORY_META: Record<MaterialCategory, { label: string; card: string; badge: string }> = {
  형법:     { label: '형법',     card: 'bg-blue-50 text-blue-700 border-blue-100',     badge: 'bg-blue-50 text-blue-700' },
  형사소송법: { label: '형사소송법', card: 'bg-indigo-50 text-indigo-700 border-indigo-100', badge: 'bg-indigo-50 text-indigo-700' },
  교정학:   { label: '교정학',   card: 'bg-teal-50 text-teal-700 border-teal-100',     badge: 'bg-teal-50 text-teal-700' },
  노동법:   { label: '노동법',   card: 'bg-amber-50 text-amber-700 border-amber-100',  badge: 'bg-amber-50 text-amber-700' },
}

const CATEGORIES: MaterialCategory[] = ['형법', '형사소송법', '교정학', '노동법']
const ALLOWED_EXT = ['.pdf', '.hwpx', '.docx']
const MAX_SIZE = 50 * 1024 * 1024

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '-'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ---- Upload Modal ----
interface UploadModalProps {
  onClose: () => void
  onSuccess: (material: Material) => void
}

function UploadModal({ onClose, onSuccess }: UploadModalProps) {
  const [file, setFile]         = useState<File | null>(null)
  const [title, setTitle]       = useState('')
  const [category, setCategory] = useState<MaterialCategory | ''>('')
  const [uploading, setUploading] = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const acceptFile = (f: File) => {
    const ext = f.name.toLowerCase().match(/\.[^.]+$/)?.[0]
    if (!ext || !ALLOWED_EXT.includes(ext)) {
      setError('pdf, hwpx, docx 파일만 업로드할 수 있습니다.')
      return
    }
    if (f.size > MAX_SIZE) {
      setError('파일 크기는 50MB 이하여야 합니다.')
      return
    }
    setFile(f)
    setTitle((prev) => prev || f.name.replace(/\.[^.]+$/, ''))
    setError(null)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) acceptFile(f)
  }

  const handleSubmit = async () => {
    if (!file || !title.trim() || !category) {
      setError('파일, 제목, 카테고리를 모두 입력해주세요.')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('title', title.trim())
      fd.append('category', category)

      const res  = await fetch('/api/resources/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || '업로드 실패')

      onSuccess(data.material)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '업로드 중 오류가 발생했습니다.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-bold text-[#1a2a4a] text-sm">자료 업로드</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none w-6 h-6 flex items-center justify-center"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* 드롭존 */}
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors select-none ${
              dragOver
                ? 'border-[#1a2a4a] bg-[#f0f3f8]'
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.hwpx,.docx"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) acceptFile(f) }}
            />
            {file ? (
              <>
                <svg className="w-8 h-8 text-[#1a2a4a] mx-auto mb-2" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <p className="text-sm font-semibold text-[#1a2a4a]">{file.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{formatFileSize(file.size)}</p>
                <button
                  onClick={(e) => { e.stopPropagation(); setFile(null); setTitle('') }}
                  className="mt-2 text-xs text-red-400 hover:text-red-600 transition-colors"
                >
                  파일 제거
                </button>
              </>
            ) : (
              <>
                <svg className="w-8 h-8 text-gray-300 mx-auto mb-2" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <p className="text-sm text-gray-500">파일을 드래그하거나 클릭하여 선택</p>
                <p className="text-xs text-gray-400 mt-1">pdf · hwpx · docx / 최대 50MB</p>
              </>
            )}
          </div>

          {/* 제목 */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">제목</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="자료 제목을 입력하세요"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-[#1a2a4a] transition-colors"
            />
          </div>

          {/* 카테고리 */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">카테고리</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as MaterialCategory)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-[#1a2a4a] bg-white transition-colors"
            >
              <option value="">카테고리 선택</option>
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>{CATEGORY_META[cat].label}</option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}
        </div>

        <div className="flex gap-2 px-6 pb-6">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={uploading || !file || !title.trim() || !category}
            className="flex-1 py-2.5 rounded-xl bg-[#1a2a4a] text-white text-sm font-semibold hover:bg-[#243558] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {uploading ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                업로드 중...
              </>
            ) : '업로드'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Main Page ----
export default function ResourcesPage() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [filter, setFilter]       = useState<FilterCategory>('ALL')
  const [isAdmin, setIsAdmin]     = useState(false)
  const [showUpload, setShowUpload] = useState(false)

  useEffect(() => {
    setIsAdmin(localStorage.getItem('isAdmin') === 'true')
  }, [])

  useEffect(() => {
    async function fetchMaterials() {
      setLoading(true)
      try {
        const res = await fetch('/api/materials')
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? '조회 실패')
        setMaterials(json.data ?? [])
      } catch (err) {
        setError(err instanceof Error ? err.message : '조회 중 오류가 발생했습니다.')
      } finally {
        setLoading(false)
      }
    }
    fetchMaterials()
  }, [])

  const filtered = filter === 'ALL'
    ? materials
    : materials.filter((m) => m.category === filter)

  const counts = Object.fromEntries(
    CATEGORIES.map((cat) => [cat, materials.filter((m) => m.category === cat).length])
  ) as Record<MaterialCategory, number>

  const toggleFilter = (cat: MaterialCategory) =>
    setFilter((prev) => (prev === cat ? 'ALL' : cat))

  return (
    <div className="p-8 max-w-4xl">
      {/* 헤더 */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[#1a2a4a]">자료실</h1>
        <p className="text-sm text-gray-500 mt-1">형사법 관련 자료를 열람하고 다운로드할 수 있습니다.</p>
      </div>

      {/* 카테고리 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => toggleFilter(cat)}
            className={`rounded-xl p-4 border text-left transition-all cursor-pointer ${CATEGORY_META[cat].card} ${
              filter === cat ? 'shadow-md' : 'opacity-60 hover:opacity-100 hover:shadow-sm'
            }`}
          >
            <p className="text-2xl font-bold">{counts[cat]}</p>
            <p className="text-xs font-medium mt-1">{CATEGORY_META[cat].label}</p>
          </button>
        ))}
      </div>

      {/* 파일 목록 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-[#1a2a4a] text-sm">
              {filter === 'ALL' ? '전체 자료' : CATEGORY_META[filter].label}
            </h2>
            {!loading && (
              <span className="text-xs text-gray-400">{filtered.length}건</span>
            )}
            {filter !== 'ALL' && (
              <button
                onClick={() => setFilter('ALL')}
                className="text-xs text-gray-400 hover:text-gray-600 ml-1 underline underline-offset-2"
              >
                전체 보기
              </button>
            )}
          </div>
          {isAdmin && (
            <button
              onClick={() => setShowUpload(true)}
              className="text-xs text-[#1a2a4a] bg-[#1a2a4a]/10 hover:bg-[#1a2a4a]/20 px-3 py-1.5 rounded-full transition-colors font-medium"
            >
              + 자료 업로드
            </button>
          )}
        </div>

        {loading ? (
          <div className="px-6 py-12 flex justify-center">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              불러오는 중...
            </div>
          </div>
        ) : error ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-red-500 mb-1">데이터를 불러오지 못했습니다.</p>
            <p className="text-xs text-gray-400">{error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-500 mb-1">등록된 자료가 없습니다</p>
            <p className="text-xs text-gray-400">
              {filter !== 'ALL'
                ? `${CATEGORY_META[filter].label} 카테고리에 자료가 없습니다.`
                : isAdmin
                ? '위의 자료 업로드 버튼으로 첫 자료를 등록해 보세요.'
                : '아직 등록된 자료가 없습니다.'}
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500">
                <th className="text-left px-6 py-2.5 font-medium">파일명</th>
                <th className="text-left px-4 py-2.5 font-medium w-32">분류</th>
                <th className="text-left px-4 py-2.5 font-medium w-24">등록일</th>
                <th className="text-left px-4 py-2.5 font-medium w-20">크기</th>
                <th className="px-4 py-2.5 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((item) => {
                const meta = CATEGORY_META[item.category as MaterialCategory]
                return (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-3">
                      <span className="text-sm text-gray-800">{item.title}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta?.badge ?? 'bg-gray-100 text-gray-600'}`}>
                        {meta?.label ?? item.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {new Date(item.created_at).toLocaleDateString('ko-KR')}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">
                      {formatFileSize(item.file_size)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={item.file_url}
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[#1a2a4a] font-medium px-2.5 py-1 rounded-full bg-[#1a2a4a]/5 hover:bg-[#1a2a4a]/15 transition-colors whitespace-nowrap"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        다운로드
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onSuccess={(material) => setMaterials((prev) => [material, ...prev])}
        />
      )}
    </div>
  )
}
