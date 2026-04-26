import { createFileRoute } from "@tanstack/react-router"

import { PlotBoundaries } from "@/features/process/pages/PlotBoundaries"

export const Route = createFileRoute("/_layout/process/plot-boundaries")({
  component: PlotBoundaries,
  head: () => ({
    meta: [{ title: "Plot boundaries — GEMI" }],
  }),
})
