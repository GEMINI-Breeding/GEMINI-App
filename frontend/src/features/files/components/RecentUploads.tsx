/**
 * "Continue a recent upload" — the next flight or drive of a field already
 * uploaded: one click fills the data type, experiment, season, site,
 * population, platform and sensor from a recent upload, leaving only the new
 * date (and the files) to give.
 *
 * Built from each experiment's uploads that recorded where they belong
 * (lib/experimentContents); one row per field and platform, newest first.
 */
import { useQueries, useQuery } from "@tanstack/react-query"
import { History } from "lucide-react"

import {
  type DatasetOutput,
  type ExperimentOutput,
  ExperimentsService,
} from "@/client"
import { Button } from "@/components/ui/button"
import { dataTypes } from "@/config/dataTypes"
import { idAsString } from "@/features/admin/lib/ids"
import {
  classify,
  dayOf,
  type UploadEntry,
  type Where,
} from "@/features/files/lib/experimentContents"

export interface RecentUpload {
  experiment: { id: string; name: string }
  where: Where
  dataType: string
  /** Field dates already uploaded for this field and platform. */
  dates: string[]
  lastUploaded: string
}

const SHOWN = 6

export function useRecentUploads(): {
  items: RecentUpload[]
  isLoading: boolean
} {
  const experiments = useQuery({
    queryKey: ["experiments", "all"],
    queryFn: async () =>
      ((await ExperimentsService.apiExperimentsAllGetAllExperiments({
        limit: 500,
        offset: 0,
      })) as ExperimentOutput[] | null) ?? [],
  })
  const datasets = useQueries({
    queries: (experiments.data ?? []).map((e) => ({
      queryKey: ["experiments", idAsString(e.id), "datasets"],
      queryFn: async () =>
        ((await ExperimentsService.apiExperimentsIdExperimentIdDatasetsGetExperimentDatasets(
          { experimentId: idAsString(e.id) as string },
        )) as DatasetOutput[] | null) ?? [],
    })),
  })
  const loaded = datasets.map((q) => q.data)
  // A few dozen datasets at most: rebuilt on each render, no memo needed.
  const groups = new Map<string, RecentUpload>()
  ;(experiments.data ?? []).forEach((exp, i) => {
    for (const e of (loaded[i] ?? []).map(classify)) {
      if (e.kind !== "upload" || !e.where) continue
      const up = e as UploadEntry
      const type = up.typeLabel ?? ""
      if (!type || !(type in dataTypes)) continue
      const w = up.where as Where
      const key = [
        exp.experiment_name,
        w.season,
        w.site,
        w.population,
        w.platform,
        w.sensor,
        type,
      ].join("|")
      const g = groups.get(key) ?? {
        experiment: {
          id: idAsString(exp.id) as string,
          name: exp.experiment_name,
        },
        where: w,
        dataType: type,
        dates: [],
        lastUploaded: "",
      }
      if (!g.dates.includes(w.date)) g.dates.push(w.date)
      const when = dayOf(up.uploaded)
      if (when > g.lastUploaded) g.lastUploaded = when
      groups.set(key, g)
    }
  })
  const items = [...groups.values()]
    .map((g) => ({ ...g, dates: g.dates.sort() }))
    .sort((a, b) => b.lastUploaded.localeCompare(a.lastUploaded))
    .slice(0, SHOWN)
  return {
    items,
    isLoading: experiments.isLoading || datasets.some((q) => q.isLoading),
  }
}

export function RecentUploads({
  onUse,
}: {
  onUse: (recent: RecentUpload) => void
}) {
  const { items, isLoading } = useRecentUploads()
  if (!isLoading && items.length === 0) return null
  return (
    <div className="rounded-lg border bg-card p-4" data-testid="recent-uploads">
      <div className="mb-1 flex items-center gap-2">
        <History className="text-muted-foreground h-4 w-4" />
        <h3 className="text-sm font-semibold">Continue a recent upload</h3>
      </div>
      <p className="text-muted-foreground mb-3 text-xs">
        Another date of a field you've uploaded before: fills in everything but
        the date.
      </p>
      {isLoading ? (
        <p className="text-muted-foreground text-xs">Loading…</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {items.map((r) => (
            <li
              key={`${r.experiment.name}|${r.where.season}|${r.where.site}|${r.where.population}|${r.where.platform}|${r.where.sensor}|${r.dataType}`}
              className="flex items-center gap-3 px-3 py-2 text-xs"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {r.experiment.name} · {r.where.season} ·{" "}
                  {[r.where.site, r.where.population].filter(Boolean).join(" ")}
                </div>
                <div className="text-muted-foreground truncate">
                  {r.where.platform} {r.where.sensor} · {r.dataType} · last date{" "}
                  {r.dates[r.dates.length - 1]}
                  {r.dates.length > 1 ? ` (${r.dates.length} dates)` : ""}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 shrink-0 text-xs"
                onClick={() => onUse(r)}
              >
                Use
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
