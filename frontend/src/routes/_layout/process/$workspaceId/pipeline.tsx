import { createFileRoute } from "@tanstack/react-router"

import { ProcessingPipeline } from "@/features/process/pages/ProcessingPipeline"

type PipelineSearch = {
  type?: "aerial" | "ground"
  pipelineId?: string
  /** Open at this wizard step (3 = inference models). */
  step?: 1 | 2 | 3
  /** Came from this run's inference step: go back there after saving. */
  returnRunId?: string
}

export const Route = createFileRoute("/_layout/process/$workspaceId/pipeline")({
  component: ProcessingPipeline,
  validateSearch: (search: Record<string, unknown>): PipelineSearch => {
    return {
      type: search.type === "ground" ? "ground" : "aerial",
      pipelineId:
        typeof search.pipelineId === "string" ? search.pipelineId : undefined,
      step: [1, 2, 3].includes(Number(search.step))
        ? (Number(search.step) as 1 | 2 | 3)
        : undefined,
      returnRunId:
        typeof search.returnRunId === "string" ? search.returnRunId : undefined,
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
