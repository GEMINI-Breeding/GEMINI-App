/**
 * RunGrid — a pipeline's flight days as a grid: one row per day, one column
 * per stage of the pipeline (from RUN_STAGES, the run page's own steps).
 * Every cell is a click into that day at that stage. Seasons fold, the grid
 * scrolls inside its own box, and a line above it says how far each stage
 * is across all days.
 *
 * A day with several runs (times of day, treatments flown apart, another
 * sensor) shows how many of its runs are done per stage and opens to a row
 * per run.
 */
import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Minus,
  X,
} from "lucide-react"
import type React from "react"
import { type ReactNode, useMemo, useState } from "react"

import { useProcess } from "@/contexts/ProcessContext"
import { useBatchLabels } from "@/features/process/hooks/useBatchLabels"
import {
  groupRuns,
  type RunGroup,
  TAG_PRIORITY,
} from "@/features/process/lib/runGroups"
import {
  RUN_STAGES,
  type RunState,
  type RunTag,
  runState,
  type Stage,
  TAG_CLASS,
  TAG_HINT,
  TAG_LABEL,
} from "@/features/process/lib/runStatus"
import type { Run } from "@/features/process/lib/runStore"
import { AgentRunMark } from "./AgentRunMark"

type Filter = "all" | "waiting" | "active" | "failed" | "complete"

const FILTERS: { key: Filter; label: string; tags: RunTag[] }[] = [
  { key: "waiting", label: "Input needed", tags: ["waiting", "new"] },
  { key: "active", label: "Running", tags: ["running", "queued"] },
  { key: "failed", label: "Failed", tags: ["failed"] },
  { key: "complete", label: "Done", tags: ["complete"] },
]

const DONE = new Set(["completed", "skipped"])

function worst(tags: RunTag[]): RunTag {
  return ((TAG_PRIORITY as readonly string[]).find((t) =>
    tags.includes(t as RunTag),
  ) ?? "new") as RunTag
}

/** The run's next required stage (the one to do), if any. */
function nextStage(run: Run, stages: Stage[]): string | null {
  const s = stages.find(
    (x) => !x.optional && !DONE.has(run.steps[x.key]?.status ?? "pending"),
  )
  return s?.key ?? null
}

function seasonOf(g: RunGroup): string {
  return g.runs[0]?.uploadScope?.year || g.date.slice(0, 4) || "—"
}

export function RunGrid({
  runs,
  experiment,
  type,
  onOpen,
  actions,
}: {
  runs: Run[]
  experiment?: string
  type: "aerial" | "ground"
  /** Open a run, at a stage when a cell was clicked. */
  onOpen: (run: Run, step?: string) => void
  actions?: (run: Run) => ReactNode
}) {
  const stages = RUN_STAGES[type]
  const labels = useBatchLabels(experiment)
  const { queuedJobIds } = useProcess()
  const groups = useMemo(() => groupRuns(runs, labels), [runs, labels])
  const states = useMemo(
    () => new Map(runs.map((r) => [r.id, runState(r, type, queuedJobIds)])),
    [runs, type, queuedJobIds],
  )
  const groupTag = (g: RunGroup) =>
    worst(g.runs.map((r) => states.get(r.id)?.tag ?? "new"))

  const [filter, setFilter] = useState<Filter>("all")
  const [crop, setCrop] = useState<string | null>(null)
  const crops = useMemo(
    () => [...new Set(groups.map((g) => g.crop).filter(Boolean))].sort(),
    [groups],
  )
  const shown = groups.filter(
    (g) =>
      (!crop || g.crop === crop) &&
      (filter === "all" ||
        FILTERS.find((f) => f.key === filter)?.tags.includes(groupTag(g))),
  )

  // Seasons, newest first; the newest is open, older ones fold (all open
  // when there are few days).
  const seasons = useMemo(() => {
    const m = new Map<string, RunGroup[]>()
    for (const g of shown) {
      const s = seasonOf(g)
      m.set(s, [...(m.get(s) ?? []), g])
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [shown])
  const [folded, setFolded] = useState<Record<string, boolean>>({})
  const isFolded = (s: string, i: number) =>
    folded[s] ?? (i > 0 && shown.length > 12)

  // How far each stage is across the days shown.
  const progress = stages.map((st) => {
    const rs = shown.flatMap((g) => g.runs)
    return {
      st,
      done: rs.filter((r) => DONE.has(r.steps[st.key]?.status ?? "")).length,
      total: rs.length,
    }
  })

  const shared = {
    site:
      groups.length > 1 && groups.every((g) => g.site === groups[0].site)
        ? groups[0].site
        : "",
    crop:
      groups.length > 1 && groups.every((g) => g.crop === groups[0].crop)
        ? groups[0].crop
        : "",
  }
  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-xs ${active ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`
  // Inline: a class built at run time is not seen by Tailwind.
  const cols: React.CSSProperties = {
    // Fits the page: the stages share what is left, no sideways scroll.
    gridTemplateColumns: `1rem 5.25rem minmax(4.5rem,8rem) repeat(${stages.length}, minmax(0,1fr)) minmax(5.5rem,7.5rem) 1.5rem`,
  }

  return (
    <div className="space-y-2" data-testid="run-grid">
      <div className="flex flex-wrap items-center gap-1.5">
        {(shared.site || shared.crop) && (
          <span className="text-muted-foreground mr-2 text-xs">
            All runs:{" "}
            <span className="text-foreground font-medium">
              {[shared.site, shared.crop].filter(Boolean).join(" · ")}
            </span>
          </span>
        )}
        <button
          type="button"
          className={chip(filter === "all")}
          onClick={() => setFilter("all")}
        >
          All {groups.length}
        </button>
        {FILTERS.map((f) => {
          const n = groups.filter(
            (g) => (!crop || g.crop === crop) && f.tags.includes(groupTag(g)),
          ).length
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
                onClick={() => setCrop(crop === c ? null : c)}
              >
                {c}
              </button>
            ))}
          </>
        )}
      </div>

      <div
        className="max-h-[min(62vh,40rem)] overflow-y-auto overflow-x-hidden rounded-md border"
        data-testid="run-grid-scroll"
      >
        <div className="text-xs">
          {/* Header: each stage with how many days have it done. */}
          <div
            className="bg-muted sticky top-0 z-10 grid items-end gap-x-1 border-b px-2 py-1.5"
            style={cols}
          >
            <span />
            <span className="font-medium">Date</span>
            <span className="font-medium">Crop</span>
            {progress.map(({ st, done, total }) => (
              <span
                key={st.key}
                className={`min-w-0 truncate text-center leading-tight ${st.optional ? "text-muted-foreground" : "font-medium"}`}
                title={`${st.label}${st.optional ? " (optional)" : ""}: done on ${done} of ${total} runs`}
              >
                {st.short}
                <span className="text-muted-foreground block text-[10px] font-normal tabular-nums">
                  {done}/{total}
                </span>
              </span>
            ))}
            <span className="font-medium">Status</span>
            <span />
          </div>

          {seasons.map(([season, gs], si) => (
            <div key={season}>
              {seasons.length > 1 && (
                <button
                  type="button"
                  className="bg-muted/40 hover:bg-muted flex w-full items-center gap-1.5 border-b px-2 py-1 text-left font-medium"
                  onClick={() =>
                    setFolded((f) => ({
                      ...f,
                      [season]: !isFolded(season, si),
                    }))
                  }
                  data-testid={`run-grid-season-${season}`}
                >
                  {isFolded(season, si) ? (
                    <ChevronRight className="size-3.5" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}
                  {season}
                  <span className="text-muted-foreground font-normal">
                    · {gs.length} day{gs.length === 1 ? "" : "s"} ·{" "}
                    {gs.filter((g) => groupTag(g) === "complete").length} done
                  </span>
                </button>
              )}
              {!isFolded(season, si) &&
                gs.map((g) => (
                  <DayRows
                    key={g.key}
                    g={g}
                    cols={cols}
                    stages={stages}
                    states={states}
                    tag={groupTag(g)}
                    shared={shared}
                    onOpen={onOpen}
                    actions={actions}
                  />
                ))}
            </div>
          ))}
          {shown.length === 0 && (
            <p className="text-muted-foreground px-3 py-3">
              No runs match these filters.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function DayRows({
  g,
  cols,
  stages,
  states,
  tag,
  shared,
  onOpen,
  actions,
}: {
  g: RunGroup
  cols: React.CSSProperties
  stages: Stage[]
  states: Map<string, RunState>
  tag: RunTag
  shared: { site: string; crop: string }
  onOpen: (run: Run, step?: string) => void
  actions?: (run: Run) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const processing = g.lines.flatMap((l) => l.runs)
  const single = processing.length === 1 ? processing[0].run : null
  // The crop (population) always; the site only when the days differ in it.
  const name = [g.crop || "—", !shared.site && g.site]
    .filter(Boolean)
    .join(" · ")
  return (
    <>
      <div
        className="hover:bg-muted/40 grid items-center gap-x-1 border-b px-2 py-0.5"
        style={cols}
        data-testid="run-grid-row"
      >
        {single ? (
          <span />
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Hide this day's runs" : "Show this day's runs"}
          >
            {open ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
        )}
        <button
          type="button"
          className="text-left tabular-nums hover:underline"
          onClick={() => (single ? onOpen(single) : setOpen((v) => !v))}
        >
          {g.date}
        </button>
        <span className="flex min-w-0 items-center gap-1 truncate" title={name}>
          <span className="truncate">{name}</span>
          {!single && (
            <span className="text-muted-foreground shrink-0">
              · {processing.length} runs
            </span>
          )}
          {single && <AgentRunMark run={single} />}
        </span>
        {stages.map((st) =>
          single ? (
            <Cell
              key={st.key}
              stage={st}
              run={single}
              isNext={nextStage(single, stages) === st.key}
              onOpen={onOpen}
            />
          ) : (
            <SummaryCell
              key={st.key}
              stage={st}
              runs={processing.map((p) => p.run)}
              onClick={() => setOpen(true)}
            />
          ),
        )}
        <span
          className={`truncate rounded px-1.5 py-0.5 ${TAG_CLASS[tag]}`}
          title={`${TAG_HINT[tag]}${single ? `\n${states.get(single.id)?.detail ?? ""}` : ""}`}
          data-testid="run-grid-status"
        >
          {single
            ? shortStatus(states.get(single.id), tag, stages)
            : TAG_LABEL[tag]}
        </span>
        <span>{single && actions?.(single)}</span>
      </div>
      {open &&
        !single &&
        g.lines.flatMap((line) =>
          line.runs.map(({ run, sensor, treatments, with: others }) => (
            <div
              key={run.id}
              className="bg-muted/20 grid items-center gap-x-1 border-b px-2 py-0.5"
              style={cols}
              data-testid="run-grid-subrow"
            >
              <span />
              <span />
              <button
                type="button"
                className="truncate text-left hover:underline"
                onClick={() => onOpen(run)}
                title={line.title}
              >
                {[
                  line.title,
                  [sensor, ...others.map((o) => o.sensor)].join(" + "),
                  treatments.join(" + "),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </button>
              {stages.map((st) => (
                <Cell
                  key={st.key}
                  stage={st}
                  run={run}
                  isNext={nextStage(run, stages) === st.key}
                  onOpen={onOpen}
                />
              ))}
              <span
                className={`truncate rounded px-1.5 py-0.5 ${TAG_CLASS[states.get(run.id)?.tag ?? "new"]}`}
              >
                {shortStatus(
                  states.get(run.id),
                  states.get(run.id)?.tag ?? "new",
                  stages,
                )}
              </span>
              <span>{actions?.(run)}</span>
            </div>
          )),
        )}
    </>
  )
}

/** A few words for the status column, with the grid's short stage names
 *  ("Next: Bounds"); the full detail is on hover. */
function shortStatus(
  st: RunState | undefined,
  tag: RunTag,
  stages: Stage[],
): string {
  if (!st) return TAG_LABEL[tag]
  if (st.tag === "complete") return "Done"
  let d = st.detail
  for (const x of stages) d = d.replace(x.label, x.short)
  return d.replace("Inference", "Models")
}

function Cell({
  stage,
  run,
  isNext,
  onOpen,
}: {
  stage: Stage
  run: Run
  isNext: boolean
  onOpen: (run: Run, step?: string) => void
}) {
  const status = run.steps[stage.key]?.status ?? "pending"
  const look =
    status === "completed"
      ? "bg-green-500/15 text-green-700 dark:text-green-400"
      : status === "running"
        ? "bg-blue-500/15 text-blue-700 dark:text-blue-300"
        : status === "failed"
          ? "bg-red-500/15 text-red-700 dark:text-red-300"
          : isNext
            ? "ring-1 ring-amber-500 text-amber-700 dark:text-amber-300"
            : "text-muted-foreground/50"
  return (
    <button
      type="button"
      onClick={() => onOpen(run, stage.key)}
      className={`mx-auto flex h-6 w-full max-w-12 min-w-0 items-center justify-center rounded hover:ring-1 hover:ring-foreground/30 ${look}`}
      title={`${stage.label}${stage.optional ? " (optional)" : ""}: ${
        status === "pending" ? (isNext ? "next" : "to do") : status
      }. Click to open.`}
      data-testid={`run-cell-${stage.key}`}
    >
      {status === "completed" ? (
        <Check className="size-3.5" />
      ) : status === "running" ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : status === "failed" ? (
        <X className="size-3.5" />
      ) : status === "skipped" ? (
        <Minus className="size-3.5" />
      ) : isNext ? (
        <span className="text-[10px] font-medium">next</span>
      ) : (
        <span className="size-1.5 rounded-full bg-current" />
      )}
    </button>
  )
}

function SummaryCell({
  stage,
  runs,
  onClick,
}: {
  stage: Stage
  runs: Run[]
  onClick: () => void
}) {
  const st = runs.map((r) => r.steps[stage.key]?.status ?? "pending")
  const done = st.filter((s) => DONE.has(s)).length
  const failed = st.includes("failed")
  const running = st.includes("running")
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mx-auto flex h-6 w-full max-w-14 items-center justify-center rounded text-[11px] tabular-nums ${
        failed
          ? "bg-red-500/15 text-red-700 dark:text-red-300"
          : running
            ? "bg-blue-500/15 text-blue-700 dark:text-blue-300"
            : done === runs.length
              ? "bg-green-500/15 text-green-700 dark:text-green-400"
              : done
                ? "bg-green-500/5 text-foreground"
                : "text-muted-foreground/60"
      }`}
      title={`${stage.label}: done on ${done} of ${runs.length} runs of this day`}
    >
      {done}/{runs.length}
    </button>
  )
}
