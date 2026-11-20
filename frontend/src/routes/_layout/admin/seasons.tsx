import { createFileRoute } from "@tanstack/react-router"

import { seasonsConfig } from "@/features/admin/entities/seasons"
import { AdminEntityRoute } from "@/features/admin/pages/AdminEntityRoute"

export const Route = createFileRoute("/_layout/admin/seasons")({
  component: () => <AdminEntityRoute config={seasonsConfig} />,
  head: () => ({ meta: [{ title: "Seasons — GEMINI" }] }),
})
