import { createFileRoute, useParams } from "@tanstack/react-router"

import { StudyDetail, STUDY_TABS, type StudyTab } from "@/features/genotyping/pages/StudyDetail"

type StudyDetailSearch = { tab?: StudyTab }

function StudyDetailRoute() {
  const { studyId } = useParams({ from: "/_layout/genotyping/$studyId" })
  return <StudyDetail studyId={studyId} />
}

export const Route = createFileRoute("/_layout/genotyping/$studyId")({
  component: StudyDetailRoute,
  validateSearch: (search: Record<string, unknown>): StudyDetailSearch => {
    const tab = typeof search.tab === "string" ? (search.tab as StudyTab) : undefined
    return { tab: tab && STUDY_TABS.includes(tab) ? tab : undefined }
  },
  head: () => ({ meta: [{ title: "Genotyping study — GEMINI" }] }),
})
