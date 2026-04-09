/**
 * ReferenceDataPanel
 *
 * Fetches and displays matched reference trait values for a given plot.
 * Reference trait values are always shown in orange text.
 *
 * Used in all three plot viewers (TraitsTable, QueryTab, TraitMap).
 */

import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { ReferenceDataService } from "@/client"

export interface ReferenceDataPanelProps {
  workspaceId: string
  experiment: string
  location: string
  population: string
  plotId: string
  col?: string | null
  row?: string | null
}

interface RefMatch {
  dataset_id: string
  dataset_name: string
  dataset_date: string
  traits: Record<string, number>
}

export function useReferenceData(props: ReferenceDataPanelProps | null) {
  return useQuery({
    queryKey: [
      "ref-match",
      props?.workspaceId,
      props?.experiment,
      props?.location,
      props?.population,
      props?.plotId,
    ],
    queryFn: () =>
      ReferenceDataService.matchPlot({
        workspaceId: props!.workspaceId,
        experiment: props!.experiment,
        location: props!.location,
        population: props!.population,
        plotId: props!.plotId,
        col: props!.col ?? undefined,
        row: props!.row ?? undefined,
      }) as Promise<RefMatch[]>,
    enabled:
      !!props &&
      !!props.workspaceId &&
      !!props.experiment &&
      !!props.location &&
      !!props.population &&
      !!props.plotId,
    staleTime: 60_000,
  })
}

export function ReferenceDataPanel({
  workspaceId,
  experiment,
  location,
  population,
  plotId,
  col,
  row,
}: ReferenceDataPanelProps) {
  const { data: matches = [], isLoading } = useReferenceData({
    workspaceId,
    experiment,
    location,
    population,
    plotId,
    col,
    row,
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground py-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading reference data…
      </div>
    )
  }

  if (matches.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-1">
        No reference data matched for this plot.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {matches.map((match) => (
        <div key={match.dataset_id}>
          <p className="text-[10px] font-semibold text-orange-500 uppercase tracking-wide mb-1">
            {match.dataset_name}{match.dataset_date ? ` (${match.dataset_date})` : ""}
          </p>
          <div className="space-y-0.5">
            {Object.entries(match.traits).map(([trait, value]) => (
              <div key={trait} className="flex items-center justify-between gap-4">
                <span className="text-xs text-orange-500/80">{trait}</span>
                <span className="text-xs font-mono text-orange-500">
                  {typeof value === "number" ? value.toFixed(3) : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Returns true if any reference data exists for the given plot (used to enable the toggle). */
export function useHasReferenceData(props: ReferenceDataPanelProps | null): boolean {
  const { data = [] } = useReferenceData(props)
  return (data as RefMatch[]).length > 0
}
