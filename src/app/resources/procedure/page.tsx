import SubjectResourcesPage from '@/components/SubjectResourcesPage'

export const metadata = { title: '형사소송법 자료실 | 이윤탁 형사법 연구실' }

export default function Page() {
  return (
    <SubjectResourcesPage
      category="형사소송법"
      categoryLabel="형사소송법"
      description="형사소송법 관련 강의 자료, 기출문제, 개정법령 분석 자료를 제공합니다."
      color="bg-indigo-50 text-indigo-700"
    />
  )
}
