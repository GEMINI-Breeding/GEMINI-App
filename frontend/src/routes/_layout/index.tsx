import { createFileRoute } from "@tanstack/react-router"
import { AgentHome } from "@/features/agent/pages/AgentHome"

export const Route = createFileRoute("/_layout/")({
  component: AgentHome,
  head: () => ({
    meta: [{ title: "Agent - GEMINI" }],
  }),
})
