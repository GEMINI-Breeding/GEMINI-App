import { createFileRoute } from "@tanstack/react-router"

import { WorkspaceDashboard } from "@/features/process/pages/WorkspaceDashboard"

export const Route = createFileRoute("/_layout/process/")({
  component: WorkspaceDashboard,
  head: () => ({
    meta: [
      {
        title: "Process - GEMI",
      },
    ],
  }),
})
