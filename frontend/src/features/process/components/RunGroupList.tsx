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
  type RunTag,
  runState,
  TAG_CLASS,
  TAG_HINT,
  TAG_LABEL,
} from "@/features/process/lib/runStatus"
import type { Run } from "@/features/process/lib/runStore"
import { AgentRunMark } from "./AgentRunMark"

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
  const groups = useMemo(() => groupRuns(runs, labels), [runs, labels])
  return (
    <div className="space-y-1" data-testid="run-groups">
      {groups.map((g) => (
        <GroupRow
          key={g.key}
          g={g}
          typeOf={typeOf}
          onOpen={onOpen}
          actions={actions}
          showDate={showDate}
        />
      ))}
    </div>
  )
}

function worst(tags: RunTag[]): RunTag {
  return ((TAG_PRIORITY as readonly string[]).find((t) =>
    tags.includes(t as RunTag),
  ) ?? "new") as RunTag
}

function GroupRow({
  g,
  typeOf,
  onOpen,
  actions,
  showDate,
}: {
  g: RunGroup
  typeOf: (run: Run) => "aerial" | "ground"
  onOpen: (run: Run) => void
  actions?: (run: Run) => ReactNode
  showDate: boolean
}) {
  const { queuedJobIds } = useProcess()
  const [open, setOpen] = useState(false)
  const states = new Map(
    g.runs.map((r) => [r.id, runState(r, typeOf(r), queuedJobIds)]),
  )
  // Another camera's run folded into an RGB run waits for nothing (its frames are
  // used by the RGB run): it counts only once its own orthomosaic is under way.
  const folded = new Set(
    g.lines.flatMap((l) => l.runs.flatMap((r) => r.with.map((w) => w.run.id))),
  )
  const tag = worst(
    [...states.entries()]
      .filter(
        ([id, st]) =>
          !folded.has(id) || ["running", "queued", "failed"].includes(st.tag),
      )
      .map(([, st]) => st.tag),
  )
  // Runs to process: other cameras' runs folded into an RGB run are not counted.
  const processing = g.lines.flatMap((l) => l.runs)
  const single = processing.length === 1 ? processing[0].run : null
  const singleWith = single ? processing[0].with.map((w) => w.sensor) : []
  const type = typeOf(g.runs[0])
  const Icon = type === "ground" ? Navigation : Plane
  const timesOfDay = g.lines.filter((l) => l.key).length
  const summary = single
    ? (states.get(single.id)?.detail ?? "")
    : [
        `${processing.length} runs`,
        timesOfDay > 0 && `${timesOfDay + 1} times of day`,
        g.treatments.length > 1 && g.treatments.join(" / "),
      ]
        .filter(Boolean)
        .join(" · ")

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
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{g.title}</span>
            {single && <AgentRunMark run={single} />}
            {singleWith.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                (one run, {singleWith.join(" and ")} frames with the RGB)
              </span>
            )}
          </span>
          <span className="flex shrink-0 gap-1">
            {g.sensors.map((s) => (
              <span
                key={s}
                className="rounded border px-1.5 text-[11px] text-muted-foreground"
              >
                {s}
              </span>
            ))}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {summary}
          </span>
          <Badge
            variant="secondary"
            className={TAG_CLASS[tag]}
            title={TAG_HINT[tag]}
          >
            {TAG_LABEL[tag]}
          </Badge>
        </button>
        {single && actions?.(single)}
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
