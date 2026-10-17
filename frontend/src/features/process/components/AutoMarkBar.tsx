/**
 * AutoMarkBar — "Mark automatically" on the Plot Marking screen.
 *
 * Plots are found from the crop itself (where plants and bare alleys
 * alternate along each pass, with the plots-per-bed and plot spacing
 * recorded for the run), the same way the agent marks them. The person then
 * reviews instead of stepping through every frame: passes the marking is
 * unsure of are named, and nothing is saved while any is.
 */
import { useMutation } from "@tanstack/react-query"
import { Loader2, Wand2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { agentApi } from "@/features/agent/lib/agentApi"

export function AutoMarkBar({
  runId,
  hasPlots,
  onSaved,
}: {
  runId: string
  hasPlots: boolean
  onSaved: () => void
}) {
  const mark = useMutation({
    mutationFn: () => agentApi.automark(runId),
    onSuccess: (r) => {
      if (r.saved_version) onSaved()
    },
  })
  const r = mark.data
  const toCheck = r?.passes_to_check ?? []
  return (
    <div
      className="flex flex-wrap items-start gap-3 rounded border px-3 py-2 text-xs"
      data-testid="pm-automark"
    >
      <div className="min-w-0 flex-1">
        {r ? (
          <>
            <p className="font-medium">
              {r.plots} plots found on {r.passes_marked} passes
              {r.saved_version ? `, saved as version ${r.saved_version}.` : "."}
            </p>
            {toCheck.length > 0 && (
              <p className="mt-0.5 text-amber-800 dark:text-amber-300">
                Not saved yet: pass{toCheck.length === 1 ? "" : "es"}{" "}
                {toCheck.join(", ")} need a look (the plot pattern there is weak
                or the count is off). Ask the agent to show them, or mark those
                passes here by hand.
              </p>
            )}
            {r.tell_the_person && (
              <p className="text-muted-foreground mt-0.5">
                {r.tell_the_person}
              </p>
            )}
          </>
        ) : mark.error ? (
          <p className="text-red-700 dark:text-red-400">
            {mark.error instanceof Error
              ? mark.error.message
              : String(mark.error)}
          </p>
        ) : (
          <p className="text-muted-foreground">
            {hasPlots
              ? "Re-mark the whole track from the crop, then review."
              : "Find every plot from the crop (plants and bare alleys along each pass), then review instead of marking frame by frame."}{" "}
            Uses the plots per bed and plot spacing recorded for this run.
          </p>
        )}
      </div>
      <Button
        size="sm"
        variant={hasPlots ? "outline" : "default"}
        className="h-7"
        disabled={mark.isPending}
        data-testid="pm-automark-run"
        onClick={() => mark.mutate()}
      >
        {mark.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Wand2 className="h-3.5 w-3.5" />
        )}
        {mark.isPending ? "Marking… (a minute or two)" : "Mark automatically"}
      </Button>
    </div>
  )
}
