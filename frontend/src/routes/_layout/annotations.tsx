import { createFileRoute } from "@tanstack/react-router"

import { AnnotationsPage } from "@/features/annotations/pages/AnnotationsPage"

export const Route = createFileRoute("/_layout/annotations")({
  component: AnnotationsPage,
  head: () => ({
    meta: [{ title: "Annotations — GEMI" }],
  }),
})
