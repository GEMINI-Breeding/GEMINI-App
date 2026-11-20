/**
 * DroneMarkingPanel — "Mark from drone plot boundaries" on the rover's Plot
 * Marking screen.
 *
 * With a drone flight of the same field, its plot boundaries mark every
 * plot on the rover track before stitching: the frames inside each drone
 * plot are that plot. The rover's GPS and the orthomosaic seldom agree to
 * the centimetre, so the panel first shows how far the track sits from the
 * drone beds and, when that is enough to matter, offers to shift and
 * straighten the raw track onto the beds (lib/droneMarking). The markings
 * then load into the editor to review and save like any other; the
 * correction is saved with them and the stitch uses the corrected GPS.
 */
import { useQuery } from "@tanstack/react-query"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Magnet,
  Plane,
  RotateCcw,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { PlotGeometryService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  describeDirectory,
  rankCandidates,
} from "@/features/process/components/BoundaryImportPicker"
import { useAllPlotGeometryVersions } from "@/features/process/hooks/usePlotGeometry"
import {
  applyTrackCorrection,
  dronePlots,
  estimateOffsets,
  fieldDirection,
  isEmptyCorrection,
  markFromDrone,
  snapToBeds,
  type TrackCorrection,
  trackFit,
  trackGeometry,
  type XY,
} from "@/features/process/lib/droneMarking"
import {
  type PlotMarkingSnapshot,
  type PlotSelection,
  plotMarkingsDirectory,
  type TrackPoint,
} from "@/features/process/lib/groundTrack"
import { type AerialScope, processedPrefix } from "@/features/process/lib/paths"

const SATELLITE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"

export interface DroneSource {
  directory: string
  version: number
}

/** Drone boundary versions of this field: same experiment, site and population. */
export function droneCandidates<
  T extends {
    directory: string
    version: number
    is_active?: boolean | null
    plot_count: number
  },
>(rows: T[], scope: AerialScope): T[] {
  const here = processedPrefix(scope)
  const mine = rows.filter((r) => {
    const d = describeDirectory(r.directory)
    return (
      r.plot_count > 0 &&
      d.platform?.toLowerCase() === "drone" &&
      d.experiment === scope.experiment &&
      d.site === scope.location &&
      d.population === scope.population
    )
  })
  // One per directory: its active version (else the newest).
  const byDir = new Map<string, T>()
  for (const r of mine) {
    const had = byDir.get(r.directory)
    if (
      !had ||
      (r.is_active && !had.is_active) ||
      (!had.is_active && r.version > had.version)
    )
      byDir.set(r.directory, r)
  }
  return rankCandidates([...byDir.values()], here)
}

const fmt = (m: number) => `${m >= 0 ? "" : "−"}${Math.abs(m).toFixed(2)} m`

function DroneTrackMap({
  points,
  raw,
  moved,
  plots,
  crossed,
}: {
  points: TrackPoint[]
  raw: { lat: number; lon: number }[]
  moved: { lat: number; lon: number }[]
  plots: GeoJSON.FeatureCollection | null
  crossed: Set<string>
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layers = useRef<L.LayerGroup | null>(null)
  const fitted = useRef(false)

  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, {
      zoomControl: true,
      attributionControl: false,
    })
    L.tileLayer(SATELLITE, { maxZoom: 23, maxNativeZoom: 19 }).addTo(m)
    layers.current = L.layerGroup().addTo(m)
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current
    const g = layers.current
    if (!m || !g) return
    g.clearLayers()
    if (plots)
      L.geoJSON(plots, {
        style: (f) => {
          const hit = crossed.has(String(f?.properties?.__key ?? ""))
          return {
            color: hit ? "#16a34a" : "#f8fafc",
            weight: 1,
            fillOpacity: hit ? 0.25 : 0.05,
            fillColor: hit ? "#16a34a" : "#f8fafc",
          }
        },
        onEachFeature: (f, layer) => {
          const p = f.properties ?? {}
          const label = p.plot ?? p.Plot ?? p.plot_number ?? ""
          if (label !== "") layer.bindTooltip(`Plot ${label}`)
        },
      }).addTo(g)
    const ll = (p: { lat: number; lon: number }): L.LatLngTuple => [
      p.lat,
      p.lon,
    ]
    if (raw.length)
      L.polyline(raw.map(ll), {
        color: "#f97316",
        weight: 1.5,
        opacity: 0.8,
        dashArray: "4 3",
      })
        .bindTooltip("The rover's GPS as recorded")
        .addTo(g)
    if (moved.length && moved !== raw)
      L.polyline(moved.map(ll), { color: "#38bdf8", weight: 2 })
        .bindTooltip("Corrected")
        .addTo(g)
    if (!fitted.current && raw.length) {
      fitted.current = true
      m.fitBounds(L.latLngBounds(raw.map(ll)), {
        padding: [16, 16],
        maxZoom: 21,
      })
    }
  }, [plots, raw, moved, crossed])

  return (
    <div className="relative h-[380px] w-full overflow-hidden rounded border">
      <div ref={el} className="absolute inset-0" data-testid="dm-map" />
      {!points.length && (
        <div className="bg-background/80 absolute inset-0 z-[500] flex items-center justify-center text-sm">
          No GPS on this track.
        </div>
      )}
      <div className="bg-background/85 absolute bottom-2 left-2 z-[500] space-y-0.5 rounded px-2 py-1 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-0 w-4 border-t-2 border-dashed border-orange-500" />
          rover GPS as recorded
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-0 w-4 border-t-2 border-sky-400" />{" "}
          corrected
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 border border-green-600 bg-green-600/30" />
          drone plots it crosses
        </div>
      </div>
    </div>
  )
}

export function DroneMarkingPanel({
  scope,
  points,
  lanes,
  defaultDirection,
  initialCorrection,
  initialSource,
  hasPlots,
  onMarked,
  onCorrection,
}: {
  scope: AerialScope
  points: TrackPoint[]
  lanes: number
  defaultDirection: string
  initialCorrection?: TrackCorrection | null
  initialSource?: DroneSource | null
  hasPlots: boolean
  /** New markings from the drone plots, for the editor (not saved yet). */
  onMarked: (
    selections: PlotSelection[],
    correction: TrackCorrection | null,
    source: DroneSource,
  ) => void
  /** The correction changed (the map and save use it). */
  onCorrection: (c: TrackCorrection | null) => void
}) {
  const all = useAllPlotGeometryVersions()
  const candidates = useMemo(
    () => droneCandidates(all.data ?? [], scope),
    [all.data, scope],
  )
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState<string | null>(null)
  useEffect(() => {
    if (pick || !candidates.length) return
    const want = initialSource
      ? candidates.find((c) => c.directory === initialSource.directory)
      : null
    setPick((want ?? candidates[0]).directory)
  }, [candidates, pick, initialSource])
  const chosen = candidates.find((c) => c.directory === pick) ?? null

  const boundaries = useQuery({
    queryKey: ["plot-geometry", "version", chosen?.directory, chosen?.version],
    enabled: Boolean(chosen),
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const res =
        (await PlotGeometryService.apiPlotGeometryVersionsLoadLoadVersion({
          requestBody: {
            directory: chosen?.directory as string,
            version: chosen?.version as number,
          },
        })) as unknown as {
          state_snapshot?: { boundaries?: GeoJSON.FeatureCollection }
        }
      return res.state_snapshot?.boundaries ?? null
    },
  })

  const geo = useMemo(() => trackGeometry(points), [points])
  const plots = useMemo(
    () =>
      geo && boundaries.data ? dronePlots(boundaries.data, geo.frame) : [],
    [geo, boundaries.data],
  )
  const [correction, setCorrection] = useState<TrackCorrection | null>(
    initialCorrection ?? null,
  )
  useEffect(() => setCorrection(initialCorrection ?? null), [initialCorrection])
  const change = (c: TrackCorrection | null) => {
    const next = isEmptyCorrection(c) ? null : c
    setCorrection(next)
    onCorrection(next)
  }
  const [direction, setDirection] = useState(defaultDirection || "down")
  useEffect(() => {
    if (defaultDirection) setDirection(defaultDirection)
  }, [defaultDirection])

  const moved = useMemo(
    () => (geo ? applyTrackCorrection(geo.xy, geo.passes, correction) : []),
    [geo, correction],
  )
  const rawFit = useMemo(
    () => (geo && plots.length ? trackFit(geo.xy, geo.passes, plots) : null),
    [geo, plots],
  )
  const nowFit = useMemo(
    () =>
      geo && plots.length && correction
        ? trackFit(moved, geo.passes, plots)
        : rawFit,
    [geo, plots, correction, moved, rawFit],
  )
  const estimate = useMemo(
    () =>
      geo && plots.length && rawFit?.shifted
        ? estimateOffsets(geo.xy, geo.passes, plots)
        : null,
    [geo, plots, rawFit],
  )
  const marked = useMemo(
    () =>
      geo && plots.length
        ? markFromDrone(
            points,
            geo.located,
            moved,
            geo.passes,
            plots,
            direction,
          )
        : null,
    [geo, plots, points, moved, direction],
  )

  // For the map: the drone plots keyed as dronePlots numbers them.
  const keyed = useMemo(() => {
    if (!boundaries.data) return null
    return {
      ...boundaries.data,
      features: boundaries.data.features.map((f, i) => ({
        ...f,
        properties: { ...(f.properties ?? {}), __key: String(i) },
      })),
    }
  }, [boundaries.data])
  const crossed = useMemo(() => {
    const s = new Set<string>()
    if (!marked) return s
    const keyOf = new Map(plots.map((p) => [p.properties, p.key]))
    for (const sel of marked.selections) {
      const k = sel.boundary ? keyOf.get(sel.boundary.properties) : undefined
      if (k) s.add(k)
    }
    return s
  }, [marked, plots])
  const rawLL = useMemo(
    () => (geo ? geo.xy.map((p) => geo.frame.toDeg(p)) : []),
    [geo],
  )
  const movedLL = useMemo(
    () => (correction && geo ? moved.map((p) => geo.frame.toDeg(p)) : rawLL),
    [moved, correction, rawLL, geo],
  )

  const nudge = (dx: number, dy: number) => {
    const s = correction?.shift_m ?? [0, 0]
    change({
      ...(correction ?? {}),
      shift_m: [
        Math.round((s[0] + dx) * 1000) / 1000,
        Math.round((s[1] + dy) * 1000) / 1000,
      ],
    })
  }
  const nudgeForward = (d: number) => {
    const r = correction?.rover_m ?? [0, 0]
    change({
      ...(correction ?? {}),
      rover_m: [Math.round((r[0] + d) * 100) / 100, r[1]],
    })
  }
  const snap = () => {
    if (!geo) return
    // Keep any along-travel offset the person set; the rest is estimated.
    const est = estimateOffsets(geo.xy, geo.passes, plots)
    const base = est?.correction ?? {}
    const fwd = correction?.rover_m?.[0] ?? 0
    const along = correction?.shift_m ?? [0, 0]
    // A whole-track shift along the beds (the person's) is kept as well.
    const u = fieldDirection(geo.passes)
    const alongM = along[0] * u[0] + along[1] * u[1]
    const withKept: TrackCorrection = {
      shift_m: [
        (base.shift_m?.[0] ?? 0) + u[0] * alongM,
        (base.shift_m?.[1] ?? 0) + u[1] * alongM,
      ],
      rover_m: [fwd, base.rover_m?.[1] ?? 0],
    }
    change(snapToBeds(geo.xy, geo.passes, plots, withKept))
  }
  const bedStep = nowFit?.spacing_m || 1

  const summary = !candidates.length
    ? null
    : rawFit
      ? rawFit.shifted
        ? `The rover's GPS is off the drone beds: ${rawFit.reason}.`
        : `The rover's GPS sits on the drone beds (${fmt(rawFit.offset_m)} off on average, ${Math.round(rawFit.inside * 100)}% of frames in a plot).`
      : null

  return (
    <div className="rounded border text-xs" data-testid="dm-panel">
      {/* Nothing to open until a drone flight of this field has boundaries:
          then it is a plain line saying how to get some. */}
      <button
        type="button"
        className="flex w-full items-start gap-2 px-3 py-2 text-left disabled:cursor-default"
        onClick={() => setOpen((v) => !v)}
        disabled={!candidates.length}
        data-testid="dm-toggle"
      >
        {!candidates.length ? (
          <span className="h-3.5 w-3.5 shrink-0" />
        ) : open ? (
          <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ) : (
          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        )}
        <Plane className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="font-medium">Mark from drone plot boundaries</span>
          <span className="text-muted-foreground">
            {" "}
            {all.isLoading
              ? "· looking for drone flights of this field…"
              : candidates.length
                ? `· ${candidates.length} drone flight${candidates.length === 1 ? "" : "s"} of this field have plot boundaries. Use them to mark every plot here, and the plot names come with them.`
                : "· Flown this field with a drone? Draw its plot boundaries on the orthomosaic (an aerial run's Plot Boundaries step), and they can mark every plot on this track."}
          </span>
          {summary && !open && (
            <span
              className={`mt-0.5 block ${rawFit?.shifted ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}
            >
              {summary}
            </span>
          )}
        </span>
      </button>

      {open && candidates.length > 0 && (
        <div className="space-y-3 border-t px-3 py-3">
          {lanes > 1 && (
            <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              This track is set to {lanes} plots per frame. Marking from drone
              plots works for one plot per frame for now.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span>Drone boundaries</span>
            <Select value={pick ?? undefined} onValueChange={setPick}>
              <SelectTrigger
                className="h-7 w-72 text-xs"
                data-testid="dm-source"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => {
                  const d = describeDirectory(c.directory)
                  return (
                    <SelectItem
                      key={c.directory}
                      value={c.directory}
                      className="text-xs"
                    >
                      {d.date} · {d.sensor} · v{c.version} · {c.plot_count}{" "}
                      plots
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <span className="ml-2">Stitch direction</span>
            <Select value={direction} onValueChange={setDirection}>
              <SelectTrigger
                className="h-7 w-24 text-xs"
                data-testid="dm-direction"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["down", "up", "left", "right"].map((d) => (
                  <SelectItem key={d} value={d} className="text-xs capitalize">
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {boundaries.isLoading && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
          </div>

          {rawFit && (
            <div
              className={`rounded border px-2 py-1.5 ${rawFit.shifted ? "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" : "bg-muted/40"}`}
              data-testid="dm-fit"
            >
              <p className="flex items-start gap-1.5">
                {rawFit.shifted ? (
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                )}
                <span>
                  {summary}
                  {rawFit.shifted && estimate && (
                    <>
                      {" "}
                      Best fit: {fmt(Math.abs(estimate.across_m))} across the
                      beds
                      {Math.abs(estimate.left_m) >= 0.05 &&
                        `, antenna ${Math.abs(estimate.left_m).toFixed(2)} m ${estimate.left_m > 0 ? "left" : "right"} of the camera`}
                      , putting {estimate.passes} passes on {estimate.beds}{" "}
                      beds. Snap to beds before marking.
                    </>
                  )}
                </span>
              </p>
              {correction && nowFit && (
                <p className="mt-1 pl-5" data-testid="dm-fit-now">
                  Corrected: {fmt(nowFit.offset_m)} off the bed centres,{" "}
                  {Math.round(nowFit.inside * 100)}% of frames in a plot.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={rawFit?.shifted && !correction ? "default" : "outline"}
              className="h-7"
              onClick={snap}
              disabled={!plots.length}
              data-testid="dm-snap"
              title="Shift the whole track and the antenna offset so the passes land on the drone beds, then straighten each pass onto its bed's centre line"
            >
              <Magnet className="h-3.5 w-3.5" /> Snap to beds
            </Button>
            <span className="text-muted-foreground">Shift</span>
            {(
              [
                [ArrowLeft, -0.1, 0, "West 10 cm"],
                [ArrowRight, 0.1, 0, "East 10 cm"],
                [ArrowUp, 0, 0.1, "North 10 cm"],
                [ArrowDown, 0, -0.1, "South 10 cm"],
              ] as const
            ).map(([Icon, dx, dy, t]) => (
              <Button
                key={t}
                size="sm"
                variant="outline"
                className="h-7 w-7 p-0"
                title={t}
                onClick={() => nudge(dx, dy)}
              >
                <Icon className="h-3.5 w-3.5" />
              </Button>
            ))}
            {geo && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  title="Move the whole track one bed over (the beds alone can't tell a whole-bed shift)"
                  onClick={() => {
                    const n = fieldN(geo.passes)
                    nudge(-n[0] * bedStep, -n[1] * bedStep)
                  }}
                >
                  − 1 bed
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2"
                  onClick={() => {
                    const n = fieldN(geo.passes)
                    nudge(n[0] * bedStep, n[1] * bedStep)
                  }}
                >
                  + 1 bed
                </Button>
              </>
            )}
            <span
              className="text-muted-foreground ml-1"
              title="The GPS antenna ahead of (+) or behind (−) the camera: moves each pass along its own direction of travel, so plot starts and ends line up on passes driven both ways"
            >
              Antenna ahead {(correction?.rover_m?.[0] ?? 0).toFixed(2)} m
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2"
              onClick={() => nudgeForward(-0.1)}
            >
              −
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2"
              onClick={() => nudgeForward(0.1)}
            >
              +
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              onClick={() => change(null)}
              disabled={!correction}
              data-testid="dm-reset"
            >
              <RotateCcw className="h-3.5 w-3.5" /> As recorded
            </Button>
          </div>

          <DroneTrackMap
            points={points}
            raw={rawLL}
            moved={movedLL}
            plots={keyed}
            crossed={crossed}
          />

          <div className="flex flex-wrap items-center gap-3">
            <p className="text-muted-foreground min-w-0 flex-1">
              {marked
                ? `${marked.selections.length} plots on this track (of ${marked.near} drone plots near it)${marked.repeated.length ? `; ${marked.repeated.length} crossed on two passes, the longer kept` : ""}. Each plot is the frames inside its drone boundary. They replace the markings in the editor to review; nothing is saved until you save.`
                : "Loading the drone plots…"}
            </p>
            <Button
              size="sm"
              className="h-7"
              disabled={!marked?.selections.length || !chosen || lanes > 1}
              data-testid="dm-mark"
              onClick={() =>
                marked &&
                chosen &&
                onMarked(marked.selections, correction, {
                  directory: chosen.directory,
                  version: chosen.version,
                })
              }
            >
              <Plane className="h-3.5 w-3.5" />
              {hasPlots ? "Replace with" : "Mark"}{" "}
              {marked?.selections.length ?? 0} plots
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function fieldN(passes: Parameters<typeof fieldDirection>[0]): XY {
  const u = fieldDirection(passes)
  return [-u[1], u[0]]
}

/**
 * On a rover run's Plot Boundary step: the plots were marked from drone
 * plot boundaries, so those are the boundaries to associate with (each
 * stitched plot already knows its drone plot). One click loads them.
 */
export function MarkedFromDroneNote({
  scope,
  loaded,
  onUse,
}: {
  scope: AerialScope
  loaded: DroneSource | null
  onUse: (source: DroneSource) => void
}) {
  const marking = useQuery({
    queryKey: ["plot-markings", plotMarkingsDirectory(scope), "active"],
    enabled: scope.platform.toLowerCase() !== "drone",
    queryFn: async () => {
      try {
        const res =
          (await PlotGeometryService.apiPlotGeometryVersionsLoadLoadVersion({
            requestBody: { directory: plotMarkingsDirectory(scope) },
          })) as { state_snapshot?: PlotMarkingSnapshot }
        return res.state_snapshot ?? null
      } catch {
        return null
      }
    },
  })
  const src = marking.data?.drone_boundaries
  if (!src) return null
  const d = describeDirectory(src.directory)
  const using =
    loaded?.directory === src.directory && loaded.version === src.version
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:bg-sky-950/40 dark:text-sky-200"
      data-testid="dm-boundary-note"
    >
      <Plane className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        This track's plots were marked from the drone plot boundaries of{" "}
        {d.date} (v{src.version}): each stitched plot keeps its drone plot,
        whatever the rover's GPS says.{" "}
        {using
          ? "Those boundaries are loaded."
          : "Load them here to associate with."}
      </span>
      {!using && (
        <Button
          size="sm"
          className="h-7"
          onClick={() => onUse(src)}
          data-testid="dm-use-boundaries"
        >
          Use the drone boundaries
        </Button>
      )}
    </div>
  )
}
