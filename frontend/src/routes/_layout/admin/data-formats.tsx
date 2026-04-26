import { createFileRoute } from "@tanstack/react-router"

import { dataFormatsConfig } from "@/features/admin/entities/dataFormats"
import { AdminEntityRoute } from "@/features/admin/pages/AdminEntityRoute"

export const Route = createFileRoute("/_layout/admin/data-formats")({
  component: () => <AdminEntityRoute config={dataFormatsConfig} />,
  head: () => ({ meta: [{ title: "Data formats — GEMINI" }] }),
})
