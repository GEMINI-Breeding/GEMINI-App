import { createFileRoute } from "@tanstack/react-router"

import { SplitOrthomosaicTool } from "@/features/process/pages/SplitOrthomosaicTool"

export const Route = createFileRoute("/_layout/process/split")({
  component: SplitOrthomosaicTool,
  head: () => ({
    meta: [{ title: "Split orthomosaic — GEMI" }],
  }),
})
