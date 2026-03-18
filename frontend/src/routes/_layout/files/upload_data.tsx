import { createFileRoute } from "@tanstack/react-router"

import { UploadData } from "@/features/files/pages/UploadData"

export const Route = createFileRoute("/_layout/files/upload_data")({
  component: UploadData,
  head: () => ({
    meta: [
      {
        title: "Upload Data - GEMI",
      },
    ],
  }),
})
