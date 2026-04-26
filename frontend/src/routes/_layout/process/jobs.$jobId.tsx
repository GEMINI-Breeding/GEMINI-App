import { createFileRoute, useParams } from "@tanstack/react-router"

import { JobDetail } from "@/features/process/pages/JobDetail"

export const Route = createFileRoute("/_layout/process/jobs/$jobId")({
  component: JobDetailRoute,
  head: () => ({
    meta: [{ title: "Job — GEMI" }],
  }),
})

function JobDetailRoute() {
  const { jobId } = useParams({ from: "/_layout/process/jobs/$jobId" })
  return <JobDetail jobId={jobId} />
}
