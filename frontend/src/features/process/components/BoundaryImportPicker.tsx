/**
 * "Import from…" — reuse plot boundaries saved for another flight date,
 * sensor, run or experiment.
 *
 * Boundary versions are keyed by their Processed/ directory, i.e. per
 * date *and* sensor, so a field drawn once was invisible to every later
 * flight. Main auto-applied the previous layout silently; this is an
 * explicit pick instead. Importing loads the layout into the editor as
 * unsaved work — nothing is written here until the user saves.
 *
 * Dates of the same field and season are listed first, earliest at the top:
 * boundaries drawn before the canopy closed carry to later dates. "Align to
 * this orthomosaic" moves them by how far the two maps differ (measured from
 * the images by the agent service); crops can be picked, for a flight of one
 * crop. Each plot keeps its label, crop and genotype from the field design.
 */
import { useMutation } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { agentApi } from "@/features/agent/lib/agentApi"
import {
  useAllPlotGeometryVersions,
  useLoadPlotGeometryVersion,
} from "@/features/process/hooks/usePlotGeometry"

/** `Processed/{season}/{exp}/{site}/{pop}/{date}/{platform}/{sensor}/` → parts. */
export function describeDirectory(directory: string) {
  const parts = directory.replace(/\/+$/, "").split("/")
  const [, season, experiment, site, population, date, platform, sensor] = parts
  return { season, experiment, site, population, date, platform, sensor }
}

/** Same field and season: everything but the date matches. */
function sameField(a: string, b: string): boolean {
  const x = describeDirectory(a)
  const y = describeDirectory(b)
  return (
    x.season === y.season &&
    x.experiment === y.experiment &&
    x.site === y.site &&
    x.population === y.population &&
    x.platform === y.platform &&
    x.sensor === y.sensor
  )
}

export function BoundaryImportPicker({
  directory,
  onImport,
  onImportSnapshot,
}: {
  /** The directory being edited; its own versions live in the Versions tab. */
  directory: string
  onImport: (directory: string, version: number, plotCount: number) => void
  /** Boundaries moved onto this date (and/or some crops only), not yet saved. */
  onImportSnapshot?: (snapshot: Record<string, unknown>, note: string) => void
}) {
  const { data = [], isLoading, isError } = useAllPlotGeometryVersions()
  const [filter, setFilter] = useState("")
  const [picked, setPicked] = useState<{
    directory: string
    version: number
    plotCount: number
  } | null>(null)
  const [align, setAlign] = useState(true)
  const [crops, setCrops] = useState<string[] | null>(null)

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return data
      .filter((v) => v.directory !== directory && v.plot_count > 0)
      .filter((v) => !q || v.directory.toLowerCase().includes(q))
      .map((v) => ({ ...v, same: sameField(v.directory, directory) }))
      .sort((a, b) =>
        a.same !== b.same
          ? a.same
            ? -1
            : 1
          : describeDirectory(a.directory).date.localeCompare(
              describeDirectory(b.directory).date,
            ),
      )
  }, [data, directory, filter])

  // The crops in the picked version (from each plot's design properties).
  const loaded = useLoadPlotGeometryVersion(
    picked?.directory ?? null,
    picked?.version ?? null,
  )
  const available = useMemo(() => {
    const feats =
      ((loaded.data?.state_snapshot?.boundaries as { features?: unknown[] })
        ?.features as { properties?: Record<string, unknown> }[]) ?? []
    return [
      ...new Set(
        feats
          .map((f) => f.properties?.crop)
          .filter((c): c is string => typeof c === "string" && c.length > 0),
      ),
    ].sort()
  }, [loaded.data])
  const chosen = crops ?? available

  const move = useMutation({
    mutationFn: () =>
      agentApi.moveBoundaries({
        from_directory: picked!.directory,
        from_version: picked!.version,
        to_directory: directory,
        crops: chosen.length < available.length ? chosen : undefined,
        align,
      }),
    onSuccess: (r) => {
      const s = r.shift
      const moved =
        align && s
          ? ` moved ${s.dx.toFixed(2)} m east, ${s.dy.toFixed(2)} m north (match ${s.match ?? "?"})`
          : ""
      onImportSnapshot?.(
        r.state_snapshot,
        `Imported ${r.plots} plots${moved}. ${r.check}.`,
      )
      setPicked(null)
    },
  })

  const importPicked = () => {
    if (!picked) return
    const subset = available.length > 0 && chosen.length < available.length
    if ((align || subset) && onImportSnapshot) move.mutate()
    else {
      onImport(picked.directory, picked.version, picked.plotCount)
      setPicked(null)
    }
  }

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading…</p>
  }
  if (isError) {
    return (
      <p className="text-destructive text-sm">
        Could not list saved boundaries.
      </p>
    )
  }

  return (
    <div className="space-y-2" data-testid="boundary-import-picker">
      <p className="text-muted-foreground text-xs">
        Load boundaries saved for another date, sensor or experiment into the
        editor. Check they line up with this orthomosaic, adjust if needed, then
        save — nothing is written until you do.
      </p>
      <Input
        placeholder="Filter by experiment, site, date…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="max-w-sm"
        data-testid="boundary-import-filter"
      />
      {rows.length === 0 ? (
        <p
          className="text-muted-foreground text-sm"
          data-testid="boundary-import-empty"
        >
          {filter
            ? "No saved boundaries match."
            : "No boundaries saved anywhere else yet."}
        </p>
      ) : (
        <div className="max-h-72 overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="px-3 py-2 text-left">Experiment</th>
                <th className="px-3 py-2 text-left">Site · population</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Sensor</th>
                <th className="px-3 py-2 text-left">Version</th>
                <th className="px-3 py-2 text-right">Plots</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const d = describeDirectory(v.directory)
                return (
                  <tr
                    key={`${v.directory}|${v.version}`}
                    className="border-t"
                    data-testid="boundary-import-row"
                  >
                    <td className="px-3 py-2">
                      {d.experiment}
                      <span className="text-muted-foreground text-xs">
                        {" "}
                        ({d.season})
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {d.site} · {d.population}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {d.date}
                      {v.same && (
                        <span
                          className="text-muted-foreground ml-1 font-sans"
                          title="Same field and season: these boundaries can be moved onto this date"
                        >
                          · same field
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {d.platform}/{d.sensor}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      v{v.version}
                      {v.name ? ` · ${v.name}` : ""}
                      {v.is_active ? " · active" : ""}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {v.plot_count}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant={
                          picked?.directory === v.directory &&
                          picked.version === v.version
                            ? "default"
                            : "outline"
                        }
                        onClick={() => {
                          setPicked({
                            directory: v.directory,
                            version: v.version,
                            plotCount: v.plot_count,
                          })
                          setCrops(null)
                          setAlign(v.same)
                        }}
                      >
                        Import…
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {picked && (
        <div
          className="space-y-2 rounded-md border p-3 text-sm"
          data-testid="boundary-import-options"
        >
          <p className="font-medium">
            {describeDirectory(picked.directory).date} · {picked.plotCount}{" "}
            plots
          </p>
          <div className="flex items-start gap-2">
            <Checkbox
              id="boundary-import-align"
              checked={align}
              onCheckedChange={(c) => setAlign(c === true)}
              disabled={!onImportSnapshot}
              data-testid="boundary-import-align"
            />
            <label htmlFor="boundary-import-align">
              Align to this date's orthomosaic (moves every plot by how far the
              two maps differ; sizes and labels stay)
            </label>
          </div>
          {available.length > 1 && (
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">
                Crops to bring (each keeps its field-design labels):
              </p>
              <div className="flex flex-wrap gap-3">
                {available.map((c) => (
                  <div key={c} className="flex items-center gap-1.5">
                    <Checkbox
                      id={`boundary-crop-${c.replace(/\W+/g, "-")}`}
                      checked={chosen.includes(c)}
                      onCheckedChange={(on) =>
                        setCrops(
                          on === true
                            ? [...chosen, c]
                            : chosen.filter((x) => x !== c),
                        )
                      }
                    />
                    <label htmlFor={`boundary-crop-${c.replace(/\W+/g, "-")}`}>
                      {c}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}
          {move.error && (
            <p className="text-destructive text-xs">
              {move.error instanceof Error
                ? move.error.message
                : String(move.error)}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={move.isPending || chosen.length === 0}
              onClick={importPicked}
              data-testid="boundary-import-go"
            >
              {move.isPending ? "Aligning…" : "Import"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
