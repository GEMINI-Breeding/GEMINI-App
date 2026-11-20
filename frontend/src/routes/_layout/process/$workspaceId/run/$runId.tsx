import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"

import { RunDetail } from "@/features/process/pages/RunDetail"

export const Route = createFileRoute(
  "/_layout/process/$workspaceId/run/$runId",
)({
  // ?step=trait_extraction opens the run at that step (the workspace grid's cells).
  validateSearch: z.object({ step: z.string().optional() }),
  component: RunDetail,
  head: () => ({
    meta: [
      {
        title: "Run Detail - GEMI",
      },
    ],
  }),
})
