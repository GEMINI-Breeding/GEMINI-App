import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

import { AnalyzeDashboard } from "@/features/analyze/pages/AnalyzeDashboard"

const analyzeSearchSchema = z.object({
  view: z.enum(["single", "multi", "map", "table"]).optional(),
  /** Single trait opened from a link: the trait (by name), the chart and the scope.
   *  Coerced: the router reads "2026" in the address as a number. */
  trait: z.coerce.string().optional(),
  chart: z.enum(["date-trend", "season-table", "histogram"]).optional(),
  experiment: z.coerce.string().optional(),
  season: z.coerce.string().optional(),
  site: z.coerce.string().optional(),
  population: z.coerce.string().optional(),
})

export const Route = createFileRoute("/_layout/analyze/")({
  validateSearch: analyzeSearchSchema,
  component: AnalyzeDashboard,
})
