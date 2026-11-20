/**
 * Phase 9e step 3 (only when germplasm columns are ambiguous): walk the
 * unique germplasm names mapped from accession/line/alias columns,
 * resolve them against the backend, and let the user decide what to do
 * with each unresolved row (create as accession, create as line, link to
 * existing, or skip). Bulk actions cover the common case where every
 * unresolved row should be treated identically.
 *
 * Ported from `backend/gemini-ui/src/components/import-wizard/step-germplasm-
 * review.tsx`. Adapted to:
 *   - our SDK (`AccessionsService`, `LinesService`, `GermplasmService`)
 *   - `resolveGermplasmNames` (chunked + concurrent) from
 *     `lib/germplasmResolve.ts`
 *   - the pure helpers `collectGermplasmNames` +
 *     `collectPopulationForGermplasm` from `lib/germplasmCollect.ts`
 *
 * Per-row decision pickers use native <select> (same as gemini-ui) — the
 * Radix Select's portal interaction is awkward inside a row-dense table
 * and adds nothing here.
 */
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import {
  type AccessionOutput,
  AccessionsService,
  type AliasBulkEntry,
  GermplasmService,
  type LineOutput,
  LinesService,
  type ResolveResultOutput,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  collectGermplasmNames,
  collectPopulationForGermplasm,
} from "@/features/import/lib/germplasmCollect"
import {
  normalizeGermplasmName,
  resolveGermplasmNames,
} from "@/features/import/lib/germplasmResolve"
import type {
  ColumnMapping,
  GermplasmReview,
  ImportMetadata,
} from "@/features/import/lib/types"

interface StepGermplasmReviewProps {
  mapping: ColumnMapping
  metadata: ImportMetadata
  initial: GermplasmReview | null
  onNext: (review: GermplasmReview) => void
  onBack: () => void
}

type DecisionKind =
  | "skip"
  | "create_accession"
  | "create_line"
  | "link_accession"
  | "link_line"

interface Decision {
  kind: DecisionKind
  newName: string
  linkId: string
  linkName: string
  recordAsAlias: boolean
}

function defaultDecision(): Decision {
  return {
    kind: "create_accession",
    newName: "",
    linkId: "",
    linkName: "",
    recordAsAlias: true,
  }
}

function seedDecision(result: ResolveResultOutput): Decision {
  const d = defaultDecision()
  if (result.match_kind === "unresolved") {
    d.kind = "create_accession"
    d.newName = result.input_name
    d.recordAsAlias = false
  }
  return d
}

function kindSummary(r: ResolveResultOutput): string {
  switch (r.match_kind) {
    case "accession_exact":
      return "Accession (exact match)"
    case "line_exact":
      return "Line (exact match)"
    case "alias_experiment":
      return "Alias (this experiment)"
    case "alias_global":
      return "Alias (global)"
    case "unresolved":
      return "Unresolved"
    default:
      return r.match_kind
  }
}

function kindBadgeVariant(
  kind: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (kind === "unresolved") return "destructive"
  if (kind.startsWith("alias")) return "secondary"
  return "default"
}

const UNRESOLVED_DISPLAY_LIMIT = 100
const CREATE_CONCURRENCY = 8

export function StepGermplasmReview({
  mapping,
  metadata,
  initial,
  onNext,
  onBack,
}: StepGermplasmReviewProps) {
  const names = useMemo(
    () => initial?.allNames ?? collectGermplasmNames(mapping),
    [mapping, initial],
  )
  const populationByGermplasm = useMemo(
    () => collectPopulationForGermplasm(mapping),
    [mapping],
  )
  const experimentId = metadata.experimentId || null

  const [phase, setPhase] = useState<"resolving" | "error" | "ready">(
    names.length === 0 ? "ready" : "resolving",
  )
  const [results, setResults] = useState<ResolveResultOutput[]>([])
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitProgress, setSubmitProgress] = useState<{
    done: number
    total: number
  } | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [accessionOptions, setAccessionOptions] = useState<
    { id: string; name: string }[]
  >([])
  const [lineOptions, setLineOptions] = useState<
    { id: string; name: string }[]
  >([])

  // Resolve names + load accession/line picker options on mount.
  useEffect(() => {
    if (names.length === 0) {
      setPhase("ready")
      return
    }
    let cancelled = false
    setPhase("resolving")
    resolveGermplasmNames(names, { experimentId })
      .then((res) => {
        if (cancelled) return
        setResults(res)
        setPhase("ready")
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setResolveError(err instanceof Error ? err.message : String(err))
        setPhase("error")
      })

    void AccessionsService.apiAccessionsAllGetAllAccessions({
      limit: 500,
      offset: 0,
    })
      .then((rows) => {
        if (cancelled) return
        const list = (rows as AccessionOutput[] | null) ?? []
        setAccessionOptions(
          list
            .filter((a) => a.accession_name && a.id != null)
            .map((a) => ({
              id: String(a.id),
              name: a.accession_name as string,
            })),
        )
      })
      .catch(() => {
        // Best-effort — picker just stays empty.
      })
    void LinesService.apiLinesAllGetAllLines({ limit: 500, offset: 0 })
      .then((rows) => {
        if (cancelled) return
        const list = (rows as LineOutput[] | null) ?? []
        setLineOptions(
          list
            .filter((l) => l.line_name && l.id != null)
            .map((l) => ({
              id: String(l.id),
              name: l.line_name as string,
            })),
        )
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [names, experimentId])

  // Seed decisions whenever new resolver output lands. Don't overwrite
  // user edits if the user has already touched a row.
  useEffect(() => {
    if (results.length === 0) return
    setDecisions((prev) => {
      const next = { ...prev }
      for (const r of results) {
        if (r.match_kind !== "unresolved") continue
        if (!next[r.input_name]) next[r.input_name] = seedDecision(r)
      }
      return next
    })
  }, [results])

  const resolvedCount = results.filter(
    (r) => r.match_kind !== "unresolved",
  ).length
  const unresolved = useMemo(
    () => results.filter((r) => r.match_kind === "unresolved"),
    [results],
  )
  const displayedUnresolved = unresolved.slice(0, UNRESOLVED_DISPLAY_LIMIT)
  const hiddenUnresolvedCount = Math.max(
    0,
    unresolved.length - UNRESOLVED_DISPLAY_LIMIT,
  )

  const setDecision = (inputName: string, patch: Partial<Decision>) => {
    setDecisions((prev) => ({
      ...prev,
      [inputName]: { ...(prev[inputName] ?? defaultDecision()), ...patch },
    }))
  }

  const applyBulk = (kind: "create_accession" | "create_line" | "skip") => {
    setDecisions((prev) => {
      const next = { ...prev }
      for (const r of unresolved) {
        const existing = next[r.input_name] ?? defaultDecision()
        if (kind === "skip") {
          next[r.input_name] = { ...existing, kind: "skip" }
        } else {
          next[r.input_name] = {
            ...existing,
            kind,
            newName: r.input_name,
            recordAsAlias: false,
          }
        }
      }
      return next
    })
  }

  const allDecided = useMemo(() => {
    for (const r of unresolved) {
      const d = decisions[r.input_name]
      if (!d) return false
      if (d.kind === "skip") continue
      if (d.kind === "create_accession" || d.kind === "create_line") {
        if (!d.newName.trim()) return false
      } else if (d.kind === "link_accession" || d.kind === "link_line") {
        if (!d.linkId) return false
      }
    }
    return true
  }, [unresolved, decisions])

  async function handleContinue() {
    if (submitting) return
    setSubmitError(null)

    const aliasEntries: AliasBulkEntry[] = []
    const resolvedMap: GermplasmReview["resolved"] = {}
    for (const r of results) {
      if (r.match_kind !== "unresolved") {
        resolvedMap[r.input_name] = {
          match_kind: r.match_kind,
          accession_id: r.accession_id ?? null,
          line_id: r.line_id ?? null,
          canonical_name: r.canonical_name ?? null,
        }
      }
    }

    setSubmitting(true)
    setSubmitProgress({ done: 0, total: unresolved.length })

    try {
      const resolvedEntries: Array<
        [string, GermplasmReview["resolved"][string]]
      > = []
      const localAliasEntries: AliasBulkEntry[] = []

      const processOne = async (r: ResolveResultOutput) => {
        const d = decisions[r.input_name]
        if (!d || d.kind === "skip") {
          resolvedEntries.push([
            r.input_name,
            { match_kind: "unresolved", canonical_name: null },
          ])
          return
        }
        if (d.kind === "create_accession") {
          const canonicalName = normalizeGermplasmName(d.newName)
          const popName =
            populationByGermplasm.get(canonicalName) ??
            populationByGermplasm.get(normalizeGermplasmName(r.input_name))
          const created = (await AccessionsService.apiAccessionsCreateAccession(
            {
              requestBody: {
                accession_name: canonicalName,
                ...(popName ? { population_name: popName } : {}),
              },
            },
          )) as AccessionOutput
          resolvedEntries.push([
            r.input_name,
            {
              match_kind: "accession_exact",
              accession_id: String(created.id ?? ""),
              canonical_name: (created.accession_name as string) ?? d.newName,
            },
          ])
          if (
            d.recordAsAlias &&
            normalizeGermplasmName(r.input_name) !==
              normalizeGermplasmName(d.newName)
          ) {
            localAliasEntries.push({
              alias: r.input_name,
              accession_name: (created.accession_name as string) ?? d.newName,
              source: "wizard:review",
            })
          }
        } else if (d.kind === "create_line") {
          const canonicalName = normalizeGermplasmName(d.newName)
          const created = (await LinesService.apiLinesCreateLine({
            requestBody: { line_name: canonicalName },
          })) as LineOutput
          // Mirror gemini-ui: also create a matching accession so plots
          // (which FK to Accession, not Line) and the cascade-delete path
          // (experiment → population → accession) can reach it.
          const popName =
            populationByGermplasm.get(canonicalName) ??
            populationByGermplasm.get(normalizeGermplasmName(r.input_name))
          await AccessionsService.apiAccessionsCreateAccession({
            requestBody: {
              accession_name: canonicalName,
              line_name: canonicalName,
              ...(popName ? { population_name: popName } : {}),
            },
          })
          resolvedEntries.push([
            r.input_name,
            {
              match_kind: "line_exact",
              line_id: String(created.id ?? ""),
              canonical_name: (created.line_name as string) ?? d.newName,
            },
          ])
          if (
            d.recordAsAlias &&
            normalizeGermplasmName(r.input_name) !==
              normalizeGermplasmName(d.newName)
          ) {
            localAliasEntries.push({
              alias: r.input_name,
              line_name: (created.line_name as string) ?? d.newName,
              source: "wizard:review",
            })
          }
        } else if (d.kind === "link_accession") {
          resolvedEntries.push([
            r.input_name,
            {
              match_kind: "alias_experiment",
              accession_id: d.linkId,
              canonical_name: d.linkName,
            },
          ])
          if (d.recordAsAlias) {
            localAliasEntries.push({
              alias: r.input_name,
              accession_name: d.linkName,
              source: "wizard:review",
            })
          }
        } else if (d.kind === "link_line") {
          resolvedEntries.push([
            r.input_name,
            {
              match_kind: "alias_experiment",
              line_id: d.linkId,
              canonical_name: d.linkName,
            },
          ])
          if (d.recordAsAlias) {
            localAliasEntries.push({
              alias: r.input_name,
              line_name: d.linkName,
              source: "wizard:review",
            })
          }
        }
      }

      let cursor = 0
      let done = 0
      const pump = async () => {
        while (cursor < unresolved.length) {
          const i = cursor++
          await processOne(unresolved[i])
          done++
          setSubmitProgress({ done, total: unresolved.length })
        }
      }
      await Promise.all(
        Array.from(
          { length: Math.min(CREATE_CONCURRENCY, unresolved.length) },
          () => pump(),
        ),
      )

      for (const [k, v] of resolvedEntries) resolvedMap[k] = v
      aliasEntries.push(...localAliasEntries)

      if (aliasEntries.length > 0) {
        const scope: "global" | "experiment" = experimentId
          ? "experiment"
          : "global"
        const resp = await GermplasmService.apiGermplasmAliasesBulkBulkAliases({
          requestBody: {
            scope,
            experiment_id: scope === "experiment" ? experimentId : null,
            entries: aliasEntries,
          },
        })
        if (resp.errors && resp.errors.length > 0) {
          const first = resp.errors[0]
          setSubmitError(
            `Some aliases were not saved (${resp.errors.length} conflict${resp.errors.length > 1 ? "s" : ""}). ` +
              `First: ${first.alias}: ${first.reason}`,
          )
        }
      }

      onNext({ allNames: names, resolved: resolvedMap })
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  // Degenerate case: no germplasm columns mapped.
  if (names.length === 0) {
    return (
      <div className="space-y-6" data-testid="step-germplasm-review">
        <div className="text-muted-foreground rounded-md border p-4 text-sm">
          No germplasm columns were mapped — nothing to review. Click Continue
          to proceed.
        </div>
        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button
            onClick={() => onNext({ allNames: [], resolved: {} })}
            data-testid="germplasm-review-continue"
          >
            Continue to Upload
          </Button>
        </div>
      </div>
    )
  }

  if (phase === "resolving") {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 py-12"
        data-testid="germplasm-review-resolving"
      >
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <p className="text-muted-foreground text-sm">
          Resolving {names.length} germplasm name
          {names.length === 1 ? "" : "s"}…
        </p>
      </div>
    )
  }

  if (phase === "error") {
    return (
      <div className="space-y-6" data-testid="germplasm-review-error">
        <div className="border-destructive/50 bg-destructive/5 rounded-md border p-4">
          <p className="text-destructive text-sm">
            Failed to resolve germplasm names: {resolveError}
          </p>
        </div>
        <div className="flex justify-between">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6" data-testid="step-germplasm-review">
      <div className="flex items-center gap-3 rounded-lg border p-4">
        {unresolved.length === 0 ? (
          <>
            <CheckCircle2 className="text-primary h-5 w-5" />
            <div className="text-sm">
              <span className="font-medium">
                All {names.length} germplasm name
                {names.length === 1 ? "" : "s"} resolved.
              </span>{" "}
              <span className="text-muted-foreground">
                Nothing to review — click Continue to upload.
              </span>
            </div>
          </>
        ) : (
          <>
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <div className="text-sm">
              <span className="font-medium">
                {resolvedCount} / {names.length} resolved.
              </span>{" "}
              <span className="text-muted-foreground">
                {unresolved.length} need
                {unresolved.length === 1 ? "s" : ""} a decision below.
              </span>
            </div>
          </>
        )}
      </div>

      {unresolved.length > 0 && (
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="font-medium">Unresolved germplasm</h3>
          <p className="text-muted-foreground text-sm">
            For each name below, choose how it should be resolved. Creating a
            new entity makes a canonical record; linking attaches the
            spreadsheet value as an alias for an existing accession or line. By
            default every unresolved row is set to "Create new accession" with
            the spreadsheet value as the canonical name — fine for a fresh
            database where the sheet holds the authoritative names.
          </p>
          <div className="flex flex-wrap items-center gap-2 border-b pb-3">
            <span className="mr-1 text-sm font-medium">
              Apply to all {unresolved.length}:
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => applyBulk("create_accession")}
              data-testid="bulk-create-accession"
            >
              Create as accessions
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => applyBulk("create_line")}
              data-testid="bulk-create-line"
            >
              Create as lines
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => applyBulk("skip")}
              data-testid="bulk-skip"
            >
              Skip all
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-48">Spreadsheet value</TableHead>
                <TableHead className="w-48">Action</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="w-36">Save as alias?</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedUnresolved.map((r) => {
                const d = decisions[r.input_name] ?? defaultDecision()
                return (
                  <TableRow key={r.input_name}>
                    <TableCell className="font-mono text-sm">
                      {r.input_name}
                    </TableCell>
                    <TableCell>
                      <select
                        value={d.kind}
                        onChange={(e) =>
                          setDecision(r.input_name, {
                            kind: e.target.value as DecisionKind,
                          })
                        }
                        className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
                        data-testid={`decision-kind-${r.input_name}`}
                      >
                        <option value="create_accession">
                          Create new accession
                        </option>
                        <option value="create_line">Create new line</option>
                        <option value="link_accession">
                          Link to existing accession
                        </option>
                        <option value="link_line">Link to existing line</option>
                        <option value="skip">Skip (leave unresolved)</option>
                      </select>
                    </TableCell>
                    <TableCell>
                      {(d.kind === "create_accession" ||
                        d.kind === "create_line") && (
                        <Input
                          value={d.newName}
                          onChange={(e) =>
                            setDecision(r.input_name, {
                              newName: e.target.value,
                            })
                          }
                          placeholder="Canonical name"
                          data-testid={`decision-newname-${r.input_name}`}
                        />
                      )}
                      {d.kind === "link_accession" && (
                        <select
                          value={d.linkId}
                          onChange={(e) => {
                            const opt = accessionOptions.find(
                              (o) => o.id === e.target.value,
                            )
                            setDecision(r.input_name, {
                              linkId: e.target.value,
                              linkName: opt?.name ?? "",
                            })
                          }}
                          className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
                          data-testid={`decision-linkacc-${r.input_name}`}
                        >
                          <option value="">-- Select accession --</option>
                          {accessionOptions.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {d.kind === "link_line" && (
                        <select
                          value={d.linkId}
                          onChange={(e) => {
                            const opt = lineOptions.find(
                              (o) => o.id === e.target.value,
                            )
                            setDecision(r.input_name, {
                              linkId: e.target.value,
                              linkName: opt?.name ?? "",
                            })
                          }}
                          className="border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs"
                          data-testid={`decision-linkline-${r.input_name}`}
                        >
                          <option value="">-- Select line --</option>
                          {lineOptions.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {d.kind === "skip" && (
                        <span className="text-muted-foreground text-xs">
                          Rows referencing this will import without a germplasm
                          link.
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {d.kind !== "skip" && (
                        <Label
                          htmlFor={`alias-cb-${r.input_name}`}
                          className="flex cursor-pointer items-center gap-2 text-sm"
                        >
                          <input
                            id={`alias-cb-${r.input_name}`}
                            type="checkbox"
                            checked={d.recordAsAlias}
                            onChange={(e) =>
                              setDecision(r.input_name, {
                                recordAsAlias: e.target.checked,
                              })
                            }
                            className="accent-primary h-4 w-4"
                            data-testid={`decision-alias-${r.input_name}`}
                          />
                          {experimentId ? "In this experiment" : "Globally"}
                        </Label>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {hiddenUnresolvedCount > 0 && (
            <p className="text-muted-foreground text-xs">
              Showing {displayedUnresolved.length} of {unresolved.length}{" "}
              unresolved values. The remaining {hiddenUnresolvedCount} will use
              whatever bulk default you apply above.
            </p>
          )}
        </div>
      )}

      {resolvedCount > 0 && (
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer font-medium">
            Resolved ({resolvedCount})
          </summary>
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Spreadsheet value</TableHead>
                  <TableHead>Canonical name</TableHead>
                  <TableHead>How</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results
                  .filter((r) => r.match_kind !== "unresolved")
                  .map((r) => (
                    <TableRow key={r.input_name}>
                      <TableCell className="font-mono text-sm">
                        {r.input_name}
                      </TableCell>
                      <TableCell>{r.canonical_name ?? "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant={kindBadgeVariant(r.match_kind)}
                          className="text-[10px]"
                        >
                          {kindSummary(r)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </details>
      )}

      {submitError && (
        <div className="border-destructive/50 bg-destructive/5 text-destructive rounded-md border p-3 text-sm">
          {submitError}
        </div>
      )}

      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={submitting}
          data-testid="germplasm-review-back"
        >
          Back
        </Button>
        <Button
          onClick={handleContinue}
          disabled={submitting || !allDecided}
          data-testid="germplasm-review-continue"
        >
          {submitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {submitting && submitProgress
            ? `Creating germplasm (${submitProgress.done}/${submitProgress.total})…`
            : "Continue to Upload"}
        </Button>
      </div>
    </div>
  )
}
