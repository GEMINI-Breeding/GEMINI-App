import { createFileRoute } from "@tanstack/react-router"

import { populationsConfig } from "@/features/admin/entities/populations"
import { AdminEntityRoute } from "@/features/admin/pages/AdminEntityRoute"

export const Route = createFileRoute("/_layout/admin/populations")({
  component: () => <AdminEntityRoute config={populationsConfig} />,
  head: () => ({ meta: [{ title: "Populations — GEMINI" }] }),
})
