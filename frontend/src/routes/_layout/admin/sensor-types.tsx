import { createFileRoute } from "@tanstack/react-router"

import { sensorTypesConfig } from "@/features/admin/entities/sensorTypes"
import { AdminEntityRoute } from "@/features/admin/pages/AdminEntityRoute"

export const Route = createFileRoute("/_layout/admin/sensor-types")({
  component: () => <AdminEntityRoute config={sensorTypesConfig} />,
  head: () => ({ meta: [{ title: "Sensor types — GEMINI" }] }),
})
