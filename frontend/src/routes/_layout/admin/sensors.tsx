import { createFileRoute } from "@tanstack/react-router"

import { sensorsConfig } from "@/features/admin/entities/sensors"
import { AdminEntityRoute } from "@/features/admin/pages/AdminEntityRoute"

export const Route = createFileRoute("/_layout/admin/sensors")({
  component: () => <AdminEntityRoute config={sensorsConfig} />,
  head: () => ({ meta: [{ title: "Sensors — GEMINI" }] }),
})
