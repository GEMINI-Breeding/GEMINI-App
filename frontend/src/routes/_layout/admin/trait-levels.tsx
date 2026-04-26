import { createFileRoute } from "@tanstack/react-router"

import { traitLevelsConfig } from "@/features/admin/entities/traitLevels"
import { AdminEntityRoute } from "@/features/admin/pages/AdminEntityRoute"

export const Route = createFileRoute("/_layout/admin/trait-levels")({
  component: () => <AdminEntityRoute config={traitLevelsConfig} />,
  head: () => ({ meta: [{ title: "Trait levels — GEMINI" }] }),
})
