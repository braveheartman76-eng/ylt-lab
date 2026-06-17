'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Material, MaterialCategory, FileType } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'

const CATEGORIES: MaterialCategory[] = ['형법', '형사소송법', '교정학', '노동법']
const ALLOWED_EXT = ['.pdf', '.hwpx', '.docx']
const MAX_SIZE = 50 * 1024 * 1024

const CATEGORY_BADGE: Record<MaterialCategory, string> = {
  형법:     'bg-blue-50 text-blue-700',
  형사소송법: 'bg-indigo-50 text-indigo-700',
  교정학:   'bg-teal-50 text-teal-700',
  노동법:   'bg-amber-50 text-amber-700',
}

const FILE_TYPE_BADGE: Record<FileType, string> = {
  open:  'bg-green-50 text-green-700',
  study: 'bg-purple-50 text-purple-700',
}

const FILE_TYPE_LABEL: Record<FileType, string> = {
  open:  '오픈',
  study: '스터디',
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '-'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

export default function AdminResourcesPage() {
  const { isAdmin, isLoading } = useAuth()
  const router = useRouter()

  // ---- Upload state ----
  const [file, setFile]         = useState<File | null>(null)
  const [title, setTitle]       = useState('')
  const [category, setCategory] = useState<MaterialCategory | ''>('')
  const [fileType, setFileType] = useState<FileType>('open')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ---- List state ----
  const [materials, setMaterials] = useState<Material[]>([])
  const [loading, setLoading]   = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [filterCat, setFilterCat] = useState<MaterialCategory | 'ALL'>('ALL')
  const [deleting, setDeleting] = useState<string | null>(null)

  const fetchMaterials = useCallback(async () => {
    setLoading(true)
    setListError(null)
    try {
      const res  = await fetch('/api/materials')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '조회 실패')
      setMaterials(json.data ?? [])
    } catch (e) {
      setListError(e instanceof Error ? e.message : '오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchMaterials() }, [fetchMaterials])

  const acceptFile = (f: File) => {
    const ext = f.name.toLowerCase().match(/\.[^.]+$/)?.[0]
    if (!ext || !ALLOWED_EXT.includes(ext)) {
      setUploadError('pdf, hwpx, docx 파일만 업로드할 수 있습니다.')
      return
    }
    if (f.size > MAX_SIZE) {
      setUploadError('파일 크기는 50MB 이하여야 합니다.')
      return
    }
    setFile(f)
    setTitle((prev) => prev || f.name.replace(/\.[^.]+$/, ''))
    setUploadError(null)
    setUploadSuccess(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) acceptFile(f)
  }

  const handleUpload = async () => {
    if (!file || !title.trim() || !category) {
      setUploadError('파일, 제목, 과목을 모두 입력해주세요.')
      return
    }
    setUploading(true)
    setUploadError(null)
    setUploadSuccess(false)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('title', title.trim())
      fd.append('category', category)
      fd.append('file_type', fileType)

      const res  = await fetch('/api/resources/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || '업로드 실패')

      setFile(null)
      setTitle('')
      setCategory('')
      setFileType('open')
      setUploadSuccess(true)
      setMaterials((prev) => [data.material, ...prev])
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : '오류가 발생했습니다.')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`「${title}」을(를) 삭제하시겠습니까?\n삭제 후 복구할 수 없습니다.`)) return
    setDeleting(id)
    try {
      const res  = await fetch(`/api/resources/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || '삭제 실패')
      setMaterials((prev) => prev.filter((m) => m.id !== id))
    } catch (e) {
      alert(e instanceof Error ? e.message : '삭제 중 오류가 발생했습니다.')
    } finally {
      setDeleting(null)
    }
  }

  const filtered = filterCat === 'ALL'
    ? materials
    : materials.filter((m) => m.category === filterCat)

  const canUpload = file && title.trim() && category && !uploading

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="h-6 w-6 text-gray-400" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-gray-500 font-medium">관리자만 접근할 수 있습니다.</p>
        <button
          onClick={() => router.push('/login')}
          className="text-sm text-[#1a2a4a] underline hover:no-underline"
        >
          로그인 페이지로 이동
        </button>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl">
      {/* 헤더 */}
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
          <a href="/admin" className="hover:text-gray-600 transition-colors">관리자</a>
          <span>›</span>
          <span>자료 관리</span>
        </div>
        <h1 className="text-xl font-bold text-[#1a2a4a]">자료 관리</h1>
        <p className="text-sm text-gray-500 mt-1">자료를 업로드하거나 삭제할 수 있습니다.</p>
      </div>

      {/* 업로드 섹션 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">파일 업로드</p>

        {/* 드롭존 */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors select-none mb-4 ${
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

        <div className="grid grid-cols-2 gap-3 mb-3">
          {/* 제목 */}
          <div className="col-span-2">
            <label className="text-xs text-gray-500 mb-1 block">제목</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="자료 제목을 입력하세요"
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-[#1a2a4a] transition-colors"
            />
          </div>

          {/* 과목 */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">과목</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as MaterialCategory)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-[#1a2a4a] bg-white transition-colors"
            >
              <option value="">과목 선택</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* 구분 */}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">구분</label>
            <div className="flex gap-2 h-[42px] items-center">
              {(['open', 'study'] as FileType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setFileType(t)}
                  className={`flex-1 h-full rounded-lg border-2 text-sm font-medium transition-all ${
                    fileType === t
                      ? 'border-[#1a2a4a] bg-[#1a2a4a] text-white'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {FILE_TYPE_LABEL[t]} 자료
                </button>
              ))}
            </div>
          </div>
        </div>

        {uploadError && (
          <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg mb-3">{uploadError}</p>
        )}
        {uploadSuccess && (
          <p className="text-xs text-green-600 bg-green-50 px-3 py-2 rounded-lg mb-3">업로드가 완료되었습니다.</p>
        )}

        <button
          onClick={handleUpload}
          disabled={!canUpload}
          className="w-full py-2.5 rounded-xl bg-[#1a2a4a] text-white text-sm font-semibold hover:bg-[#243558] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {uploading ? <><Spinner /> 업로드 중...</> : '업로드'}
        </button>
      </div>

      {/* 파일 목록 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-[#1a2a4a] text-sm">전체 자료</h2>
            {!loading && <span className="text-xs text-gray-400">{filtered.length}건</span>}
          </div>
          {/* 과목 필터 */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setFilterCat('ALL')}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                filterCat === 'ALL' ? 'bg-[#1a2a4a] text-white' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              전체
            </button>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setFilterCat(c)}
                className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                  filterCat === c ? 'bg-[#1a2a4a] text-white' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="px-6 py-12 flex justify-center">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Spinner /> 불러오는 중...
            </div>
          </div>
        ) : listError ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-red-500 mb-1">데이터를 불러오지 못했습니다.</p>
            <p className="text-xs text-gray-400">{listError}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-sm text-gray-400">등록된 자료가 없습니다.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500">
                <th className="text-left px-6 py-2.5 font-medium">파일명</th>
                <th className="text-left px-3 py-2.5 font-medium w-24">과목</th>
                <th className="text-left px-3 py-2.5 font-medium w-20">구분</th>
                <th className="text-left px-3 py-2.5 font-medium w-24">등록일</th>
                <th className="text-left px-3 py-2.5 font-medium w-16">크기</th>
                <th className="px-3 py-2.5 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-3">
                    <span className="text-sm text-gray-800 line-clamp-1">{item.title}</span>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_BADGE[item.category as MaterialCategory] ?? 'bg-gray-100 text-gray-600'}`}>
                      {item.category}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${FILE_TYPE_BADGE[(item.file_type as FileType) ?? 'open']}`}>
                      {FILE_TYPE_LABEL[(item.file_type as FileType) ?? 'open']}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-400">
                    {new Date(item.created_at).toLocaleDateString('ko-KR')}
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-400">
                    {formatFileSize(item.file_size)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      onClick={() => handleDelete(item.id, item.title)}
                      disabled={deleting === item.id}
                      className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50 transition-colors font-medium px-2 py-1 rounded hover:bg-red-50"
                    >
                      {deleting === item.id ? <Spinner className="h-3 w-3 inline" /> : '삭제'}
                    </button>
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
