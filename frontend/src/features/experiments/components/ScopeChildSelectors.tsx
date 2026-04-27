/**
 * Sub-experiment selectors for the sidebar.
 *
 * Renders Season / Site / Population dropdowns under the active
 * experiment. Mounts as a single component so it can:
 *
 *   - Hide everything when no experiment is picked (the sidebar shows a
 *     consolidated "no experiments yet" hint above us in that case).
 *   - When an experiment IS picked but has no children registered yet,
 *     show ONE actionable empty-state line ("Upload data on the Files
 *     tab — the form registers everything for you") instead of three
 *     independent "None registered yet." copies.
 *   - When some children exist and others don't, render the selectors
 *     that have options and a small inline note for those that don't.
 *
 * Auto-pick: when a selector has exactly one option, pick it on mount
 * so the user doesn't have to click through three one-item dropdowns.
 */
import { useEffect } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useExperimentScope } from "@/contexts/ExperimentContext"
import {
  useExperimentPopulations,
  useExperimentSeasons,
  useExperimentSites,
} from "@/features/experiments/hooks/useExperimentData"

interface OneOfProps {
  testId: string
  placeholder: string
  noneLabel: string
  options: { id: string; name: string }[]
  value: string | null
  onChange: (id: string | null) => void
  isLoading: boolean
}

function OneOf({
  testId,
  placeholder,
  noneLabel,
  options,
  value,
  onChange,
  isLoading,
}: OneOfProps) {
  // Auto-pick the only option to save the user a click.
  useEffect(() => {
    if (!value && options.length === 1) onChange(options[0].id)
  }, [value, options, onChange])

  if (isLoading) {
    return (
      <div className="text-xs text-muted-foreground px-2 py-1">Loading…</div>
    )
  }
  if (options.length === 0) {
    return (
      <div
        data-testid={`${testId}-empty`}
        className="text-xs text-muted-foreground px-2 py-1"
      >
        {noneLabel}
      </div>
    )
  }
  return (
    <Select
      value={value ?? undefined}
      onValueChange={(v) => onChange(v || null)}
    >
      <SelectTrigger size="sm" className="w-full" data-testid={testId}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Combined Season + Site + Population selector. Mounts once in the
 * sidebar; renders nothing when no experiment is selected, and shows a
 * single consolidated empty-state when the active experiment has no
 * children of any kind.
 */
export function ScopeChildSelectors() {
  const {
    experimentId,
    seasonId,
    setSeasonId,
    siteId,
    setSiteId,
    populationId,
    setPopulationId,
  } = useExperimentScope()

  const seasons = useExperimentSeasons(experimentId)
  const sites = useExperimentSites(experimentId)
  const populations = useExperimentPopulations(experimentId)

  // No active experiment → render nothing. The parent sidebar already
  // shows the "create or upload" hint in this case.
  if (!experimentId) return null

  const seasonOptions = (seasons.data ?? [])
    .filter((s) => s.id != null)
    .map((s) => ({ id: String(s.id), name: s.season_name ?? "(unnamed)" }))
  const siteOptions = (sites.data ?? [])
    .filter((s) => s.id != null)
    .map((s) => ({ id: String(s.id), name: s.site_name ?? "(unnamed)" }))
  const populationOptions = (populations.data ?? [])
    .filter((p) => p.id != null)
    .map((p) => ({ id: String(p.id), name: p.population_name ?? "(unnamed)" }))

  const allLoading = seasons.isLoading && sites.isLoading && populations.isLoading
  const allEmpty =
    !allLoading &&
    seasonOptions.length === 0 &&
    siteOptions.length === 0 &&
    populationOptions.length === 0

  if (allLoading) {
    return (
      <div className="text-xs text-muted-foreground px-2 py-1">Loading…</div>
    )
  }

  if (allEmpty) {
    return (
      <div
        data-testid="scope-child-empty"
        className="space-y-1 px-2 py-1 text-xs text-muted-foreground"
      >
        <p>This experiment has no seasons, sites, or populations yet.</p>
        <p>
          Upload data on the <span className="font-medium">Files</span> tab —
          the upload form creates them for you.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <OneOf
        testId="season-selector"
        placeholder="Select season"
        noneLabel="Season: none registered yet"
        options={seasonOptions}
        value={seasonId}
        onChange={setSeasonId}
        isLoading={seasons.isLoading}
      />
      <OneOf
        testId="site-selector"
        placeholder="Select site"
        noneLabel="Site: none registered yet"
        options={siteOptions}
        value={siteId}
        onChange={setSiteId}
        isLoading={sites.isLoading}
      />
      <OneOf
        testId="population-selector"
        placeholder="Select population"
        noneLabel="Population: none registered yet"
        options={populationOptions}
        value={populationId}
        onChange={setPopulationId}
        isLoading={populations.isLoading}
      />
    </div>
  )
}

// Backward-compat re-exports for callers that imported the individual
// selectors. The combined component above is the canonical surface; these
// remain so the sidebar keeps compiling during the rename, and so any
// external callers that picked one selector still work.
export function SeasonSelector() {
  return <ScopeChildSelectors />
}
export function SiteSelector() {
  return null
}
export function PopulationSelector() {
  return null
}
