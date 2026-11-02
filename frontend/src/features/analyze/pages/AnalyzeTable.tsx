/**
 * AnalyzeTable — the master table: one row per plot, one column per trait,
 * for the chosen experiment / season / site (/ population).
 *
 * Replaces three things main had and this branch lost: the Master Table,
 * the Query tab (filter plots by plot / row / column / accession), and CSV
 * export of trait values — until now the only way to get trait data out
 * was a raw GeoJSON per extraction job. Clicking a row opens that plot's
 * image, the same dialog the map uses.
 *
 * Data comes from /api/multivariate_analysis/matrix, which already pivots
 * trait_records long -> wide per plot. Reference data (hand measurements)
 * for the same experiment + site is joined on as extra, orange columns.
 */

import { useQuery } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Download } from "lucide-react"
import { useMemo, useState } from "react"
import { ExperimentsService, type TraitOutput } from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ProcessScopeSelectors,
  useAerialScopeContext,
} from "@/features/process/components/AerialScopePicker"
import { processedPopulationPrefix } from "@/features/process/lib/paths"
import { traitLabel } from "@/lib/traitName"
import { PlotImageDialog } from "../components/PlotImageDialog"
import { usePlotImageListing } from "../hooks/usePlotImageListing"
import { useScopeReference } from "../hooks/useScopeReference"
import {
  matrixKey,
  useScopeDates,
  useTraitsByDate,
} from "../hooks/useTraitsByDate"
import {
  fetchMatrix,
  type MatrixRow,
  type MultivariateRequest,
} from "../lib/multivariate"
import { imageFor, indexSeasonImages, kindLabel } from "../lib/plotSeason"
import { attachReference, isRefColumn } from "../lib/referenceJoin"
import {
  filterRows,
  type SortDir,
  type SortKey,
  sortRows,
  tableCsv,
} from "../lib/traitTable"

function sameKey(a: SortKey, b: SortKey): boolean {
  if (typeof a === "object" && typeof b === "object") return a.trait === b.trait
  return a === b
}

/** How the table treats several flight dates: each date on its own rows
 *  (the default: nothing is averaged unasked), one date, or combined. */
const EACH = "each"
const MEAN = "mean"
const LATEST = "latest"

/** Reference (hand-measured) columns are orange, as they were on main. */
const REF_TEXT = "text-orange-600 dark:text-orange-400"

function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—"
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, "")
}

export function AnalyzeTable() {
  const ctx = useAerialScopeContext()

  const traitsQuery = useQuery({
    queryKey: ["analyze", "table", "traits", ctx.experimentId],
    queryFn: () =>
      ExperimentsService.apiExperimentsIdExperimentIdTraitsGetExperimentTraits({
        experimentId: ctx.experimentId as string,
      }),
    enabled: Boolean(ctx.experimentId),
  })
  const traits = useMemo(
    () =>
      ((traitsQuery.data as TraitOutput[] | null) ?? [])
        .map((t) => t.trait_name ?? "")
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [traitsQuery.data],
  )

  // Unchecked traits, so "all" is the default and new traits appear
  // selected without any bookkeeping.
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const selectedTraits = traits.filter((t) => !excluded.has(t))

  const scopeReady = Boolean(
    ctx.experimentName && ctx.seasonName && ctx.siteName,
  )
  const scopeNames = {
    experiment: ctx.experimentName,
    season: ctx.seasonName,
    site: ctx.siteName,
    population: ctx.populationName,
  }
  const { dates, isLoading: datesLoading } = useScopeDates(scopeNames)
  const [dateMode, setDateMode] = useState<string>(EACH)
  // A single date no longer in the scope (another site picked) falls back.
  const mode =
    dateMode === EACH || dateMode === MEAN || dateMode === LATEST
      ? dateMode
      : dates.includes(dateMode)
        ? dateMode
        : EACH

  const want = scopeReady && selectedTraits.length > 0
  // Each date: one matrix per date, merged into a row per plot per date.
  const eachDate = mode === EACH && dates.length > 0
  const byDate = useTraitsByDate({
    scope: scopeNames,
    traits: selectedTraits,
    dates,
    enabled: want && eachDate,
  })
  const combined = useQuery({
    queryKey: [...matrixKey(scopeNames, selectedTraits), mode],
    queryFn: () => {
      const base = {
        trait_names: selectedTraits,
        experiment_names: [ctx.experimentName as string],
        season_names: [ctx.seasonName as string],
        site_names: [ctx.siteName as string],
        ...(ctx.populationName ? { populations: [ctx.populationName] } : {}),
      }
      const req: MultivariateRequest =
        mode === MEAN || mode === LATEST || mode === EACH
          ? { ...base, aggregation: mode === LATEST ? "latest" : "mean" }
          : { ...base, aggregation: "date", aggregation_date: mode }
      return fetchMatrix(req)
    },
    // "Each date" without dated records shows the plots once rather than
    // nothing.
    enabled: want && !eachDate && !datesLoading,
  })
  const matrixQuery = eachDate ? byDate : combined
  const dated = eachDate

  const [query, setQuery] = useState("")
  // By plot: each plot's dates sit together, earliest first.
  const [sortKey, setSortKey] = useState<SortKey>("plot")
  const [sortDir, setSortDir] = useState<SortDir>("asc")
  const refQuery = useScopeReference({
    experiment: ctx.experimentName,
    location: ctx.siteName,
    population: ctx.populationName,
  })
  const refSources = refQuery.data ?? []
  const [showRef, setShowRef] = useState(true)
  const joined = useMemo(() => {
    const base = matrixQuery.data?.rows ?? []
    return showRef && refSources.length > 0
      ? attachReference(base, refSources)
      : { rows: base, columns: [] as string[] }
  }, [matrixQuery.data, refSources, showRef])
  const allRows: MatrixRow[] = joined.rows
  const shown = useMemo(
    () => sortRows(filterRows(allRows, query), sortKey, sortDir),
    [allRows, query, sortKey, sortDir],
  )
  const columns = [
    ...(matrixQuery.data?.trait_names ?? selectedTraits),
    ...joined.columns,
  ]

  const onSort = (k: SortKey) => {
    if (sameKey(k, sortKey)) setSortDir(sortDir === "asc" ? "desc" : "asc")
    else {
      setSortKey(k)
      setSortDir("asc")
    }
  }

  const [openRow, setOpenRow] = useState<MatrixRow | null>(null)
  // The opened plot's image: its crop's folder (the population picked, else
  // the row's own), on the row's date.
  const imagePop = ctx.populationName || openRow?.population || ""
  const imagesPrefix =
    ctx.seasonName && ctx.experimentName && ctx.siteName && imagePop
      ? processedPopulationPrefix({
          year: ctx.seasonName,
          experiment: ctx.experimentName,
          location: ctx.siteName,
          population: imagePop,
        })
      : null
  const plotImages = usePlotImageListing(openRow ? imagesPrefix : null)
  const openImage = useMemo(() => {
    if (!openRow || openRow.plot_number == null || !plotImages.data) return null
    return imageFor(
      indexSeasonImages(plotImages.data, imagePop),
      String(openRow.plot_number),
      openRow.collection_date,
    )
  }, [openRow, plotImages.data, imagePop])

  const download = () => {
    const url = URL.createObjectURL(
      new Blob([tableCsv(shown, columns)], { type: "text/csv" }),
    )
    try {
      const a = document.createElement("a")
      a.href = url
      a.download = `${ctx.experimentName ?? "traits"}-${ctx.seasonName ?? ""}-${ctx.siteName ?? ""}.csv`
      a.click()
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const header = (label: string, k: SortKey, testid: string) => {
    const active = sameKey(k, sortKey)
    return (
      <th
        key={testid}
        className={`px-2 py-1 text-left whitespace-nowrap ${
          typeof k === "object" && isRefColumn(k.trait) ? REF_TEXT : ""
        }`}
      >
        <button
          type="button"
          className="inline-flex items-center gap-1 font-medium"
          onClick={() => onSort(k)}
          data-testid={testid}
        >
          {label}
          {active &&
            (sortDir === "asc" ? (
              <ArrowUp className="h-3 w-3" />
            ) : (
              <ArrowDown className="h-3 w-3" />
            ))}
        </button>
      </th>
    )
  }

  return (
    <div className="flex flex-col gap-4" data-testid="analyze-table">
      <ProcessScopeSelectors allowAllPopulations />

      {!scopeReady ? (
        <p className="text-muted-foreground text-sm">
          Pick an experiment, season and site to see its plots.
        </p>
      ) : traitsQuery.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading traits…</p>
      ) : traits.length === 0 ? (
        <p
          className="text-muted-foreground text-sm"
          data-testid="analyze-table-no-traits"
        >
          This experiment has no traits yet. Import trait data or run trait
          extraction first.
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Traits</Label>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {traits.map((t, i) => (
                <label
                  key={t}
                  htmlFor={`analyze-table-trait-cb-${i}`}
                  className="flex cursor-pointer items-center gap-1.5 text-sm"
                >
                  <Checkbox
                    id={`analyze-table-trait-cb-${i}`}
                    checked={!excluded.has(t)}
                    onCheckedChange={(c) => {
                      const next = new Set(excluded)
                      if (c) next.delete(t)
                      else next.add(t)
                      setExcluded(next)
                    }}
                    data-testid={`analyze-table-trait-${t}`}
                  />
                  {traitLabel(t)}
                </label>
              ))}
            </div>
            {refSources.length > 0 && (
              <label
                htmlFor="analyze-table-show-ref-cb"
                className={`flex cursor-pointer items-center gap-1.5 text-sm ${REF_TEXT}`}
              >
                <Checkbox
                  id="analyze-table-show-ref-cb"
                  checked={showRef}
                  onCheckedChange={(c) => setShowRef(c === true)}
                  data-testid="analyze-table-show-ref"
                />
                Reference data (
                {refSources.map((r) => r.dataset.name).join(", ")})
              </label>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs" htmlFor="analyze-table-dates">
                Dates
              </Label>
              <Select value={mode} onValueChange={setDateMode}>
                <SelectTrigger
                  id="analyze-table-dates"
                  className="w-56"
                  data-testid="analyze-table-dates"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EACH}>
                    Each date{dates.length ? ` (${dates.length})` : ""}
                  </SelectItem>
                  {dates.map((d) => (
                    <SelectItem key={d} value={d}>
                      Only {d}
                    </SelectItem>
                  ))}
                  <SelectItem value={LATEST}>
                    Latest reading per plot
                  </SelectItem>
                  <SelectItem value={MEAN}>Mean across dates</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-72 flex-1 space-y-1">
              <Label className="text-xs" htmlFor="analyze-table-query">
                Filter plots
              </Label>
              <Input
                id="analyze-table-query"
                data-testid="analyze-table-query"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="plot:12  acc:CB27  date:2022-07  — or any text"
              />
            </div>
            <Button
              variant="outline"
              onClick={download}
              disabled={shown.length === 0}
              data-testid="analyze-table-csv"
            >
              <Download className="mr-1.5 h-4 w-4" />
              Download CSV
            </Button>
          </div>

          {matrixQuery.isError && (
            <p className="text-red-700 text-sm">
              {(matrixQuery.error as Error).message}
            </p>
          )}
          {matrixQuery.data && matrixQuery.data.status !== "ok" && (
            <p
              className="text-amber-800 text-sm"
              data-testid="analyze-table-status"
            >
              {matrixQuery.data.message || matrixQuery.data.status}
              {ctx.populationName &&
                ` Records may not carry population "${ctx.populationName}" — try "All populations".`}
            </p>
          )}

          <p
            className="text-muted-foreground text-xs"
            data-testid="analyze-table-count"
          >
            {matrixQuery.isLoading
              ? "Loading…"
              : dated
                ? `${shown.length} of ${allRows.length} readings · a row per plot per date`
                : `${shown.length} of ${allRows.length} plots${
                    mode === MEAN
                      ? " · each value is the plot's mean across dates"
                      : mode === LATEST
                        ? " · each value is the plot's latest reading"
                        : ""
                  }`}
            {" · click a row for its plot image"}
          </p>

          <div className="max-h-[60vh] overflow-auto rounded border text-xs">
            {/* One line per cell: many trait columns scroll sideways rather
                than squeezing names and values onto several lines. */}
            <table className="w-full min-w-max whitespace-nowrap">
              <thead className="bg-muted sticky top-0">
                <tr>
                  {dated && header("Date", "date", "analyze-table-sort-date")}
                  {header("Plot", "plot", "analyze-table-sort-plot")}
                  {header("Row", "row", "analyze-table-sort-row")}
                  {header("Col", "col", "analyze-table-sort-col")}
                  {header(
                    "Accession",
                    "accession",
                    "analyze-table-sort-accession",
                  )}
                  {columns.map((t) =>
                    header(
                      traitLabel(t),
                      { trait: t },
                      `analyze-table-sort-trait-${t}`,
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr
                    key={`${r.collection_date ?? ""}-${r.plot_id ?? ""}-${r.plot_number}-${r.plot_row_number}-${r.plot_column_number}-${i}`}
                    className="hover:bg-muted/50 cursor-pointer border-t"
                    onClick={() => setOpenRow(r)}
                    data-testid="analyze-table-row"
                  >
                    {dated && (
                      <td className="px-2 py-1 font-mono">
                        {r.collection_date}
                      </td>
                    )}
                    <td className="px-2 py-1">{r.plot_number ?? "—"}</td>
                    <td className="px-2 py-1">{r.plot_row_number ?? "—"}</td>
                    <td className="px-2 py-1">{r.plot_column_number ?? "—"}</td>
                    <td className="px-2 py-1">{r.accession_name ?? "—"}</td>
                    {columns.map((t) => (
                      <td
                        key={t}
                        className={`px-2 py-1 text-right font-mono ${
                          isRefColumn(t) ? REF_TEXT : ""
                        }`}
                      >
                        {fmt(r.values[t])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <PlotImageDialog
        open={openRow !== null}
        onClose={() => setOpenRow(null)}
        plot={openRow?.plot_number ?? null}
        properties={
          openRow
            ? {
                ...(openRow.collection_date
                  ? { date: openRow.collection_date }
                  : {}),
                ...(openImage &&
                (openImage.date !== openRow.collection_date ||
                  openImage.kind !== "ortho")
                  ? {
                      image: `${kindLabel(openImage.kind)}, ${openImage.date}`,
                    }
                  : {}),
                plot: openRow.plot_number,
                row: openRow.plot_row_number,
                col: openRow.plot_column_number,
                accession: openRow.accession_name,
                ...openRow.values,
              }
            : undefined
        }
        objectPath={openImage?.path ?? null}
        loading={plotImages.isLoading && Boolean(imagesPrefix)}
      />
    </div>
  )
}
