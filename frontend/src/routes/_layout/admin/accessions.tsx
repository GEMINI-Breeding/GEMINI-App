import { createFileRoute } from "@tanstack/react-router"

import { accessionsConfig } from "@/features/admin/entities/accessions"
import { AdminEntityRoute } from "@/features/admin/pages/AdminEntityRoute"

export const Route = createFileRoute("/_layout/admin/accessions")({
  component: () => <AdminEntityRoute config={accessionsConfig} />,
  head: () => ({ meta: [{ title: "Accessions — GEMINI" }] }),
})
