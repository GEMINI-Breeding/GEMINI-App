import { createFileRoute } from "@tanstack/react-router"
import { z } from "zod"
import { RunTool } from "@/features/process/pages/RunTool"

const toolSearchSchema = z.object({
  runId: z.string(),
  step: z.string(),
})

export const Route = createFileRoute("/_layout/process/$workspaceId/tool")({
  validateSearch: toolSearchSchema,
  component: RunTool,
})
