import SubjectResourcesPage from '@/components/SubjectResourcesPage'

export const metadata = { title: '형법 자료실 | 이윤탁 형사법 연구실' }

export default function Page() {
  return (
    <SubjectResourcesPage
      category="형법"
      categoryLabel="형법"
      description="형법 관련 강의 자료, 기출문제, 판례 정리 자료를 제공합니다."
      color="bg-blue-50 text-blue-700"
    />
  )
}
