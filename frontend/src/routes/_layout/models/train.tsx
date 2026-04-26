import { createFileRoute } from "@tanstack/react-router"

import { TrainModelTool } from "@/features/models/pages/TrainModelTool"

export const Route = createFileRoute("/_layout/models/train")({
  component: TrainModelTool,
  head: () => ({
    meta: [{ title: "Train model — GEMI" }],
  }),
})
