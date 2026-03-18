import { createFileRoute } from "@tanstack/react-router"

import { ManageData } from "@/features/files/pages/ManageData"

export const Route = createFileRoute("/_layout/files/manage_data")({
  component: ManageData,
  head: () => ({
    meta: [
      {
        title: "Manage Data - GEMI",
      },
    ],
  }),
})
