import { createFileRoute } from "@tanstack/react-router"

import { linesConfig } from "@/features/admin/entities/lines"
import { AdminEntityRoute } from "@/features/admin/pages/AdminEntityRoute"

export const Route = createFileRoute("/_layout/admin/lines")({
  component: () => <AdminEntityRoute config={linesConfig} />,
  head: () => ({ meta: [{ title: "Lines — GEMINI" }] }),
})
