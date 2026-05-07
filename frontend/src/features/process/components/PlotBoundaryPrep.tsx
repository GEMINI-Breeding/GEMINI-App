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
 *   - Stitch-version selection (ground-pipeline territory; R6).
 *
 * Step completion: when the user clicks "Save & complete step", we save
 * a new version, activate it, and flip the run's plot_boundary_prep
 * step to completed. Trait extraction's boundary-version picker reads
 * the active version from the same directory.
 */

import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"

import { FilesService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BoundaryMap } from "@/features/process/components/BoundaryMap"
import { FieldDesignUploadDialog } from "@/features/process/components/FieldDesignUploadDialog"
import { VersionPicker } from "@/features/process/components/VersionPicker"
import {
  type PlotGeometryStateSnapshot,
  useActivatePlotGeometryVersion,
  useLoadPlotGeometryVersion,
  useSavePlotGeometryVersion,
} from "@/features/process/hooks/usePlotGeometry"
import {
  buildTitilerTileUrl,
  resolveActiveOrtho,
  s3UrlForOrtho,
  tilejsonBoundsToLeaflet,
} from "@/features/process/lib/activeOrtho"
import {
  applyLabelsToFeatures,
  dimensionsFromDesign,
  type FdTransform,
  type FieldDesign,
  mergeLabelsIntoExisting,
} from "@/features/process/lib/fieldDesign"
import { generateGridFeatures } from "@/features/process/lib/grid"
import type { AerialScope } from "@/features/process/lib/paths"
import { processedPrefix } from "@/features/process/lib/paths"
import { type Run, setStepState } from "@/features/process/lib/runStore"
import useCustomToast from "@/hooks/useCustomToast"

const DEFAULT_BUCKET = "gemini"

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
  const [fieldDesign, setFieldDesign] = useState<FieldDesign | null>(null)
  const [fdDialogOpen, setFdDialogOpen] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  // Grid generation has two modes: "manual" (user picks rows/cols) and
  // "fd" (rows/cols come from an uploaded field-design CSV, which also
  // tags each polygon with the CSV's plot metadata). The user toggles
  // between them; switching back to "manual" doesn't discard the loaded
  // field design (so re-toggling restores it without re-upload).
  const [gridMode, setGridMode] = useState<"manual" | "fd">("manual")

  const save = useSavePlotGeometryVersion()
  const activate = useActivatePlotGeometryVersion()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  // List the processed prefix so buildOrthoVersions can derive the version
  // list. Same query key shape as OrthoVersionsPanel uses, so a delete from
  // there invalidates this view.
  const filesQuery = useQuery({
    queryKey: ["files", "list", `${DEFAULT_BUCKET}/${directory}`],
    queryFn: () =>
      FilesService.apiFilesListFilePathListFiles({
        filePath: `${DEFAULT_BUCKET}/${directory}`,
      }),
  })
  const activeOrtho = useMemo(
    () => resolveActiveOrtho(run, scope, filesQuery.data ?? []),
    [run, scope, filesQuery.data],
  )
  const s3Url = activeOrtho ? s3UrlForOrtho(activeOrtho) : null

  // TiTiler 2.0.1 exposes tilejson under /cog/{TMS}/tilejson.json. Asking for
  // WebMercatorQuad gives us a WGS84 `bounds` array (west, south, east, north)
  // and a fully-qualified XYZ template in `tiles[0]`. We rewrite TiTiler's
  // absolute URL onto our /titiler proxy so it works in both dev (vite proxy)
  // and bundled deployments where TiTiler isn't reachable on :8091.
  // Force tilesize=256 so the standard z/x/y maps to a 256px-equivalent
  // geographic extent (matches Leaflet's default tileSize: 256). TiTiler
  // 2.0.1 defaults to tilesize=512 in its tilejson template, which would
  // require either tileSize: 512 + zoomOffset on the Leaflet side or
  // result in tiles that depict the wrong geographic area for the slot.
  const tilejsonQuery = useQuery({
    queryKey: ["titiler", "tilejson", s3Url],
    queryFn: async () => {
      const res = await fetch(
        `/titiler/cog/WebMercatorQuad/tilejson.json?url=${encodeURIComponent(s3Url!)}&tilesize=256`,
      )
      if (!res.ok) throw new Error(`TiTiler tilejson failed: ${res.status}`)
      return res.json() as Promise<{
        tiles: string[]
        bounds: [number, number, number, number]
      }>
    },
    enabled: !!s3Url,
    staleTime: 5 * 60_000,
  })

  const orthoTileUrl = useMemo(
    () => (s3Url ? buildTitilerTileUrl(s3Url) : undefined),
    [s3Url],
  )

  // tilejson bounds: [west, south, east, north] in WGS84.
  // BoundaryMap wants [[south, west], [north, east]].
  const orthoBounds = useMemo<
    [[number, number], [number, number]] | undefined
  >(() => {
    const b = tilejsonQuery.data?.bounds
    return b ? tilejsonBoundsToLeaflet(b) : undefined
  }, [tilejsonQuery.data])

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
    const fd = loaded.data.state_snapshot.field_design
    if (fd) {
      setFieldDesign(fd)
      // The version was saved with a field design, so default the UI to
      // the field-design tab on reload.
      setGridMode("fd")
      // Auto-populate Rows/Cols only when the loaded version has no grid
      // yet — otherwise the saved grid wins.
      if (!grid) {
        const dims = dimensionsFromDesign(fd)
        setRows(dims.rows)
        setCols(dims.cols)
      }
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
        (f): f is GeoJSON.Feature<GeoJSON.Polygon> =>
          f.geometry?.type === "Polygon",
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
    // Replace the feature list with just the grid. The outer rectangle
    // would otherwise be saved as one giant "plot" that wraps all the
    // others — SPLIT_ORTHOMOSAIC and EXTRACT_TRAITS treat every feature
    // in the FeatureCollection as a distinct plot, so an enclosing
    // rectangle creates a junk plot covering the whole field.
    // Apply CSV-derived labels only when the user is in field-design
    // mode. In manual mode the loaded field design is intentionally
    // ignored so the polygons stay free of CSV metadata.
    const labeled =
      gridMode === "fd" && fieldDesign
        ? applyLabelsToFeatures(grid, fieldDesign)
        : grid
    setFeatures(labeled)
  }

  function setFdTransform(transform: FdTransform) {
    if (!fieldDesign) return
    const next: FieldDesign = { ...fieldDesign, transform }
    setFieldDesign(next)
    // Re-label the existing geometry live without redrawing.
    if (features.length > 0) {
      const fc: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features,
      }
      const merged = mergeLabelsIntoExisting(fc, next)
      setFeatures(merged.features as GeoJSON.Feature[])
    }
  }

  function handleFieldDesignSaved(fd: FieldDesign) {
    setFieldDesign(fd)
    setFdDialogOpen(false)
    setGridMode("fd")
    const dims = dimensionsFromDesign(fd)
    setRows(dims.rows)
    setCols(dims.cols)
    if (features.length === 0) {
      showSuccessToast(
        `Field design loaded — ${fd.rows.length} plots (${dims.rows} × ${dims.cols}).`,
      )
    } else {
      // Re-label existing geometry against the newly uploaded design.
      const fc: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features,
      }
      const merged = mergeLabelsIntoExisting(fc, fd)
      setFeatures(merged.features as GeoJSON.Feature[])
      showSuccessToast(
        `Field design loaded — ${fd.rows.length} plots applied to existing geometry.`,
      )
    }
  }

  async function handleSaveOnly() {
    try {
      await saveCurrent()
      showSuccessToast("Saved plot-geometry version")
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : "Failed to save version",
      )
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
      // Only persist the field design when the user is on the field-
      // design tab. Otherwise toggling to Manual + saving would still
      // carry hidden CSV state on the snapshot.
      ...(gridMode === "fd" && fieldDesign
        ? { field_design: fieldDesign }
        : {}),
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
            <BoundaryMap
              features={features}
              onFeaturesChange={setFeatures}
              orthoTileUrl={orthoTileUrl}
              orthoBounds={orthoBounds}
            />
            <div className="mt-2 flex items-center justify-between text-xs">
              <p className="text-muted-foreground">
                {features.length} feature{features.length === 1 ? "" : "s"}{" "}
                drawn
              </p>
              {activeOrtho && tilejsonQuery.isError && (
                <p className="text-muted-foreground italic">
                  Couldn't read ortho metadata — drawing on basemap.
                </p>
              )}
            </div>
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
              <Tabs
                value={gridMode}
                onValueChange={(v) => setGridMode(v as "manual" | "fd")}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="manual" data-testid="grid-mode-manual">
                    Manual
                  </TabsTrigger>
                  <TabsTrigger value="fd" data-testid="grid-mode-fd">
                    Field design CSV
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="manual" className="space-y-3 pt-3">
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
                        onChange={(e) =>
                          setGapMeters(Number(e.target.value) || 0)
                        }
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="fd" className="space-y-3 pt-3">
                  <div
                    className="rounded border bg-muted/30 p-2 text-xs"
                    data-testid="field-design-banner"
                  >
                    {fieldDesign ? (
                      <>
                        <p className="mb-1.5">
                          Field design:{" "}
                          <strong>{fieldDesign.rows.length}</strong> plots
                          loaded ({rows} × {cols})
                        </p>
                        <div className="mb-2 flex items-center gap-3">
                          <Label
                            htmlFor="fd-flip-rows"
                            className="flex items-center gap-1.5 font-normal"
                          >
                            <Checkbox
                              id="fd-flip-rows"
                              data-testid="fd-flip-rows"
                              checked={fieldDesign.transform.flipRows}
                              onCheckedChange={(v) =>
                                setFdTransform({
                                  ...fieldDesign.transform,
                                  flipRows: v === true,
                                })
                              }
                            />
                            Flip rows
                          </Label>
                          <Label
                            htmlFor="fd-flip-cols"
                            className="flex items-center gap-1.5 font-normal"
                          >
                            <Checkbox
                              id="fd-flip-cols"
                              data-testid="fd-flip-cols"
                              checked={fieldDesign.transform.flipCols}
                              onCheckedChange={(v) =>
                                setFdTransform({
                                  ...fieldDesign.transform,
                                  flipCols: v === true,
                                })
                              }
                            />
                            Flip cols
                          </Label>
                          <Label
                            htmlFor="fd-swap-axes"
                            className="flex items-center gap-1.5 font-normal"
                          >
                            <Checkbox
                              id="fd-swap-axes"
                              data-testid="fd-swap-axes"
                              checked={fieldDesign.transform.swapAxes}
                              onCheckedChange={(v) =>
                                setFdTransform({
                                  ...fieldDesign.transform,
                                  swapAxes: v === true,
                                })
                              }
                            />
                            Swap axes
                          </Label>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="field-design-replace"
                          onClick={() => setFdDialogOpen(true)}
                        >
                          Replace field design
                        </Button>
                      </>
                    ) : (
                      <>
                        <p className="text-muted-foreground mb-1.5">
                          Upload a CSV mapping (row, col) coordinates to plot
                          metadata. Rows/cols come from the design.
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="field-design-upload"
                          onClick={() => setFdDialogOpen(true)}
                        >
                          Upload field design
                        </Button>
                      </>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="grid-angle-fd" className="mb-1.5 text-xs">
                        Angle (°)
                      </Label>
                      <Input
                        id="grid-angle-fd"
                        type="number"
                        value={angle}
                        onChange={(e) => setAngle(Number(e.target.value) || 0)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="grid-gap-fd" className="mb-1.5 text-xs">
                        Gap (m)
                      </Label>
                      <Input
                        id="grid-gap-fd"
                        type="number"
                        min={0}
                        value={gapMeters}
                        onChange={(e) =>
                          setGapMeters(Number(e.target.value) || 0)
                        }
                      />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              {features.length === 0 ? (
                <p className="text-amber-700 dark:text-amber-400 text-xs">
                  Draw an outer boundary on the map, then click{" "}
                  <strong>Generate plot grid</strong>.
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={regenerateGrid}
                  disabled={gridMode === "fd" && !fieldDesign}
                >
                  Generate plot grid
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="boundary-clear-all"
                  onClick={() => setClearConfirmOpen(true)}
                  disabled={features.length === 0}
                >
                  Clear all polygons
                </Button>
              </div>
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
                  disabled={
                    features.length === 0 ||
                    save.isPending ||
                    activate.isPending
                  }
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

      <FieldDesignUploadDialog
        open={fdDialogOpen}
        onClose={() => setFdDialogOpen(false)}
        onSaved={handleFieldDesignSaved}
      />

      <Dialog
        open={clearConfirmOpen}
        onOpenChange={(o) => !o && setClearConfirmOpen(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear all polygons?</DialogTitle>
            <DialogDescription>
              This removes the {features.length} polygon
              {features.length === 1 ? "" : "s"} currently drawn on the map.
              You'll need to draw an outer boundary again before regenerating
              the grid. This cannot be undone (until you save again).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setClearConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              data-testid="boundary-clear-all-confirm"
              onClick={() => {
                setFeatures([])
                setClearConfirmOpen(false)
              }}
            >
              Clear all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
