import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import {
  type ExperimentOutput,
  ExperimentsService,
  type TraitOutput,
  type TraitRecordOutput,
  TraitsService,
} from "@/client"
import { MultiSelectFilter } from "@/components/Common/MultiSelectFilter"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { idAsString } from "@/features/admin/lib/ids"
import { fetchTraitRecords } from "@/features/analyze/lib/traitRecords"

const PAGE_SIZE = 50

function recordInfoEntries(info: unknown): Array<[string, string]> {
  if (info == null) return []
  if (typeof info === "string") {
    try {
      const parsed = JSON.parse(info)
      return recordInfoEntries(parsed)
    } catch {
      return [["info", info]]
    }
  }
  if (typeof info !== "object") return []
  return Object.entries(info as Record<string, unknown>).map(([k, v]) => [
    k,
    v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v),
  ])
}

function recordInfoValue(info: unknown, key: string): string {
  for (const [k, v] of recordInfoEntries(info)) {
    if (k === key) return v
  }
  return ""
}

function uniqueSorted(values: Iterable<string>): string[] {
  const set = new Set<string>()
  for (const v of values) {
    if (v != null && String(v).trim() !== "") set.add(String(v))
  }
  return [...set].sort()
}

export function TraitDataViewer() {
  const [experimentName, setExperimentName] = useState<string>("")
  const [traitId, setTraitId] = useState<string>("")
  const [page, setPage] = useState(0)
  const [filterSeason, setFilterSeason] = useState<Set<string>>(new Set())
  const [filterSite, setFilterSite] = useState<Set<string>>(new Set())
  const [filterPlot, setFilterPlot] = useState<Set<string>>(new Set())
  const [filterDataset, setFilterDataset] = useState<Set<string>>(new Set())
  const [filterPopulation, setFilterPopulation] = useState<Set<string>>(
    new Set(),
  )
  const [filterGenotype, setFilterGenotype] = useState<Set<string>>(new Set())

  const experimentsQuery = useQuery({
    queryKey: ["view", "experiments"],
    queryFn: () =>
      ExperimentsService.apiExperimentsAllGetAllExperiments({
        limit: 500,
        offset: 0,
      }),
  })
  const experiments: ExperimentOutput[] =
    (experimentsQuery.data as ExperimentOutput[] | null) ?? []

  const traitsQuery = useQuery({
    queryKey: ["view", "traits"],
    queryFn: () =>
      TraitsService.apiTraitsAllGetAllTraits({ limit: 500, offset: 0 }),
  })
  const traits: TraitOutput[] = (traitsQuery.data as TraitOutput[] | null) ?? []

  const recordsQuery = useQuery({
    queryKey: ["view", "trait-records", traitId, experimentName],
    queryFn: () =>
      fetchTraitRecords(traitId, { experimentName: experimentName || null }),
    enabled: Boolean(traitId),
  })

  const allRecords: TraitRecordOutput[] = recordsQuery.data ?? []

  // Build distinct option lists from the unfiltered set so filters
  // remain stable as the user toggles them.
  const seasonOptions = useMemo(
    () => uniqueSorted(allRecords.map((r) => r.season_name ?? "")),
    [allRecords],
  )
  const siteOptions = useMemo(
    () => uniqueSorted(allRecords.map((r) => r.site_name ?? "")),
    [allRecords],
  )
  const plotOptions = useMemo(
    () =>
      uniqueSorted(
        allRecords.map((r) =>
          r.plot_number != null ? String(r.plot_number) : "",
        ),
      ),
    [allRecords],
  )
  const datasetOptions = useMemo(
    () => uniqueSorted(allRecords.map((r) => r.dataset_name ?? "")),
    [allRecords],
  )
  const populationOptions = useMemo(
    () =>
      uniqueSorted(
        allRecords.map((r) => recordInfoValue(r.record_info, "population")),
      ),
    [allRecords],
  )
  const genotypeOptions = useMemo(
    () =>
      uniqueSorted(
        allRecords.map((r) => recordInfoValue(r.record_info, "genotype")),
      ),
    [allRecords],
  )

  const records = useMemo(() => {
    return allRecords.filter((r) => {
      if (filterSeason.size > 0 && !filterSeason.has(r.season_name ?? ""))
        return false
      if (filterSite.size > 0 && !filterSite.has(r.site_name ?? ""))
        return false
      if (
        filterPlot.size > 0 &&
        !filterPlot.has(r.plot_number != null ? String(r.plot_number) : "")
      )
        return false
      if (filterDataset.size > 0 && !filterDataset.has(r.dataset_name ?? ""))
        return false
      if (
        filterPopulation.size > 0 &&
        !filterPopulation.has(recordInfoValue(r.record_info, "population"))
      )
        return false
      if (
        filterGenotype.size > 0 &&
        !filterGenotype.has(recordInfoValue(r.record_info, "genotype"))
      )
        return false
      return true
    })
  }, [
    allRecords,
    filterSeason,
    filterSite,
    filterPlot,
    filterDataset,
    filterPopulation,
    filterGenotype,
  ])

  const allInfoKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const r of records) {
      for (const [k] of recordInfoEntries(r.record_info)) keys.add(k)
    }
    return Array.from(keys).sort()
  }, [records])

  const pagedRecords = useMemo(
    () => records.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [records, page],
  )
  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE))

  const selectedTrait = traits.find((t) => idAsString(t.id) === traitId)
  const anyFilterActive =
    filterSeason.size > 0 ||
    filterSite.size > 0 ||
    filterPlot.size > 0 ||
    filterDataset.size > 0 ||
    filterPopulation.size > 0 ||
    filterGenotype.size > 0

  function resetFilters() {
    setFilterSeason(new Set())
    setFilterSite(new Set())
    setFilterPlot(new Set())
    setFilterDataset(new Set())
    setFilterPopulation(new Set())
    setFilterGenotype(new Set())
    setPage(0)
  }

  function setPagedFilter<T>(setter: (next: T) => void): (next: T) => void {
    return (next: T) => {
      setter(next)
      setPage(0)
    }
  }

  return (
    <div className="space-y-4" data-testid="trait-data-viewer">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label
            htmlFor="trait-viewer-experiment"
            className="text-xs text-muted-foreground"
          >
            Experiment (optional filter)
          </label>
          <Select
            value={experimentName || "__all__"}
            onValueChange={(v) => {
              setExperimentName(v === "__all__" ? "" : v)
              setPage(0)
            }}
          >
            <SelectTrigger
              id="trait-viewer-experiment"
              className="w-64"
              data-testid="trait-viewer-experiment"
            >
              <SelectValue placeholder="All experiments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All experiments</SelectItem>
              {experiments.map((e) => (
                <SelectItem key={idAsString(e.id)} value={e.experiment_name}>
                  {e.experiment_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label
            htmlFor="trait-viewer-trait"
            className="text-xs text-muted-foreground"
          >
            Trait
          </label>
          <Select
            value={traitId}
            onValueChange={(v) => {
              setTraitId(v)
              setPage(0)
            }}
          >
            <SelectTrigger
              id="trait-viewer-trait"
              className="w-64"
              data-testid="trait-viewer-trait"
            >
              <SelectValue placeholder="Pick a trait" />
            </SelectTrigger>
            <SelectContent>
              {traits.map((t) => (
                <SelectItem key={idAsString(t.id)} value={idAsString(t.id)}>
                  {t.trait_name}
                  {t.trait_units ? ` (${t.trait_units})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!traitId && (
        <p className="text-sm text-muted-foreground">
          Pick a trait to view its records.
        </p>
      )}

      {traitId && recordsQuery.isLoading && (
        <p className="text-sm text-muted-foreground">Loading records…</p>
      )}

      {traitId && recordsQuery.isError && (
        <p className="text-sm text-destructive">
          Failed to load records:{" "}
          {recordsQuery.error instanceof Error
            ? recordsQuery.error.message
            : "unknown error"}
        </p>
      )}

      {traitId && !recordsQuery.isLoading && allRecords.length > 0 && (
        <div
          className="flex flex-wrap items-end gap-3"
          data-testid="trait-viewer-filters"
        >
          <MultiSelectFilter
            label="Season"
            options={seasonOptions}
            selected={filterSeason}
            onChange={setPagedFilter(setFilterSeason)}
            width="w-40"
            testId="trait-viewer-filter-season"
          />
          <MultiSelectFilter
            label="Site"
            options={siteOptions}
            selected={filterSite}
            onChange={setPagedFilter(setFilterSite)}
            width="w-40"
            testId="trait-viewer-filter-site"
          />
          <MultiSelectFilter
            label="Plot"
            options={plotOptions}
            selected={filterPlot}
            onChange={setPagedFilter(setFilterPlot)}
            width="w-32"
            testId="trait-viewer-filter-plot"
          />
          <MultiSelectFilter
            label="Dataset"
            options={datasetOptions}
            selected={filterDataset}
            onChange={setPagedFilter(setFilterDataset)}
            width="w-44"
            testId="trait-viewer-filter-dataset"
          />
          {populationOptions.length > 0 && (
            <MultiSelectFilter
              label="Population"
              options={populationOptions}
              selected={filterPopulation}
              onChange={setPagedFilter(setFilterPopulation)}
              width="w-44"
              testId="trait-viewer-filter-population"
            />
          )}
          {genotypeOptions.length > 0 && (
            <MultiSelectFilter
              label="Genotype"
              options={genotypeOptions}
              selected={filterGenotype}
              onChange={setPagedFilter(setFilterGenotype)}
              width="w-44"
              testId="trait-viewer-filter-genotype"
            />
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={resetFilters}
            disabled={!anyFilterActive}
            data-testid="trait-viewer-reset-filters"
            className="self-end"
          >
            Reset filters
          </Button>
        </div>
      )}

      {traitId && !recordsQuery.isLoading && records.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="no-records">
          {allRecords.length === 0
            ? `No records found for this trait${experimentName ? ` under "${experimentName}"` : ""}.`
            : "No records match the current filters. Try clearing them."}
        </p>
      )}

      {traitId && records.length > 0 && (
        <>
          <div
            className="text-xs text-muted-foreground"
            data-testid="trait-viewer-record-count"
          >
            Showing {page * PAGE_SIZE + 1}-
            {Math.min((page + 1) * PAGE_SIZE, records.length)} of{" "}
            {records.length}
            {anyFilterActive ? ` (filtered from ${allRecords.length})` : ""}{" "}
            record{records.length === 1 ? "" : "s"}
            {selectedTrait?.trait_units
              ? ` · units: ${selectedTrait.trait_units}`
              : ""}
          </div>
          <div className="rounded-md border overflow-x-auto">
            <Table data-testid="trait-records-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Experiment</TableHead>
                  <TableHead>Season</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Plot</TableHead>
                  <TableHead>Value</TableHead>
                  {allInfoKeys.map((k) => (
                    <TableHead key={k}>{k}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRecords.map((r, i) => {
                  const infoMap = new Map(recordInfoEntries(r.record_info))
                  return (
                    <TableRow key={`${r.timestamp}-${i}`}>
                      <TableCell className="font-mono text-xs">
                        {r.timestamp}
                      </TableCell>
                      <TableCell>{r.experiment_name ?? ""}</TableCell>
                      <TableCell>{r.season_name ?? ""}</TableCell>
                      <TableCell>{r.site_name ?? ""}</TableCell>
                      <TableCell>{r.plot_number ?? ""}</TableCell>
                      <TableCell className="font-mono">
                        {r.trait_value}
                      </TableCell>
                      {allInfoKeys.map((k) => (
                        <TableCell key={k}>{infoMap.get(k) ?? ""}</TableCell>
                      ))}
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
