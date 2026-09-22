import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

import { AnalyzeDashboard } from "@/features/analyze/pages/AnalyzeDashboard"

const analyzeSearchSchema = z.object({
  view: z.enum(["single", "multi", "map", "table"]).optional(),
})

export const Route = createFileRoute("/_layout/analyze/")({
  validateSearch: analyzeSearchSchema,
  component: AnalyzeDashboard,
})
