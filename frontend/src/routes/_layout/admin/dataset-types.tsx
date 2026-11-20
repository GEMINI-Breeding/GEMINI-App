import { createFileRoute } from "@tanstack/react-router"

import { datasetTypesConfig } from "@/features/admin/entities/datasetTypes"
import { AdminEntityRoute } from "@/features/admin/pages/AdminEntityRoute"

export const Route = createFileRoute("/_layout/admin/dataset-types")({
  component: () => <AdminEntityRoute config={datasetTypesConfig} />,
  head: () => ({ meta: [{ title: "Dataset types — GEMINI" }] }),
})
