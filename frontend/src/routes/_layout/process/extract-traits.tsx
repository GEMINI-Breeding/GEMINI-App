import { createFileRoute } from "@tanstack/react-router"

import { ExtractTraitsTool } from "@/features/process/pages/ExtractTraitsTool"

export const Route = createFileRoute("/_layout/process/extract-traits")({
  component: ExtractTraitsTool,
  head: () => ({
    meta: [{ title: "Extract traits — GEMI" }],
  }),
})
