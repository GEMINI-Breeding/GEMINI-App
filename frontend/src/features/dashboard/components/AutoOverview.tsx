/**
 * AutoOverview — the dashboard's first tab, generated rather than built.
 *
 * For one experiment (the one measured most recently, or the one picked):
 * where processing stands, a summary of the data, each trait over the
 * season, which traits move together, which are heritable, and the latest
 * field map. Every view can be pinned to the person's own tab. It follows
 * new trait records as they arrive (the catalog is re-read every 30 s).
 */
import { Link } from "@tanstack/react-router"
import { Loader2, Pin } from "lucide-react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { type RunTag, runState } from "@/features/process/lib/runStatus"
import { useAllPipelines, useAllRuns } from "@/features/process/lib/runStore"
import { useTraitRecords } from "../hooks/useTraitData"
import { pinWidget } from "../store"
import type { AnalysisConfig, AnalysisKind, WidgetSpan } from "../types"
import { SPAN_CLASSES } from "../types"
import {
  AnalysisWidget,
  datesOf,
  experimentRecords,
  traitsOf,
} from "../widgets/AnalysisWidget"

const PICK_KEY = "gemi.dashboard.overviewExperiment"

const VIEWS: { kind: AnalysisKind; title: string; span: WidgetSpan }[] = [
  { kind: "summary", title: "The data", span: "full" },
  { kind: "trend", title: "Traits over the season", span: "full" },
  { kind: "correlation", title: "Which traits move together", span: "md" },
  { kind: "heritability", title: "Which traits are heritable", span: "md" },
  { kind: "field", title: "Latest field map", span: "full" },
]

function readPick(): string | null {
  try {
    return localStorage.getItem(PICK_KEY)
  } catch {
    return null
  }
}

function Processing() {
  const runs = useAllRuns()
  const pipelines = useAllPipelines()
  const type = (r: (typeof runs)[number]) =>
    pipelines.find((p) => p.id === r.pipelineId)?.type === "ground"
      ? "ground"
      : "aerial"
  const count = (t: RunTag) =>
    runs.filter((r) => runState(r, type(r)).tag === t).length
  if (runs.length === 0) return null
  const parts = [
    count("running") && `${count("running")} processing now`,
    count("failed") && `${count("failed")} stopped with an error`,
    count("waiting") && `${count("waiting")} waiting for their next step`,
    count("new") && `${count("new")} not started`,
  ].filter(Boolean)
  return (
    <div className="col-span-12 flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
      <span className="font-medium">Processing</span>
      <span className="text-muted-foreground">
        {parts.length ? `${parts.join(", ")}.` : "Every run is complete."}
      </span>
      <Link
        to="/process"
        className="ml-auto text-primary underline-offset-2 hover:underline"
      >
        Open Process
      </Link>
    </div>
  )
}

export function AutoOverview() {
  const records = useTraitRecords()
  const experiments = useMemo(() => {
    const latest = new Map<string, string>()
    for (const r of records.data ?? []) {
      if (!r.experiment) continue
      if ((latest.get(r.experiment) ?? "") < r.date)
        latest.set(r.experiment, r.date)
    }
    return [...latest.entries()]
      .sort((a, b) => b[1].localeCompare(a[1]))
      .map(([e]) => e)
  }, [records.data])
  const [picked, setPicked] = useState<string | null>(readPick)
  const experiment =
    picked && experiments.includes(picked) ? picked : experiments[0]

  if (records.isLoading)
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )

  if (!experiment)
    return (
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-12 gap-4">
          <Processing />
          <div className="col-span-12 rounded-lg border bg-card p-6 text-sm text-muted-foreground">
            No trait data yet. This page fills itself once traits are extracted
            (Process, last step) or a trait table is imported (Files). Until
            then, Process shows where each run stands.
          </div>
        </div>
      </div>
    )

  const recs = experimentRecords(records.data, experiment)
  const traits = traitsOf(recs)
  const dates = datesOf(recs)

  const pin = (view: (typeof VIEWS)[number]) => {
    const config: AnalysisConfig = { kind: view.kind, experiment, traits: [] }
    const tab = pinWidget({
      instanceId: `widget-${Date.now()}`,
      type: "analysis",
      title: `${view.title} · ${experiment}`,
      span: view.span,
      config,
    })
    toast.success(`Pinned to "${tab}"`)
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select
          value={experiment}
          onValueChange={(v) => {
            setPicked(v)
            try {
              localStorage.setItem(PICK_KEY, v)
            } catch {
              // remembered for this visit only
            }
          }}
        >
          <SelectTrigger className="w-64" data-testid="overview-experiment">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {experiments.map((e) => (
              <SelectItem key={e} value={e}>
                {e}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {traits.length} trait{traits.length === 1 ? "" : "s"} · {dates.length}{" "}
          date{dates.length === 1 ? "" : "s"} · built from the data; pin a view
          to keep it on your own tab
        </span>
      </div>
      <div className="grid grid-cols-12 gap-4">
        <Processing />
        {VIEWS.map((v) => (
          <div
            key={v.kind}
            className={`${SPAN_CLASSES[v.span]} flex flex-col rounded-lg border bg-card shadow-sm`}
            data-testid={`overview-${v.kind}`}
          >
            <div className="flex items-center justify-between border-b px-3 py-2">
              <h3 className="truncate text-xs font-semibold">{v.title}</h3>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                onClick={() => pin(v)}
                title="Keep this view on your own dashboard tab"
              >
                <Pin className="h-3 w-3" /> Pin
              </Button>
            </div>
            <div className="min-h-[120px] flex-1 overflow-auto p-4">
              <AnalysisWidget
                config={{ kind: v.kind, experiment, traits: [] }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
