import { createFileRoute } from "@tanstack/react-router"

import { ProcessingPipeline } from "@/features/process/pages/ProcessingPipeline"

export const Route = createFileRoute("/_layout/process/")({
  component: ProcessingPipeline,
  head: () => ({
    meta: [{ title: "Process — GEMI" }],
  }),
})
