/**
 * PlotBoundaries — draw / generate / save plot polygons; manage versions.
 *
 * Combines what was once spread across PlotBoundaryPrep (2298 LOC) +
 * BoundaryDrawer (533 LOC) + EdgeCropTool (463 LOC) + raw versioning calls.
 * Backed entirely by PlotGeometryService — no /api/v1 URLs.
 */
import { useEffect, useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
import { ChevronLeft } from "lucide-react"

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
import {
  AerialScopePicker,
  buildAerialScope,
  readStoredAerialFields,
  useAerialScopeContext,
  writeStoredAerialFields,
  type AerialScopeFields,
} from "@/features/process/components/AerialScopePicker"
import { BoundaryMap } from "@/features/process/components/BoundaryMap"
import { GpsShiftPanel } from "@/features/process/components/GpsShiftPanel"
import { VersionPicker } from "@/features/process/components/VersionPicker"
import {
  useLoadPlotGeometryVersion,
  useSavePlotGeometryVersion,
  type PlotGeometryStateSnapshot,
} from "@/features/process/hooks/usePlotGeometry"
import { generateGridFeatures } from "@/features/process/lib/grid"
import {
  isAerialScopeComplete,
  processedPrefix,
} from "@/features/process/lib/paths"
import useCustomToast from "@/hooks/useCustomToast"

export function PlotBoundaries() {
  const ctx = useAerialScopeContext()
  const [fields, setFields] = useState<AerialScopeFields>(() => readStoredAerialFields())
  useEffect(() => writeStoredAerialFields(fields), [fields])

  const scope = useMemo(() => {
    const s = buildAerialScope(ctx, fields)
    return isAerialScopeComplete(s) ? s : null
  }, [ctx, fields])
  const directory = scope ? processedPrefix(scope) : null

  const [features, setFeatures] = useState<GeoJSON.Feature[]>([])
  const [versionToLoad, setVersionToLoad] = useState<number | null>(null)
  const [versionName, setVersionName] = useState("")

  const [rows, setRows] = useState(4)
  const [cols, setCols] = useState(10)
  const [angle, setAngle] = useState(0)
  const [gapMeters, setGapMeters] = useState(0)

  const save = useSavePlotGeometryVersion()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const loaded = useLoadPlotGeometryVersion(directory, versionToLoad)
  useEffect(() => {
    if (!loaded.data?.state_snapshot) return
    const fc = loaded.data.state_snapshot.boundaries
    if (fc?.features) setFeatures(fc.features as GeoJSON.Feature[])
  }, [loaded.data])

  function regenerateGrid() {
    // Use the first polygon as the outer boundary; if none, do nothing.
    const outer = features.find(
      (f): f is GeoJSON.Feature<GeoJSON.Polygon> =>
        f.geometry?.type === "Polygon" && (f.properties?.role ?? "outer") === "outer",
    ) ?? features.find(
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
    setFeatures([{ ...outer, properties: { ...(outer.properties ?? {}), role: "outer" } }, ...grid])
  }

  async function onSave() {
    if (!directory) return
    const snapshot: PlotGeometryStateSnapshot = {
      boundaries: { type: "FeatureCollection", features },
      grid: { rows, cols, spacing_m: gapMeters, angle_deg: angle },
      created_from: features.length > 1 ? "grid" : "draw",
    }
    try {
      await save.mutateAsync({
        directory,
        stateSnapshot: snapshot,
        name: versionName.trim() || undefined,
      })
      setVersionName("")
      showSuccessToast("Saved plot-geometry version")
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : "Failed to save version")
    }
  }

  return (
    <div className="container max-w-6xl space-y-4 px-4 py-6">
      <Button asChild variant="ghost" size="sm">
        <Link to="/process">
          <ChevronLeft className="mr-1 h-4 w-4" /> Pipeline
        </Link>
      </Button>

      <header>
        <h1 className="text-xl font-semibold">Plot boundaries</h1>
        <p className="text-muted-foreground text-sm">
          Draw an outer boundary or generate a grid. Save as a version that downstream steps will use.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Flight scope</CardTitle>
          <CardDescription>
            Versions are scoped per <code>Processed/.../{`{date}`}/.../</code> prefix.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AerialScopePicker value={fields} onChange={setFields} />
          {directory && (
            <code className="mt-2 block break-all text-xs text-muted-foreground">
              {directory}
            </code>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Map</CardTitle>
            <CardDescription>
              Use the toolbar to draw or edit polygons. Geometry is rendered live in the panels on
              the right.
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
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="grid-rows" className="mb-1.5 text-xs">Rows</Label>
                  <Input id="grid-rows" type="number" min={1} value={rows} onChange={(e) => setRows(Number(e.target.value) || 1)} />
                </div>
                <div>
                  <Label htmlFor="grid-cols" className="mb-1.5 text-xs">Cols</Label>
                  <Input id="grid-cols" type="number" min={1} value={cols} onChange={(e) => setCols(Number(e.target.value) || 1)} />
                </div>
                <div>
                  <Label htmlFor="grid-angle" className="mb-1.5 text-xs">Angle (°)</Label>
                  <Input id="grid-angle" type="number" value={angle} onChange={(e) => setAngle(Number(e.target.value) || 0)} />
                </div>
                <div>
                  <Label htmlFor="grid-gap" className="mb-1.5 text-xs">Gap (m)</Label>
                  <Input id="grid-gap" type="number" min={0} value={gapMeters} onChange={(e) => setGapMeters(Number(e.target.value) || 0)} />
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
                  placeholder="e.g. v1 grid 4×10"
                  value={versionName}
                  onChange={(e) => setVersionName(e.target.value)}
                />
              </div>
              <Button onClick={onSave} disabled={!directory || features.length === 0 || save.isPending}>
                {save.isPending ? "Saving…" : "Save as new version"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Tabs defaultValue="versions">
        <TabsList>
          <TabsTrigger value="versions">Versions</TabsTrigger>
          <TabsTrigger value="gps">GPS shift</TabsTrigger>
        </TabsList>
        <TabsContent value="versions" className="pt-3">
          {directory ? (
            <VersionPicker
              directory={directory}
              activeVersion={versionToLoad}
              onLoad={(v) => setVersionToLoad(v)}
            />
          ) : (
            <p className="text-muted-foreground text-sm">Pick a complete scope to manage versions.</p>
          )}
        </TabsContent>
        <TabsContent value="gps" className="pt-3">
          {directory ? (
            <GpsShiftPanel directory={directory} />
          ) : (
            <p className="text-muted-foreground text-sm">Pick a complete scope to manage GPS shift.</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
