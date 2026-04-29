/**
 * PlotBoundaryPrep — wizard tool for drawing/saving plot boundaries.
 *
 * R5a MVP: AerialScope is owned by the parent run (scope passed in as a
 * prop, no in-component picker). Polygon drawing via leaflet+geoman in
 * lng/lat — no pixel↔geo glue needed because Geoman emits EPSG:4326
 * GeoJSON directly. Save/load goes through PlotGeometryService versions.
 *
 * Lost vs main (deferred to future passes):
 *   - Auto-boundary estimation from TIF georeferencing (no GEMINIbase
 *     endpoint).
 *   - Mosaic/orthomosaic background tiles (TiTiler integration deferred).
 *   - Field-design CSV row/col auto-population.
 *   - Stitch-version selection (ground-pipeline territory; R6).
 *
 * Step completion: when the user clicks "Save & complete step", we save
 * a new version, activate it, and flip the run's plot_boundary_prep
 * step to completed. Trait extraction's boundary-version picker reads
 * the active version from the same directory.
 */
import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { BoundaryMap } from "@/features/process/components/BoundaryMap"
import { VersionPicker } from "@/features/process/components/VersionPicker"
import {
  useActivatePlotGeometryVersion,
  useLoadPlotGeometryVersion,
  useSavePlotGeometryVersion,
  type PlotGeometryStateSnapshot,
} from "@/features/process/hooks/usePlotGeometry"
import { generateGridFeatures } from "@/features/process/lib/grid"
import type { AerialScope } from "@/features/process/lib/paths"
import { processedPrefix } from "@/features/process/lib/paths"
import {
  setStepState,
  type Run,
} from "@/features/process/lib/runStore"
import useCustomToast from "@/hooks/useCustomToast"

export interface PlotBoundaryPrepProps {
  run: Run
  scope: AerialScope
  onSaved?: () => void
  onCancel?: () => void
}

export function PlotBoundaryPrep({
  run,
  scope,
  onSaved,
  onCancel,
}: PlotBoundaryPrepProps) {
  const directory = useMemo(() => processedPrefix(scope), [scope])

  const [features, setFeatures] = useState<GeoJSON.Feature[]>([])
  const [versionToLoad, setVersionToLoad] = useState<number | null>(null)
  const [versionName, setVersionName] = useState("")
  const [rows, setRows] = useState(4)
  const [cols, setCols] = useState(10)
  const [angle, setAngle] = useState(0)
  const [gapMeters, setGapMeters] = useState(0)

  const save = useSavePlotGeometryVersion()
  const activate = useActivatePlotGeometryVersion()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const loaded = useLoadPlotGeometryVersion(directory, versionToLoad)
  useEffect(() => {
    if (!loaded.data?.state_snapshot) return
    const fc = loaded.data.state_snapshot.boundaries
    if (fc?.features) setFeatures(fc.features as GeoJSON.Feature[])
    const grid = loaded.data.state_snapshot.grid
    if (grid) {
      setRows(grid.rows)
      setCols(grid.cols)
      setAngle(grid.angle_deg ?? 0)
      setGapMeters(grid.spacing_m ?? 0)
    }
  }, [loaded.data])

  function regenerateGrid() {
    // Use the first polygon as the outer boundary; if none, do nothing.
    const outer =
      features.find(
        (f): f is GeoJSON.Feature<GeoJSON.Polygon> =>
          f.geometry?.type === "Polygon" &&
          (f.properties?.role ?? "outer") === "outer",
      ) ??
      features.find(
        (f): f is GeoJSON.Feature<GeoJSON.Polygon> => f.geometry?.type === "Polygon",
      )
    if (!outer) {
      showErrorToast("Draw an outer boundary first, then generate the grid.")
      return
    }
    const grid = generateGridFeatures(outer.geometry, {
      rows,
      cols,
      angleDeg: angle,
      gapXMeters: gapMeters,
      gapYMeters: gapMeters,
    })
    setFeatures([
      { ...outer, properties: { ...(outer.properties ?? {}), role: "outer" } },
      ...grid,
    ])
  }

  async function handleSaveOnly() {
    try {
      await saveCurrent()
      showSuccessToast("Saved plot-geometry version")
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : "Failed to save version")
    }
  }

  async function handleSaveAndComplete() {
    try {
      const v = await saveCurrent()
      // Activate immediately so trait_extraction picks it up.
      await activate.mutateAsync({ directory, version: v.version })
      // Flip the wizard step to completed and stash the version on the
      // step's outputs so the trait dialog can read it directly.
      setStepState(run.id, "plot_boundary_prep", {
        status: "completed",
        completedAt: new Date().toISOString(),
        outputs: {
          ...(run.steps.plot_boundary_prep?.outputs ?? {}),
          activeVersion: v.version,
          activeVersionName: v.name ?? null,
        },
      })
      showSuccessToast(`Saved + activated v${v.version}`)
      onSaved?.()
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : "Failed to save and activate",
      )
    }
  }

  async function saveCurrent() {
    if (features.length === 0) {
      throw new Error("Draw at least one polygon first")
    }
    const snapshot: PlotGeometryStateSnapshot = {
      boundaries: { type: "FeatureCollection", features },
      grid: { rows, cols, spacing_m: gapMeters, angle_deg: angle },
      created_from: features.length > 1 ? "grid" : "draw",
    }
    const v = await save.mutateAsync({
      directory,
      stateSnapshot: snapshot,
      name: versionName.trim() || undefined,
    })
    setVersionName("")
    return v
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scope</CardTitle>
          <CardDescription>
            Versions are scoped per <code>{directory}</code>.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Map</CardTitle>
            <CardDescription>
              Use the toolbar to draw or edit polygons. Geometry renders live in
              the panels on the right.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BoundaryMap features={features} onFeaturesChange={setFeatures} />
            <p className="text-muted-foreground mt-2 text-xs">
              {features.length} feature{features.length === 1 ? "" : "s"} drawn
            </p>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Grid</CardTitle>
              <CardDescription>
                Generate plot rectangles inscribed in the outer polygon.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="grid-rows" className="mb-1.5 text-xs">
                    Rows
                  </Label>
                  <Input
                    id="grid-rows"
                    data-testid="boundary-rows"
                    type="number"
                    min={1}
                    value={rows}
                    onChange={(e) => setRows(Number(e.target.value) || 1)}
                  />
                </div>
                <div>
                  <Label htmlFor="grid-cols" className="mb-1.5 text-xs">
                    Cols
                  </Label>
                  <Input
                    id="grid-cols"
                    data-testid="boundary-cols"
                    type="number"
                    min={1}
                    value={cols}
                    onChange={(e) => setCols(Number(e.target.value) || 1)}
                  />
                </div>
                <div>
                  <Label htmlFor="grid-angle" className="mb-1.5 text-xs">
                    Angle (°)
                  </Label>
                  <Input
                    id="grid-angle"
                    type="number"
                    value={angle}
                    onChange={(e) => setAngle(Number(e.target.value) || 0)}
                  />
                </div>
                <div>
                  <Label htmlFor="grid-gap" className="mb-1.5 text-xs">
                    Gap (m)
                  </Label>
                  <Input
                    id="grid-gap"
                    type="number"
                    min={0}
                    value={gapMeters}
                    onChange={(e) => setGapMeters(Number(e.target.value) || 0)}
                  />
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={regenerateGrid}>
                Generate plot grid
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Save</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label htmlFor="version-name" className="mb-1.5 text-xs">
                  Version name (optional)
                </Label>
                <Input
                  id="version-name"
                  data-testid="boundary-version-name"
                  placeholder="e.g. v1 grid 4×10"
                  value={versionName}
                  onChange={(e) => setVersionName(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  data-testid="boundary-save-and-complete"
                  onClick={handleSaveAndComplete}
                  disabled={features.length === 0 || save.isPending || activate.isPending}
                >
                  {save.isPending || activate.isPending
                    ? "Saving…"
                    : "Save & complete step"}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleSaveOnly}
                  disabled={features.length === 0 || save.isPending}
                >
                  Save without activating
                </Button>
                {onCancel && (
                  <Button variant="ghost" onClick={onCancel}>
                    Cancel
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Tabs defaultValue="versions">
        <TabsList>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>
        <TabsContent value="versions" className="pt-3">
          <VersionPicker
            directory={directory}
            activeVersion={versionToLoad}
            onLoad={(v) => setVersionToLoad(v)}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
