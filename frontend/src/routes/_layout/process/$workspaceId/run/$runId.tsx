import { createFileRoute } from "@tanstack/react-router"
import { RunDetail } from "@/features/process/pages/RunDetail"

export const Route = createFileRoute("/_layout/process/$workspaceId/run/$runId")({
  component: RunDetail,
  head: () => ({
    meta: [
      {
        title: "Run Detail - GEMI",
      },
    ],
  }),
})
