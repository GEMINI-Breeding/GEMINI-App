import { createFileRoute } from "@tanstack/react-router"
import { DashboardBuilder } from "@/features/dashboard/components/DashboardBuilder"

export const Route = createFileRoute("/_layout/")({
  component: DashboardPage,
  head: () => ({
    meta: [{ title: "Dashboard - GEMINI" }],
  }),
})

function DashboardPage() {
  return <DashboardBuilder />
}
