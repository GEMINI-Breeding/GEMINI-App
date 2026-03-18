import { createFileRoute } from "@tanstack/react-router"

import { ProcessingPipeline } from "@/features/process/pages/ProcessingPipeline"

type PipelineSearch = {
  type?: "aerial" | "ground"
  pipelineId?: string
}

export const Route = createFileRoute(
  "/_layout/process/$workspaceId/pipeline",
)({
  component: ProcessingPipeline,
  validateSearch: (search: Record<string, unknown>): PipelineSearch => {
    return {
      type: search.type === "ground" ? "ground" : "aerial",
      pipelineId: typeof search.pipelineId === "string" ? search.pipelineId : undefined,
    }
  },
  head: () => ({
    meta: [
      {
        title: "Processing Pipeline - GEMI",
      },
    ],
  }),
})
