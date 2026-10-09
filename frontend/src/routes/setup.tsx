import { createFileRoute } from "@tanstack/react-router"
import { AgentHome } from "@/features/agent/pages/AgentHome"

/**
 * First-run setup: the agent page without signing in, for when no
 * processing stack exists yet to sign in to. The agent service only allows
 * this from the computer it runs on, and only while the stack is unreachable.
 */
export const Route = createFileRoute("/setup")({
  component: SetupPage,
  head: () => ({
    meta: [{ title: "Setup - GEMINI" }],
  }),
})

function SetupPage() {
  return <AgentHome setup />
}
