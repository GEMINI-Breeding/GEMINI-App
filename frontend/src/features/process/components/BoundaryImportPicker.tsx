/**
 * "Import from…" — reuse plot boundaries saved for another flight date,
 * sensor, run or experiment.
 *
 * Boundary versions are keyed by their Processed/ directory, i.e. per
 * date *and* sensor, so a field drawn once was invisible to every later
 * flight. Main auto-applied the previous layout silently; this is an
 * explicit pick instead. Importing loads the layout into the editor as
 * unsaved work — nothing is written here until the user saves.
 */
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAllPlotGeometryVersions } from "@/features/process/hooks/usePlotGeometry"

/** `Processed/{season}/{exp}/{site}/{pop}/{date}/{platform}/{sensor}/` → parts. */
export function describeDirectory(directory: string) {
  const parts = directory.replace(/\/+$/, "").split("/")
  const [, season, experiment, site, population, date, platform, sensor] = parts
  return { season, experiment, site, population, date, platform, sensor }
}

export function BoundaryImportPicker({
  directory,
  onImport,
}: {
  /** The directory being edited; its own versions live in the Versions tab. */
  directory: string
  onImport: (directory: string, version: number, plotCount: number) => void
}) {
  const { data = [], isLoading, isError } = useAllPlotGeometryVersions()
  const [filter, setFilter] = useState("")

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return data
      .filter((v) => v.directory !== directory && v.plot_count > 0)
      .filter((v) => !q || v.directory.toLowerCase().includes(q))
  }, [data, directory, filter])

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
                    <td className="px-3 py-2 font-mono text-xs">{d.date}</td>
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
                        variant="outline"
                        onClick={() =>
                          onImport(v.directory, v.version, v.plot_count)
                        }
                      >
                        Import
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
