import { createFileRoute } from "@tanstack/react-router"

import { traitsConfig } from "@/features/admin/entities/traits"
import { AdminEntityRoute } from "@/features/admin/pages/AdminEntityRoute"

export const Route = createFileRoute("/_layout/admin/traits")({
  component: () => <AdminEntityRoute config={traitsConfig} />,
  head: () => ({ meta: [{ title: "Traits — GEMINI" }] }),
})
