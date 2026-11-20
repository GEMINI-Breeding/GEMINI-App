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
import { EyeOff, Loader2, Pin } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useProcess } from "@/contexts/ProcessContext"
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
  groupsOf,
  inScope,
  traitsOf,
} from "../widgets/AnalysisWidget"

const PICK_KEY = "gemi.dashboard.overviewExperiment"
const GROUP_KEY = "gemi.dashboard.overviewGroup"
/** What the person hid: whole views, and single trend charts. */
const HIDDEN_KEY = "gemi.dashboard.overviewHidden"

interface Hidden {
  views: AnalysisKind[]
  traits: string[]
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // remembered for this visit only
  }
}

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
  const { queuedJobIds } = useProcess()
  const type = (r: (typeof runs)[number]) =>
    pipelines.find((p) => p.id === r.pipelineId)?.type === "ground"
      ? "ground"
      : "aerial"
  const count = (t: RunTag) =>
    runs.filter((r) => runState(r, type(r), queuedJobIds).tag === t).length
  if (runs.length === 0) return null
  const parts = [
    count("running") && `${count("running")} processing now`,
    count("queued") && `${count("queued")} queued for a worker`,
    count("failed") && `${count("failed")} stopped with an error`,
    count("waiting") && `${count("waiting")} need your input`,
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
  // One choice per experiment, season (year) and site: "over the season" means
  // one season of one field, not every year and place the experiment ran.
  const choices = useMemo(() => {
    const latest = new Map<string, string>()
    for (const r of records.data ?? []) {
      if (!r.experiment) continue
      const key = `${r.experiment}|${r.date.slice(0, 4)}|${r.location ?? ""}`
      if ((latest.get(key) ?? "") < r.date) latest.set(key, r.date)
    }
    return [...latest.entries()]
      .sort((a, b) => b[1].localeCompare(a[1]))
      .map(([k]) => k)
  }, [records.data])
  const [picked, setPicked] = useState<string | null>(readPick)
  const choice = picked && choices.includes(picked) ? picked : choices[0]
  const [experiment, season, site] = choice
    ? choice.split("|")
    : [undefined, undefined, undefined]
  const [pickedGroup, setPickedGroup] = useState<string | null>(() =>
    readJson<string | null>(GROUP_KEY, null),
  )
  const [hidden, setHidden] = useState<Hidden>(() =>
    readJson<Hidden>(HIDDEN_KEY, { views: [], traits: [] }),
  )
  const saveHidden = (next: Hidden) => {
    setHidden(next)
    writeJson(HIDDEN_KEY, next)
  }
  // Views that found nothing to show for this data (no trend yet, no
  // genotypes for heritability): left out rather than shown empty.
  const [unavailable, setUnavailable] = useState<Set<AnalysisKind>>(new Set())
  const reportFor = useCallback(
    (kind: AnalysisKind) => (none: boolean) =>
      setUnavailable((prev) => {
        if (prev.has(kind) === none) return prev
        const next = new Set(prev)
        if (none) next.add(kind)
        else next.delete(kind)
        return next
      }),
    [],
  )
  const reporters = useMemo(
    () =>
      Object.fromEntries(
        VIEWS.map((v) => [v.kind, reportFor(v.kind)]),
      ) as Record<AnalysisKind, (none: boolean) => void>,
    [reportFor],
  )

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

  const all = experimentRecords(records.data, experiment, season, site)
  // One crop group at a time within the season: correlating sorghum with
  // cowpea says nothing useful.
  const groups = groupsOf(all)
  const groupKey = (g: { season: string; population: string }) =>
    `${g.season} · ${g.population}`
  const group =
    groups.find((g) => groupKey(g) === pickedGroup) ?? groups[0] ?? null
  const scope = group
    ? { season: group.season, population: group.population }
    : {}
  const recs = inScope(all, scope)
  const traits = traitsOf(recs)
  const dates = datesOf(recs)
  const configFor = (kind: AnalysisKind): AnalysisConfig => ({
    kind,
    experiment,
    traits: [],
    season,
    site,
    ...scope,
    ...(kind === "trend" ? { hiddenTraits: hidden.traits } : {}),
  })
  const shown = VIEWS.filter(
    (v) => !hidden.views.includes(v.kind) && !unavailable.has(v.kind),
  )
  const hiddenCount = hidden.views.length + hidden.traits.length

  const pin = (view: (typeof VIEWS)[number]) => {
    const config = configFor(view.kind)
    const tab = pinWidget({
      instanceId: `widget-${Date.now()}`,
      type: "analysis",
      title:
        `${view.title} · ${experiment} ${season ?? ""} ${site ?? ""}${group ? ` · ${group.population}` : ""}`.trim(),
      span: view.span,
      config,
    })
    toast.success(`Pinned to "${tab}"`)
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select
          value={choice}
          onValueChange={(v) => {
            setPicked(v)
            setUnavailable(new Set())
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
            {choices.map((c) => (
              <SelectItem key={c} value={c}>
                {c.split("|").filter(Boolean).join(" · ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {groups.length > 1 && group && (
          <Select
            value={groupKey(group)}
            onValueChange={(v) => {
              setPickedGroup(v)
              setUnavailable(new Set())
              writeJson(GROUP_KEY, v)
            }}
          >
            <SelectTrigger className="w-56" data-testid="overview-group">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={groupKey(g)} value={groupKey(g)}>
                  {g.season} season · {g.population}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <span className="text-xs text-muted-foreground">
          {traits.length} trait{traits.length === 1 ? "" : "s"} · {dates.length}{" "}
          date{dates.length === 1 ? "" : "s"} · pin a view to keep it on your
          own tab
        </span>
        {hiddenCount > 0 && (
          <button
            type="button"
            className="text-xs text-primary underline-offset-2 hover:underline"
            onClick={() => saveHidden({ views: [], traits: [] })}
            data-testid="overview-show-hidden"
          >
            Show {hiddenCount} hidden chart{hiddenCount === 1 ? "" : "s"}
          </button>
        )}
      </div>
      <div className="grid grid-cols-12 gap-4">
        <Processing />
        {shown.map((v) => (
          <div
            key={v.kind}
            className={`${
              SPAN_CLASSES[
                // A half-width view whose partner is hidden takes the row.
                v.span === "md" &&
                shown.filter((x) => x.span === "md").length === 1
                  ? "full"
                  : v.span
              ]
            } flex flex-col rounded-lg border bg-card shadow-sm`}
            data-testid={`overview-${v.kind}`}
          >
            <div className="flex items-center justify-between border-b px-3 py-2">
              <h3 className="truncate text-xs font-semibold">{v.title}</h3>
              <div className="flex items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs"
                  onClick={() => pin(v)}
                  title="Keep this view on your own dashboard tab"
                >
                  <Pin className="h-3 w-3" /> Pin
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-2 text-xs"
                  onClick={() =>
                    saveHidden({ ...hidden, views: [...hidden.views, v.kind] })
                  }
                  title="Hide this view (bring it back with “Show hidden” above)"
                  data-testid={`overview-hide-${v.kind}`}
                >
                  <EyeOff className="h-3 w-3" /> Hide
                </Button>
              </div>
            </div>
            <div className="min-h-[120px] flex-1 overflow-auto p-4">
              <AnalysisWidget
                config={configFor(v.kind)}
                onUnavailable={reporters[v.kind]}
                onHideTrait={
                  v.kind === "trend"
                    ? (t) =>
                        saveHidden({ ...hidden, traits: [...hidden.traits, t] })
                    : undefined
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
