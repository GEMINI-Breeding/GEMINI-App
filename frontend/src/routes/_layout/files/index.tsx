import { createFileRoute } from "@tanstack/react-router"

import { FilesDashboard } from "@/features/files/pages/FilesDashboard"

export const Route = createFileRoute("/_layout/files/")({
  component: FilesDashboard,
  head: () => ({
    meta: [{ title: "Files - GEMI" }],
  }),
})
