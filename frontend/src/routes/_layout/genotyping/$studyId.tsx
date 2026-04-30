import { createFileRoute, useParams } from "@tanstack/react-router"

import { StudyDetail } from "@/features/genotyping/pages/StudyDetail"

function StudyDetailRoute() {
  const { studyId } = useParams({ from: "/_layout/genotyping/$studyId" })
  return <StudyDetail studyId={studyId} />
}

export const Route = createFileRoute("/_layout/genotyping/$studyId")({
  component: StudyDetailRoute,
  head: () => ({ meta: [{ title: "Genotyping study — GEMINI" }] }),
})
