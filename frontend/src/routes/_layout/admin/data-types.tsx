import { createFileRoute } from "@tanstack/react-router"

import { dataTypesConfig } from "@/features/admin/entities/dataTypes"
import { AdminEntityRoute } from "@/features/admin/pages/AdminEntityRoute"

export const Route = createFileRoute("/_layout/admin/data-types")({
  component: () => <AdminEntityRoute config={dataTypesConfig} />,
  head: () => ({ meta: [{ title: "Data types — GEMINI" }] }),
})
