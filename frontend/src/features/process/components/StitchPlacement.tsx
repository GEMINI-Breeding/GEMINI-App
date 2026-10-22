/**
 * StitchPlacement — where the stitched ground plots sit on the Plot Boundary
 * map, and the person's corrections when the rover's GPS is off.
 *
 * Each stitched plot is drawn as an outline at its GPS position (lanes of a
 * multi-plot frame already offset beside the GPS line by the stitch). Beds
 * (one lane of one rover pass) can be straightened onto a line, rotated and
 * shifted; the whole track can be shifted. Saved as versions next to the
 * stitch (…/AgRowStitch_vN/gps-corrections), and applied by the associate
 * step, so plots land where the map shows them (lib/gpsCorrections).
 */
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Loader2,
  RotateCcw,
  RotateCw,
  Save,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { type FileMetadata, PlotGeometryService } from "@/client"
import { authHeaders } from "@/components/Common/PlotImage"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { apiUrl, DEFAULT_BUCKET } from "@/features/files/lib/download"
import type { MapOverlay } from "@/features/process/components/BoundaryMap"
import {
  applyCorrections,
  bedsOf,
  correctionsDirectory,
  type GpsCorrections,
  type Ring,
  type StitchedPlot,
} from "@/features/process/lib/gpsCorrections"
import { stitchVersions } from "@/features/process/lib/groundTrack"
import type { AerialScope } from "@/features/process/lib/paths"

interface ManifestPlot {
  footprint?: Ring
  lane?: number
  lanes?: number
  stitching_direction?: string
}

/** The stitch version association uses: the fullest, newest on a tie. */
export function placementVersion(
  files: FileMetadata[],
  scope: AerialScope | null,
) {
  if (!scope) return null
  return (
    stitchVersions(files, scope)
      .filter((v) => v.combinedMosaic && v.manifest)
      .sort((a, b) => b.plotImages.length - a.plotImages.length)[0] ?? null
  )
}

export function useStitchPlacement(
  files: FileMetadata[] | undefined,
  scope: AerialScope | null,
) {
  const version = useMemo(
    () => placementVersion(files ?? [], scope),
    [files, scope],
  )
  const manifest = useQuery({
    queryKey: ["stitch-manifest", version?.manifest],
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/files/download/${DEFAULT_BUCKET}/${version?.manifest}`),
        { headers: authHeaders() },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as { plots?: Record<string, ManifestPlot> }
    },
    enabled: Boolean(version?.manifest),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const plots = useMemo<StitchedPlot[]>(
    () =>
      Object.entries(manifest.data?.plots ?? {})
        .filter(([, p]) => Array.isArray(p.footprint) && p.footprint.length > 2)
        .map(([id, p]) => ({
          id,
          footprint: p.footprint as Ring,
          lane: p.lane ?? 1,
          lanes: p.lanes ?? 1,
          direction: p.stitching_direction ?? "",
        })),
    [manifest.data],
  )
  const plotBed = useMemo(() => bedsOf(plots), [plots])
  const beds = useMemo(
    () =>
      [...new Set(Object.values(plotBed))].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      ),
    [plotBed],
  )

  const directory = version ? correctionsDirectory(version.prefix) : null
  const saved = useQuery({
    queryKey: ["gps-corrections", directory],
    queryFn: async () => {
      try {
        const res =
          (await PlotGeometryService.apiPlotGeometryVersionsLoadLoadVersion({
            requestBody: { directory: directory as string },
          })) as { version: number; state_snapshot?: GpsCorrections }
        return res.state_snapshot ?? {}
      } catch {
        return {} // none saved yet
      }
    },
    enabled: Boolean(directory),
  })
  const [corrections, setCorrections] = useState<GpsCorrections>({})
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (saved.data) {
      setCorrections(saved.data)
      setDirty(false)
    }
  }, [saved.data])
  const [selectedBed, setSelectedBed] = useState<string | null>(null)

  const full: GpsCorrections = useMemo(
    () => ({ ...corrections, plot_bed: plotBed }),
    [corrections, plotBed],
  )
  const corrected = useMemo(
    () =>
      applyCorrections(
        Object.fromEntries(plots.map((p) => [p.id, p.footprint])),
        full,
      ),
    [plots, full],
  )
  const overlays = useMemo<MapOverlay[]>(
    () =>
      plots.map((p) => ({
        id: p.id,
        ring: corrected[p.id] ?? p.footprint,
        group: plotBed[p.id],
        label: `Stitched plot ${p.id} · ${plotBed[p.id]}`,
        highlighted: plotBed[p.id] === selectedBed,
      })),
    [plots, corrected, plotBed, selectedBed],
  )

  const save = useMutation({
    mutationFn: async () => {
      if (!directory) throw new Error("No stitch version")
      return PlotGeometryService.apiPlotGeometryVersionsSaveSaveVersion({
        requestBody: {
          directory,
          state_snapshot: full as unknown as Record<string, unknown>,
          name: "GPS placement",
        },
      })
    },
    onSuccess: () => {
      setDirty(false)
      toast.success("Stitch placement saved; Associate will use it")
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not save placement"),
  })

  const update = (fn: (c: GpsCorrections) => GpsCorrections) => {
    setCorrections((c) => fn(c))
    setDirty(true)
  }

  return {
    version,
    loading: manifest.isLoading || saved.isLoading,
    plots,
    beds,
    plotBed,
    corrections,
    update,
    dirty,
    save,
    selectedBed,
    setSelectedBed,
    overlays,
    footprints: Object.fromEntries(plots.map((p) => [p.id, p.footprint])),
  }
}

export type StitchPlacementState = ReturnType<typeof useStitchPlacement>

const STEP = 0.1

/** Unit vector along a bed (east, north), from its plots' centres. */
function bedAxis(rings: Ring[]): [number, number] {
  if (rings.length < 2) return [1, 0]
  const c = (r: Ring) => {
    const pts = r.slice(0, -1)
    return [
      pts.reduce((a, p) => a + p[0], 0) / pts.length,
      pts.reduce((a, p) => a + p[1], 0) / pts.length,
    ]
  }
  const a = c(rings[0])
  const b = c(rings[rings.length - 1])
  const kx = Math.cos((a[1] * Math.PI) / 180)
  const dx = (b[0] - a[0]) * kx
  const dy = b[1] - a[1]
  const n = Math.hypot(dx, dy) || 1
  return [dx / n, dy / n]
}

function Nudge({
  label,
  value,
  onChange,
  axes,
}: {
  label: string
  value: [number, number]
  onChange: (v: [number, number]) => void
  /** Along-row direction, to also offer "across the row" nudges. */
  axes?: [number, number]
}) {
  const move = (de: number, dn: number) =>
    onChange([
      Math.round((value[0] + de) * 100) / 100,
      Math.round((value[1] + dn) * 100) / 100,
    ])
  const across = axes ? ([-axes[1], axes[0]] as const) : null
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">
          E {value[0].toFixed(2)} m · N {value[1].toFixed(2)} m
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0"
          title={`West ${STEP} m`}
          onClick={() => move(-STEP, 0)}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0"
          title={`East ${STEP} m`}
          onClick={() => move(STEP, 0)}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0"
          title={`North ${STEP} m`}
          onClick={() => move(0, STEP)}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0"
          title={`South ${STEP} m`}
          onClick={() => move(0, -STEP)}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
        {across && (
          <>
            <span className="text-muted-foreground ml-1 text-[11px]">
              across row
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => move(-across[0] * STEP, -across[1] * STEP)}
            >
              −{STEP}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => move(across[0] * STEP, across[1] * STEP)}
            >
              +{STEP}
            </Button>
          </>
        )}
        {(value[0] !== 0 || value[1] !== 0) && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => onChange([0, 0])}
          >
            Reset
          </Button>
        )}
      </div>
    </div>
  )
}

export function StitchPlacementPanel({
  state,
}: {
  state: StitchPlacementState
}) {
  const {
    version,
    loading,
    plots,
    beds,
    plotBed,
    corrections,
    update,
    dirty,
    save,
    selectedBed,
    setSelectedBed,
    footprints,
  } = state
  if (!version) return null
  const bed = selectedBed ?? beds[0] ?? null
  const spec = (bed && corrections.beds?.[bed]) || {}
  const setBed = (
    patch: Partial<NonNullable<GpsCorrections["beds"]>[string]>,
  ) =>
    bed &&
    update((c) => ({
      ...c,
      beds: {
        ...(c.beds ?? {}),
        [bed]: { ...(c.beds?.[bed] ?? {}), ...patch },
      },
    }))
  const bedRings = bed
    ? plots.filter((p) => plotBed[p.id] === bed).map((p) => footprints[p.id])
    : []
  return (
    <Card data-testid="stitch-placement">
      <CardHeader>
        <CardTitle className="text-base">Stitch placement (GPS)</CardTitle>
        <CardDescription>
          Blue outlines are the stitched plots of Stitch v{version.version}{" "}
          where the rover's GPS puts them. If they don't sit in the right grid
          cells, straighten, turn or move a bed (click it on the map) or the
          whole track. Associate uses the saved placement.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {loading ? (
          <p className="text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading stitched
            plots…
          </p>
        ) : plots.length === 0 ? (
          <p className="text-muted-foreground">
            This stitch has no georeferenced plots to place.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground">
              {plots.length} plots in {beds.length} bed
              {beds.length === 1 ? "" : "s"}.
            </p>
            <Nudge
              label="Whole track"
              value={corrections.shift_m ?? [0, 0]}
              onChange={(v) => update((c) => ({ ...c, shift_m: v }))}
            />
            <div className="space-y-2 rounded-md border p-2">
              {beds.length > 12 ? (
                <select
                  className="border-input bg-background h-7 w-full rounded border px-2 text-xs"
                  value={bed ?? ""}
                  onChange={(e) => setSelectedBed(e.target.value)}
                  aria-label="Bed"
                  data-testid="stitch-placement-bed"
                >
                  {beds.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {beds.map((b) => (
                    <Button
                      key={b}
                      size="sm"
                      variant={b === bed ? "default" : "outline"}
                      className="h-6 px-2 text-xs"
                      onClick={() => setSelectedBed(b)}
                    >
                      {b}
                    </Button>
                  ))}
                </div>
              )}
              {bed && (
                <>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={Boolean(spec.straighten)}
                      onChange={(e) => setBed({ straighten: e.target.checked })}
                    />
                    Straighten: put this bed's plots on one straight line
                  </label>
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground mr-auto">
                      Turn {(spec.rotate_deg ?? 0).toFixed(1)}°
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0"
                      title="Anticlockwise 0.5°"
                      onClick={() =>
                        setBed({
                          rotate_deg:
                            Math.round(((spec.rotate_deg ?? 0) - 0.5) * 10) /
                            10,
                        })
                      }
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0"
                      title="Clockwise 0.5°"
                      onClick={() =>
                        setBed({
                          rotate_deg:
                            Math.round(((spec.rotate_deg ?? 0) + 0.5) * 10) /
                            10,
                        })
                      }
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <Nudge
                    label={`Move ${bed}`}
                    value={spec.shift_m ?? [0, 0]}
                    onChange={(v) => setBed({ shift_m: v })}
                    axes={bedAxis(bedRings)}
                  />
                </>
              )}
            </div>
            <Button
              size="sm"
              className="w-full"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
              data-testid="stitch-placement-save"
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              {save.isPending
                ? "Saving…"
                : dirty
                  ? "Save placement"
                  : "Placement saved"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
