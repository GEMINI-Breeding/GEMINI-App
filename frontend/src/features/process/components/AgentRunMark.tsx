/**
 * AgentRunMark — a small agent icon beside a run whose latest change the
 * app's agent made (not a person starting a step or saving their work).
 */
import { Bot } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { agentLastChanged, type Run } from "@/features/process/lib/runStore"

export function AgentRunMark({
  run,
  className = "h-3.5 w-3.5",
}: {
  run: Pick<Run, "createdBy" | "lastBy">
  className?: string
}) {
  if (!agentLastChanged(run)) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex shrink-0 text-muted-foreground"
          role="img"
          aria-label="Last changed by the agent"
          data-testid="agent-run-mark"
        >
          <Bot className={className} />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        The agent made the latest change here. Open it to follow or carry on by
        hand.
      </TooltipContent>
    </Tooltip>
  )
}
