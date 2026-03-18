import { createFileRoute } from "@tanstack/react-router"
import { AnalyzeDashboard } from "@/features/analyze/pages/AnalyzeDashboard"

export const Route = createFileRoute("/_layout/analyze/")({
  component: AnalyzeDashboard,
})
