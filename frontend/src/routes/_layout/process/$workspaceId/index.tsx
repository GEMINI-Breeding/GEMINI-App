import { createFileRoute } from "@tanstack/react-router"

import { WorkspaceDetail } from "@/features/process/pages/WorkspaceDetail"

export const Route = createFileRoute("/_layout/process/$workspaceId/")({
  component: WorkspaceDetail,
  head: () => ({
    meta: [
      {
        title: "Workspace - GEMI",
      },
    ],
  }),
})
