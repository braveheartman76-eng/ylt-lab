import SubjectResourcesPage from '@/components/SubjectResourcesPage'

export const metadata = { title: '교정학 자료실 | 이윤탁 형사법 연구실' }

export default function Page() {
  return (
    <SubjectResourcesPage
      category="교정학"
      categoryLabel="교정학"
      description="교정학 관련 강의 자료, 기출문제, 이론 정리 자료를 제공합니다."
      color="bg-teal-50 text-teal-700"
    />
  )
}
