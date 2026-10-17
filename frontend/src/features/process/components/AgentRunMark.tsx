/**
 * AgentRunMark — a small agent icon beside a run the app's agent started.
 * Runs live where a person would file them (their experiment's workspace);
 * this mark is the only thing that tells the two apart.
 */
import { Bot } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Run } from "@/features/process/lib/runStore"

export function AgentRunMark({
  run,
  className = "h-3.5 w-3.5",
}: {
  run: Pick<Run, "createdBy">
  className?: string
}) {
  if (run.createdBy !== "agent") return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex shrink-0 text-muted-foreground"
          role="img"
          aria-label="Started by the agent"
          data-testid="agent-run-mark"
        >
          <Bot className={className} />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        Started by the agent. Open it to follow or carry on by hand.
      </TooltipContent>
    </Tooltip>
  )
}
