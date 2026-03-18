import { createFileRoute } from "@tanstack/react-router"
import { AnalyzeRun } from "@/features/analyze/pages/AnalyzeRun"

export const Route = createFileRoute("/_layout/analyze/$runId")({
  component: AnalyzeRun,
})
