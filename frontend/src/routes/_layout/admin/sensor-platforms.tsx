import { createFileRoute } from "@tanstack/react-router"

import { sensorPlatformsConfig } from "@/features/admin/entities/sensorPlatforms"
import { AdminEntityRoute } from "@/features/admin/pages/AdminEntityRoute"

export const Route = createFileRoute("/_layout/admin/sensor-platforms")({
  component: () => <AdminEntityRoute config={sensorPlatformsConfig} />,
  head: () => ({ meta: [{ title: "Sensor platforms — GEMINI" }] }),
})
