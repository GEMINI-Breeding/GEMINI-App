import { createFileRoute } from "@tanstack/react-router"

import { ModelsDashboard } from "@/features/models/pages/ModelsDashboard"

export const Route = createFileRoute("/_layout/models/")({
  component: ModelsDashboard,
  head: () => ({
    meta: [{ title: "Models — GEMI" }],
  }),
})
