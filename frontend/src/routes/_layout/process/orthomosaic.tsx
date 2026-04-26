import { createFileRoute } from "@tanstack/react-router"

import { OrthomosaicTool } from "@/features/process/pages/OrthomosaicTool"

export const Route = createFileRoute("/_layout/process/orthomosaic")({
  component: OrthomosaicTool,
  head: () => ({
    meta: [{ title: "Orthomosaic — GEMI" }],
  }),
})
