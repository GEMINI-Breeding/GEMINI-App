import { createFileRoute } from "@tanstack/react-router"

import { InferencePage } from "@/features/models/pages/InferencePage"

export const Route = createFileRoute("/_layout/models/inference")({
  component: InferencePage,
  head: () => ({
    meta: [{ title: "Run inference — GEMI" }],
  }),
})
