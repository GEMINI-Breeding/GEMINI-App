/**
 * RunGroupList — a flight day per row: date, site · population · platform,
 * the sensors flown (RGB and thermal together) and where its runs stand.
 * A day with several runs (diurnal flights, treatments flown apart, another
 * sensor) expands to one line per run of the day, each line naming its
 * treatment(s) and holding the run of each sensor; a day with one run opens
 * it directly.
 */
import { ChevronDown, ChevronRight, Navigation, Plane } from "lucide-react"
import { type ReactNode, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { useProcess } from "@/contexts/ProcessContext"
import { useBatchLabels } from "@/features/process/hooks/useBatchLabels"
import {
  groupRuns,
  type RunGroup,
  TAG_PRIORITY,
} from "@/features/process/lib/runGroups"
import {
  RUN_STEPS,
  type RunState,
  type RunTag,
  runState,
  TAG_CLASS,
  TAG_HINT,
  TAG_LABEL,
} from "@/features/process/lib/runStatus"
import type { Run } from "@/features/process/lib/runStore"
import { AgentRunMark } from "./AgentRunMark"

type Filter = "all" | RunTag | "active"

const FILTERS: { key: Filter; label: string; tags: RunTag[] }[] = [
  { key: "waiting", label: "Input needed", tags: ["waiting", "new"] },
  { key: "active", label: "Running", tags: ["running", "queued"] },
  { key: "failed", label: "Failed", tags: ["failed"] },
  { key: "complete", label: "Complete", tags: ["complete"] },
]

export function RunGroupList({
  runs,
  experiment,
  typeOf,
  onOpen,
  actions,
  showDate = true,
}: {
  runs: Run[]
  /** For the upload labels of runs that pool several batches. */
  experiment?: string
  typeOf: (run: Run) => "aerial" | "ground"
  onOpen: (run: Run) => void
  /** Per-run controls (a delete menu), shown on the run's line. */
  actions?: (run: Run) => ReactNode
  showDate?: boolean
}) {
  const labels = useBatchLabels(experiment)
  const { queuedJobIds } = useProcess()
  const groups = useMemo(() => groupRuns(runs, labels), [runs, labels])
  const summaries = useMemo(
    () => groups.map((g) => summarise(g, typeOf, queuedJobIds)),
    [groups, typeOf, queuedJobIds],
  )
  // Find what needs you: by status, and by crop when there are several.
  const [filter, setFilter] = useState<Filter>("all")
  const [crop, setCrop] = useState<string | null>(null)
  const crops = useMemo(
    () => [...new Set(groups.map((g) => g.crop).filter(Boolean))].sort(),
    [groups],
  )
  const inCrop = (i: number) => !crop || groups[i].crop === crop
  const count = (f: (typeof FILTERS)[number]) =>
    summaries.filter((s, i) => inCrop(i) && f.tags.includes(s.tag)).length
  const shown = groups
    .map((g, i) => ({ g, s: summaries[i], i }))
    .filter(
      ({ s, i }) =>
        inCrop(i) &&
        (filter === "all" ||
          FILTERS.find((f) => f.key === filter)?.tags.includes(s.tag)),
    )
  // What every run shares (the site, the crop) is said once above the rows,
  // which then show only what tells them apart.
  const shared = {
    site:
      groups.length > 1 &&
      groups.every((g) => g.site && g.site === groups[0].site)
        ? groups[0].site
        : "",
    crop:
      groups.length > 1 &&
      groups.every((g) => g.crop && g.crop === groups[0].crop)
        ? groups[0].crop
        : "",
  }
  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-xs ${active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`
  return (
    <div className="space-y-1" data-testid="run-groups">
      {(shared.site || shared.crop) && (
        <p
          className="text-muted-foreground px-2 text-xs"
          data-testid="run-groups-shared"
        >
          All runs:{" "}
          <span className="text-foreground font-medium">
            {[shared.site, shared.crop].filter(Boolean).join(" · ")}
          </span>
        </p>
      )}
      {groups.length > 3 && (
        <div
          className="flex flex-wrap items-center gap-1.5 px-2 pb-1"
          data-testid="run-filters"
        >
          <button
            type="button"
            className={chip(filter === "all")}
            onClick={() => setFilter("all")}
          >
            All {groups.filter((_, i) => inCrop(i)).length}
          </button>
          {FILTERS.map((f) => {
            const n = count(f)
            if (!n && filter !== f.key) return null
            return (
              <button
                key={f.key}
                type="button"
                className={chip(filter === f.key)}
                data-testid={`run-filter-${f.key}`}
                onClick={() => setFilter(filter === f.key ? "all" : f.key)}
              >
                {f.label} {n}
              </button>
            )
          })}
          {crops.length > 1 && (
            <>
              <span className="bg-border mx-1 h-4 w-px" />
              {crops.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={chip(crop === c)}
                  data-testid={`run-crop-${c}`}
                  onClick={() => setCrop(crop === c ? null : c)}
                >
                  {c}
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {shown.map(({ g, s }) => (
        <GroupRow
          key={g.key}
          g={g}
          s={s}
          shared={shared}
          typeOf={typeOf}
          onOpen={onOpen}
          actions={actions}
          showDate={showDate}
        />
      ))}
      {shown.length === 0 && (
        <p className="text-muted-foreground px-2 py-3 text-xs">
          No runs match these filters.
        </p>
      )}
    </div>
  )
}

function worst(tags: RunTag[]): RunTag {
  return ((TAG_PRIORITY as readonly string[]).find((t) =>
    tags.includes(t as RunTag),
  ) ?? "new") as RunTag
}

interface GroupSummary {
  tag: RunTag
  states: Map<string, RunState>
  /** The runs to process (other cameras' runs folded into an RGB run aside). */
  processing: RunGroup["lines"][number]["runs"]
  single: Run | null
  /** Sensors whose frames ride along with the single run (thermal with RGB). */
  singleWith: string[]
  /** The single run's steps, in order, with their status. */
  steps: { label: string; status: string }[]
  /** "11 runs · 8 input needed · 3 complete" or "Next: Trait extraction". */
  status: string
  /** Times of day and treatments of a day with several runs. */
  extra: string
}

function summarise(
  g: RunGroup,
  typeOf: (run: Run) => "aerial" | "ground",
  queuedJobIds: ReadonlySet<string>,
): GroupSummary {
  const states = new Map(
    g.runs.map((r) => [r.id, runState(r, typeOf(r), queuedJobIds)]),
  )
  // Another camera's run folded into an RGB run waits for nothing (its frames are
  // used by the RGB run): it counts only once its own orthomosaic is under way.
  const folded = new Set(
    g.lines.flatMap((l) => l.runs.flatMap((r) => r.with.map((w) => w.run.id))),
  )
  const counted = [...states.entries()].filter(
    ([id, st]) =>
      !folded.has(id) || ["running", "queued", "failed"].includes(st.tag),
  )
  const tag = worst(counted.map(([, st]) => st.tag))
  const processing = g.lines.flatMap((l) => l.runs)
  const single = processing.length === 1 ? processing[0].run : null
  const type = typeOf(g.runs[0])
  const steps = single
    ? RUN_STEPS[type].map(([k, label]) => ({
        label,
        status: single.steps[k]?.status ?? "pending",
      }))
    : []
  const timesOfDay = g.lines.filter((l) => l.key).length
  let status: string
  if (single) status = states.get(single.id)?.detail ?? ""
  else {
    const byTag = new Map<RunTag, number>()
    for (const { run } of processing) {
      const t = states.get(run.id)?.tag ?? "new"
      byTag.set(t, (byTag.get(t) ?? 0) + 1)
    }
    status = [
      `${processing.length} runs`,
      ...(TAG_PRIORITY as readonly RunTag[])
        .filter((t) => byTag.get(t))
        .map((t) => `${byTag.get(t)} ${TAG_LABEL[t]}`),
    ].join(" · ")
  }
  return {
    tag,
    states,
    processing,
    single,
    singleWith: single ? processing[0].with.map((w) => w.sensor) : [],
    steps,
    status,
    extra: single
      ? ""
      : [
          timesOfDay > 0 && `${timesOfDay + 1} times of day`,
          g.treatments.length > 1 && g.treatments.join(" / "),
        ]
          .filter(Boolean)
          .join(" · "),
  }
}

// A steady colour per crop, so rows of one crop are found at a glance.
const CROP_COLORS = [
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
]
function cropClass(crop: string): string {
  let h = 0
  for (const ch of crop) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return CROP_COLORS[h % CROP_COLORS.length]
}

const STEP_DOT: Record<string, string> = {
  completed: "bg-green-500",
  skipped: "bg-muted-foreground/40",
  running: "bg-blue-500 animate-pulse",
  failed: "bg-red-500",
  pending: "bg-muted-foreground/20",
}

/** One dot per step: where a run is at a glance (hover for each step). */
function StepDots({ steps }: { steps: GroupSummary["steps"] }) {
  const done = steps.filter(
    (s) => s.status === "completed" || s.status === "skipped",
  ).length
  return (
    <span
      className="flex w-32 shrink-0 items-center gap-1"
      title={steps
        .map(
          (s) => `${s.label}: ${s.status === "pending" ? "to do" : s.status}`,
        )
        .join("\n")}
      data-testid="run-step-dots"
    >
      {steps.map((s) => (
        <span
          key={s.label}
          className={`h-1.5 w-3 rounded-full ${STEP_DOT[s.status] ?? STEP_DOT.pending}`}
        />
      ))}
      <span className="text-muted-foreground ml-1 w-7 text-[11px] tabular-nums">
        {done}/{steps.length}
      </span>
    </span>
  )
}

function GroupRow({
  g,
  s,
  shared,
  typeOf,
  onOpen,
  actions,
  showDate,
}: {
  g: RunGroup
  s: GroupSummary
  shared: { site: string; crop: string }
  typeOf: (run: Run) => "aerial" | "ground"
  onOpen: (run: Run) => void
  actions?: (run: Run) => ReactNode
  showDate: boolean
}) {
  const [open, setOpen] = useState(false)
  const { tag, states, single, singleWith } = s
  const type = typeOf(g.runs[0])
  const Icon = type === "ground" ? Navigation : Plane

  return (
    <div className="rounded-md" data-testid="run-group">
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-testid="run-group-row"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted/50"
          onClick={() => (single ? onOpen(single) : setOpen((v) => !v))}
          aria-expanded={single ? undefined : open}
        >
          {single ? (
            <span className="w-4" />
          ) : open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <Icon
            className={`h-4 w-4 shrink-0 ${type === "ground" ? "text-green-600" : "text-blue-600"}`}
            aria-label={type === "ground" ? "Ground" : "Drone"}
          />
          {showDate && (
            <span className="w-24 shrink-0 text-sm text-muted-foreground">
              {g.date}
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
              {g.crop && !shared.crop ? (
                <>
                  <span
                    className={`shrink-0 rounded px-1.5 text-xs font-semibold ${cropClass(g.crop)}`}
                    data-testid="run-group-crop"
                  >
                    {g.crop}
                  </span>
                  {g.site && !shared.site && (
                    <span className="truncate font-normal">{g.site}</span>
                  )}
                </>
              ) : (
                <span className="truncate">
                  {[!shared.site && g.site, !shared.crop && g.crop]
                    .filter(Boolean)
                    .join(" · ") || g.field}
                </span>
              )}
              {single && <AgentRunMark run={single} />}
            </span>
            {s.extra && (
              <span
                className="text-muted-foreground truncate text-xs"
                title={s.extra}
              >
                {s.extra}
              </span>
            )}
          </span>
          <span className="flex w-28 shrink-0 justify-end gap-1">
            {g.sensors.map((sensor) => (
              <span
                key={sensor}
                className="rounded border px-1.5 text-[11px] text-muted-foreground"
                title={
                  singleWith.includes(sensor)
                    ? `${sensor} frames are processed with the RGB run (one run)`
                    : undefined
                }
              >
                {sensor}
              </span>
            ))}
          </span>
          {single ? (
            <StepDots steps={s.steps} />
          ) : (
            <span className="w-32 shrink-0" />
          )}
          <span
            className="w-56 shrink-0 truncate text-xs text-muted-foreground"
            title={s.status}
            data-testid="run-group-status"
          >
            {s.status}
          </span>
          <Badge
            variant="secondary"
            className={`w-24 shrink-0 justify-center ${TAG_CLASS[tag]}`}
            title={TAG_HINT[tag]}
          >
            {TAG_LABEL[tag]}
          </Badge>
        </button>
        {single
          ? actions?.(single)
          : // The same width as a run's menu, so every row's columns line up.
            actions && <span className="w-7 shrink-0" />}
      </div>
      {open && !single && (
        <div className="mb-1 ml-9 space-y-0.5 border-l pl-3">
          {g.lines.map((line) => (
            <div
              key={line.key || "first"}
              className="flex flex-wrap items-center gap-2 py-0.5"
              data-testid="run-group-line"
            >
              <span className="w-56 shrink-0 truncate text-xs font-medium">
                {line.title || "Run"}
              </span>
              {line.runs.map(({ run, sensor, treatments, with: others }) => {
                const st = states.get(run.id)
                const mixed =
                  new Set(line.runs.map((r) => r.treatments.join())).size > 1
                return (
                  <span key={run.id} className="flex items-center">
                    <button
                      type="button"
                      onClick={() => onOpen(run)}
                      title={st?.detail}
                      data-testid="run-group-run"
                      className="flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs hover:bg-muted/50"
                    >
                      <span className="font-medium">
                        {[sensor, ...new Set(others.map((o) => o.sensor))].join(
                          " + ",
                        )}
                      </span>
                      {mixed && treatments.length > 0 && (
                        <span className="text-muted-foreground">
                          {treatments.join(" + ")}
                        </span>
                      )}
                      <AgentRunMark run={run} />
                      {st && (
                        <span
                          className={`rounded px-1 text-[10px] ${TAG_CLASS[st.tag]}`}
                        >
                          {TAG_LABEL[st.tag]}
                        </span>
                      )}
                    </button>
                    {actions?.(run)}
                  </span>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
