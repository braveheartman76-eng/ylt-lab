import SubjectResourcesPage from '@/components/SubjectResourcesPage'

export const metadata = { title: '노동법 자료실 | 이윤탁 형사법 연구실' }

export default function Page() {
  return (
    <SubjectResourcesPage
      category="노동법"
      categoryLabel="노동법"
      description="노동법 관련 강의 자료, 기출문제, 판례 분석 자료를 제공합니다."
      color="bg-amber-50 text-amber-700"
    />
  )
}
