import { createFileRoute } from "@tanstack/react-router"

import { sitesConfig } from "@/features/admin/entities/sites"
import { AdminEntityRoute } from "@/features/admin/pages/AdminEntityRoute"

export const Route = createFileRoute("/_layout/admin/sites")({
  component: () => <AdminEntityRoute config={sitesConfig} />,
  head: () => ({ meta: [{ title: "Sites — GEMINI" }] }),
})
