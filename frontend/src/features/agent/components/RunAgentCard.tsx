/**
 * RunAgentCard — on a Process run: what the agent would do next, what it
 * needs from you, and a button to let it carry on.
 *
 * "What it needs" is a short form of facts only a person knows (the field
 * design file, which way the field lies, where the rover started). They are
 * stored for the run, so the agent fills its calls from them instead of
 * asking in chat. Renders nothing when the agent service is not there.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Bot, ListChecks, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { agentApi, queueAgentRequest } from "@/features/agent/lib/agentApi"
import { setHomePrefs, useAgentEnabled } from "@/lib/homePrefs"

type Facts = Record<string, unknown>
type Field =
  | { key: string; label: string; hint?: string; kind: "text" | "number" }
  | { key: string; label: string; hint?: string; options: string[] }

const SIDES = ["north", "south", "east", "west"]
const AERIAL: Field[] = [
  {
    key: "design_path",
    label: "Field design file",
    kind: "text",
  },
  {
    key: "first_tier_at",
    label: "First tier of the design is at the field's",
    options: SIDES,
  },
  { key: "first_bed_at", label: "First bed is on the", options: SIDES },
  {
    key: "beds",
    label: "Beds in this flight",
    hint: "e.g. 2,3,4,5,6. Empty: all beds of the design",
    kind: "text",
  },
]
const GROUND: Field[] = [
  {
    key: "design_path",
    label: "Field design file",
    hint: "Empty if there is none yet",
    kind: "text",
  },
  { key: "plots_per_bed", label: "Plots per bed", kind: "number" },
  {
    key: "border_plots",
    label: "Border plots at each end of a bed",
    kind: "number",
  },
  {
    key: "gps_reliable",
    label: "Rover GPS can be trusted",
    options: ["yes", "no"],
  },
  {
    key: "start_corner",
    label: "Rover started at the field's corner",
    hint: "Needed when GPS cannot be trusted",
    options: ["south-west", "south-east", "north-west", "north-east"],
  },
  {
    key: "pass_axis",
    label: "Beds run",
    options: ["north-south", "east-west"],
  },
  {
    key: "rows_per_pass",
    label: "Crop rows in one image",
    options: ["1", "2"],
  },
]
const UNSET = "__unset__"

/** Form text for a stored fact. */
function shown(key: string, v: unknown): string {
  if (v === undefined || v === null) return ""
  if (key === "gps_reliable") return v ? "yes" : "no"
  if (Array.isArray(v)) return v.join(",")
  return String(v)
}

/** A stored fact from form text ("" clears it). */
function stored(key: string, text: string): unknown {
  const t = text.trim()
  if (!t) return null
  if (key === "gps_reliable") return t === "yes"
  if (key === "beds")
    return t
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n))
  if (["plots_per_bed", "border_plots", "rows_per_pass"].includes(key))
    return Number(t)
  return t
}

export function RunAgentCard({
  runId,
  kind,
}: {
  runId: string
  kind: "aerial" | "ground"
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const agentOn = useAgentEnabled()
  const fields = kind === "ground" ? GROUND : AERIAL
  const next = useQuery({
    queryKey: ["agent", "next_step", runId],
    queryFn: () => agentApi.nextStep(runId),
    retry: false,
    refetchInterval: 30_000,
  })
  const facts = useQuery({
    queryKey: ["agent", "facts", runId],
    queryFn: () => agentApi.facts(runId),
    retry: false,
  })
  const [draft, setDraft] = useState<Record<string, string>>({})
  // null: not toggled yet; the form then shows while facts are still missing,
  // so they are given once, up front, rather than at whichever step stops.
  // Closing it is remembered for this run, so it does not open again.
  const closedKey = `gemi.runFacts.closed.${runId}`
  const [toggled, setToggled] = useState<boolean | null>(() => {
    try {
      return localStorage.getItem(closedKey) === "1" ? false : null
    } catch {
      return null
    }
  })
  const setOpen = (v: boolean) => {
    setToggled(v)
    try {
      if (v) localStorage.removeItem(closedKey)
      else localStorage.setItem(closedKey, "1")
    } catch {
      // no storage: it stays closed for this visit
    }
  }
  const designs = useQuery({
    queryKey: ["agent", "field_designs", runId],
    queryFn: () => agentApi.fieldDesigns(runId),
    retry: false,
  })
  const pickDesign = useMutation({
    mutationFn: async (file: File) => {
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result).split(",", 2)[1] ?? "")
        r.onerror = () => reject(r.error)
        r.readAsDataURL(file)
      })
      return agentApi.saveFieldDesign(file.name, b64)
    },
    onSuccess: (r) => {
      setDraft((d) => ({ ...d, design_path: r.path }))
      queryClient.invalidateQueries({
        queryKey: ["agent", "field_designs", runId],
      })
    },
  })
  useEffect(() => {
    if (!facts.data) return
    const f: Facts = facts.data.facts
    setDraft(
      Object.fromEntries(
        [...fields, { key: "notes" }].map((x) => [
          x.key,
          shown(x.key, f[x.key]),
        ]),
      ),
    )
  }, [facts.data, fields])
  // The design another run of this field uses, when this one has none yet.
  const suggested = designs.data?.suggested ?? null
  useEffect(() => {
    if (!facts.data || !suggested) return
    const f: Facts = facts.data.facts
    if (!f.design_path)
      setDraft((d) =>
        d.design_path ? d : { ...d, design_path: suggested.path },
      )
  }, [facts.data, suggested])
  const save = useMutation({
    mutationFn: () =>
      agentApi.saveFacts(
        runId,
        Object.fromEntries(
          Object.entries(draft).map(([k, v]) => [k, stored(k, v)]),
        ),
      ),
    onSuccess: (r) => {
      queryClient.setQueryData(["agent", "facts", runId], r)
      queryClient.invalidateQueries({ queryKey: ["agent", "next_step", runId] })
    },
  })

  // No agent service (or not signed in to it): the page is as it was.
  if (next.isError || facts.isError) return null
  const row = next.data?.runs?.[0]
  if (!row) return null
  const needs = row.ask_person_first ?? []
  const open =
    toggled ??
    (row.state !== "all steps done" &&
      (needs.length > 0 ||
        Object.values(facts.data?.facts ?? {}).every((v) => v == null)))
  const finished = row.state === "all steps done"
  const set = (key: string, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }))
  const dirty =
    facts.data !== undefined &&
    Object.entries(draft).some(
      ([k, v]) => v !== shown(k, (facts.data.facts as Facts)[k]),
    )

  return (
    <Card data-testid="run-agent-card">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          {agentOn ? (
            <Bot className="text-muted-foreground h-4 w-4 shrink-0" />
          ) : (
            <ListChecks className="text-muted-foreground h-4 w-4 shrink-0" />
          )}
          <div className="min-w-0 flex-1 text-sm">
            {finished ? (
              <span>Every step of this run is done.</span>
            ) : (
              <>
                <span className="font-medium">Next: {row.step}</span>
                <span className="text-muted-foreground">
                  {row.state === "running"
                    ? " · running now"
                    : row.state === "failed"
                      ? " · failed"
                      : needs.length > 0
                        ? " · needs something from you first"
                        : agentOn
                          ? " · the agent can do this"
                          : " · ready"}
                </span>
              </>
            )}
            {row.state === "failed" && row.error && (
              <p className="mt-1 text-xs text-red-700 dark:text-red-400">
                {row.error}
              </p>
            )}
            {needs.length > 0 && (
              <ul className="text-muted-foreground mt-1 list-disc pl-5 text-xs">
                {needs.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => setOpen(!open)}>
            {open ? "Hide field facts" : "Field facts"}
          </Button>
          {!finished && agentOn && (
            <Button
              size="sm"
              data-testid="run-continue-with-agent"
              onClick={() => {
                queueAgentRequest(
                  `Continue the run "${row.run}" (id ${runId}): call continue_run for it, and tell me what you did and what you need from me.`,
                )
                setHomePrefs({ view: "agent" })
                navigate({ to: "/" })
              }}
            >
              Continue with agent
            </Button>
          )}
        </div>

        {open && (
          <div className="space-y-3 border-t pt-3" data-testid="run-facts-form">
            <p className="text-muted-foreground text-xs">
              What only you know about this field. The agent uses these instead
              of asking; leave empty what does not apply.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.key} className="grid min-w-0 gap-1">
                  <Label className="text-xs">{f.label}</Label>
                  {f.key === "design_path" ? (
                    <div className="flex min-w-0 items-center gap-2">
                      <Select
                        value={draft.design_path || UNSET}
                        onValueChange={(v) =>
                          set("design_path", v === UNSET ? "" : v)
                        }
                      >
                        <SelectTrigger
                          className="h-8 min-w-0 flex-1 [&>span]:min-w-0 [&>span]:truncate"
                          data-testid="run-fact-design_path"
                          title={
                            draft.design_path
                              ? draft.design_path.split(/[\\/]/).pop()
                              : undefined
                          }
                        >
                          <SelectValue placeholder="No design yet" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNSET}>No design yet</SelectItem>
                          {[
                            ...(designs.data?.files ?? []),
                            ...(draft.design_path &&
                            !(designs.data?.files ?? []).some(
                              (x) => x.path === draft.design_path,
                            )
                              ? [
                                  {
                                    name:
                                      draft.design_path.split(/[\\/]/).pop() ??
                                      draft.design_path,
                                    path: draft.design_path,
                                  },
                                ]
                              : []),
                          ].map((x) => (
                            <SelectItem
                              key={x.path}
                              value={x.path}
                              className="max-w-[min(32rem,90vw)] break-all"
                            >
                              {x.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0"
                        disabled={pickDesign.isPending}
                        onClick={() => {
                          const input = document.createElement("input")
                          input.type = "file"
                          input.accept = ".csv,.xlsx,.xlsm"
                          input.onchange = () => {
                            const file = input.files?.[0]
                            if (file) pickDesign.mutate(file)
                          }
                          input.click()
                        }}
                      >
                        {pickDesign.isPending ? "Adding…" : "Choose file…"}
                      </Button>
                    </div>
                  ) : "options" in f ? (
                    <Select
                      value={draft[f.key] || UNSET}
                      onValueChange={(v) => set(f.key, v === UNSET ? "" : v)}
                    >
                      <SelectTrigger
                        className="h-8"
                        data-testid={`run-fact-${f.key}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNSET}>Not said</SelectItem>
                        {f.options.map((o) => (
                          <SelectItem key={o} value={o}>
                            {o}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      className="h-8"
                      data-testid={`run-fact-${f.key}`}
                      type={f.kind === "number" ? "number" : "text"}
                      value={draft[f.key] ?? ""}
                      onChange={(e) => set(f.key, e.target.value)}
                    />
                  )}
                  {f.key === "design_path" &&
                    suggested &&
                    draft.design_path === suggested.path &&
                    !(facts.data?.facts as Facts | undefined)?.design_path && (
                      <span className="text-[11px] text-sky-700 dark:text-sky-400">
                        The design {suggested.name} of {suggested.from} (same
                        field, same year): Save to use it here.
                      </span>
                    )}
                  {f.hint && (
                    <span className="text-muted-foreground text-[11px]">
                      {f.hint}
                    </span>
                  )}
                </div>
              ))}
              <div className="grid gap-1 sm:col-span-2">
                <Label className="text-xs">Anything else</Label>
                <Input
                  className="h-8"
                  value={draft.notes ?? ""}
                  onChange={(e) => set("notes", e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                disabled={!dirty || save.isPending}
                data-testid="run-facts-save"
                onClick={() => save.mutate()}
              >
                {save.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                Save
              </Button>
              {save.isError && (
                <span className="text-xs text-red-700 dark:text-red-400">
                  {save.error instanceof Error
                    ? save.error.message
                    : "Could not save"}
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
