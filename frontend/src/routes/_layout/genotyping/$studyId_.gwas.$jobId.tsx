import { createFileRoute, useParams } from "@tanstack/react-router"

import { GwasJobDetail } from "@/features/genotyping/pages/GwasJobDetail"

function GwasJobDetailRoute() {
  const { studyId, jobId } = useParams({
    from: "/_layout/genotyping/$studyId_/gwas/$jobId",
  })
  return <GwasJobDetail studyId={studyId} jobId={jobId} />
}

export const Route = createFileRoute(
  "/_layout/genotyping/$studyId_/gwas/$jobId",
)({
  component: GwasJobDetailRoute,
  head: () => ({ meta: [{ title: "GWAS job — GEMINI" }] }),
})
