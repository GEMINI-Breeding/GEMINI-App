import { createFileRoute } from "@tanstack/react-router"

import { StudiesDashboard } from "@/features/genotyping/pages/StudiesDashboard"

export const Route = createFileRoute("/_layout/genotyping/")({
  component: StudiesDashboard,
  head: () => ({ meta: [{ title: "Genotyping — GEMINI" }] }),
})
