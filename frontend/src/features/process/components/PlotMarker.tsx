/**
 * PlotMarker — ground pipeline Plot Marking (ported from GEMINI-App main).
 *
 * Step through the rover's top-camera frames and mark the start and end
 * frame of each plot, plus the direction AgRowStitch stitches it in. An
 * optional map shows the GPS track, the current frame and the marked plots.
 *
 * Markings are versioned per population (lib/groundTrack), so a later
 * date's run starts from the last ones: markers whose frames aren't on
 * this track are moved to the nearest frame by GPS, with a banner asking
 * the user to check them. "Save" overwrites the loaded version, "Save As"
 * adds one.
 *
 * Keys: ← / → move, S start, E end, N new plot, D delete plot, Ctrl/⌘+S save.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import L from "leaflet"
import { AutoMarkBar } from "./AutoMarkBar"
import "leaflet/dist/leaflet.css"
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Flag,
  FlagOff,
  Layers,
  Loader2,
  Map as MapIcon,
  Plus,
  Trash2,
  X,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { PlotGeometryService } from "@/client"
import { authHeaders } from "@/components/Common/PlotImage"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { apiUrl } from "@/features/files/lib/download"
import {
  openFullImage,
  thumbnailSrc,
} from "@/features/genotyping/components/AuthImage"
import { useGroundTrack } from "@/features/process/hooks/useGroundTrack"
import {
  type FrameLayout,
  isComplete,
  laneName,
  lanePlotId,
  type PlotMarkingSnapshot,
  type PlotSelection,
  plotMarkingsDirectory,
  SINGLE_LANE,
  type TrackPoint,
  translateMarkings,
  withGps,
} from "@/features/process/lib/groundTrack"
import { type AerialScope, rawScopePrefix } from "@/features/process/lib/paths"
import { type Run, setStepState } from "@/features/process/lib/runStore"
import useCustomToast from "@/hooks/useCustomToast"
import { isLoggedIn } from "@/lib/auth"

const DIRECTIONS = [
  { value: "down", label: "Down" },
  { value: "up", label: "Up" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
]

const SATELLITE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"

function emptyPlot(plot_id: number, direction = ""): PlotSelection {
  return { plot_id, start_image: null, end_image: null, direction }
}

const renumber = (plots: PlotSelection[]) =>
  plots.map((p, i) => ({ ...p, plot_id: i + 1 }))

interface VersionRow {
  version: number
  name?: string | null
  is_active: boolean
  created_at?: string | null
}

// ── Frame loading ───────────────────────────────────────────────────────────

/**
 * Frames are shown as server-resized previews: marking a plot's start and
 * end needs to see the stakes and rows, not every pixel, and a preview is
 * ~50 KB against ~1 MB for the camera's full frame, which over a remote link
 * is the difference between stepping through a track and waiting on it.
 * The full frame is one click away ("Full size").
 */
const FRAME_PX = 800

function frameSrc(objectPath: string, size: number): string {
  return thumbnailSrc(objectPath, size)
}

/** A small view of one frame (a plot's start or end); click to show it large. */
function FrameThumb({
  prefix,
  name,
  label,
  active,
  onClick,
}: {
  prefix: string
  name: string | null
  label: string
  active: boolean
  onClick: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    setUrl(null)
    if (!name) return
    let gone = false
    let made: string | null = null
    fetch(apiUrl(frameSrc(`${prefix}${name}`, 300)), {
      headers: authHeaders(),
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b && !gone) {
          made = URL.createObjectURL(b)
          setUrl(made)
        }
      })
      .catch(() => {})
    return () => {
      gone = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [prefix, name])
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!name}
      className={`relative aspect-video overflow-hidden rounded border bg-black ${active ? "ring-2 ring-primary" : ""}`}
      title={name ? `${label}: ${name} (click to view)` : `${label} not set`}
      data-testid={`pm-thumb-${label.toLowerCase()}`}
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="text-muted-foreground absolute inset-0 flex items-center justify-center text-[10px]">
          {name ? "…" : "not set"}
        </span>
      )}
      <span
        className={`absolute top-0.5 left-0.5 rounded px-1 text-[10px] text-white ${label === "Start" ? "bg-green-600" : "bg-red-600"}`}
      >
        {label}
      </span>
    </button>
  )
}

/**
 * Blob URLs for frames (the download route needs the bearer token, so an
 * <img src> can't point at it). Cached, and the next frames are fetched
 * ahead, so stepping through a track doesn't flash a spinner per frame.
 */
function useFrameUrl(
  prefix: string,
  names: string[],
  index: number,
  step: number,
) {
  const cache = useRef(new Map<string, Promise<string>>())
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(
    (name: string) => {
      const key = prefix + name
      let p = cache.current.get(key)
      if (!p) {
        p = fetch(apiUrl(frameSrc(key, FRAME_PX)), {
          headers: authHeaders(),
        }).then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return URL.createObjectURL(await res.blob())
        })
        p.catch(() => cache.current.delete(key))
        cache.current.set(key, p)
      }
      return p
    },
    [prefix],
  )

  const name = names[index]
  useEffect(() => {
    if (!name) return
    let live = true
    setFailed(false)
    load(name)
      .then((u) => live && setUrl(u))
      .catch(() => live && setFailed(true))
    for (const k of [1, 2]) {
      const ahead = names[index + k * step]
      if (ahead) load(ahead).catch(() => {})
    }
    return () => {
      live = false
    }
  }, [name, names, index, step, load])

  useEffect(() => {
    const c = cache.current
    return () => {
      for (const p of c.values())
        p.then((u) => URL.revokeObjectURL(u)).catch(() => {})
      c.clear()
    }
  }, [])

  return { url, failed }
}

// ── GPS map ─────────────────────────────────────────────────────────────────

function GpsTrackMap({
  points,
  current,
  plots,
}: {
  points: TrackPoint[]
  current: string | null
  plots: PlotSelection[]
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layers = useRef<L.LayerGroup | null>(null)
  const located = useMemo(
    () => points.filter((p) => p.lat != null && p.lon != null),
    [points],
  )

  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, {
      zoomControl: true,
      attributionControl: false,
    })
    L.tileLayer(SATELLITE, { maxZoom: 22, maxNativeZoom: 19 }).addTo(m)
    layers.current = L.layerGroup().addTo(m)
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m || located.length === 0) return
    const bounds = L.latLngBounds(
      located.map((p) => [p.lat as number, p.lon as number]),
    )
    m.fitBounds(bounds, { padding: [20, 20], maxZoom: 21 })
  }, [located])

  useEffect(() => {
    const g = layers.current
    if (!g) return
    g.clearLayers()
    const ll = (p: TrackPoint): L.LatLngTuple => [
      p.lat as number,
      p.lon as number,
    ]
    L.polyline(located.map(ll), { color: "#94a3b8", weight: 2 }).addTo(g)
    const index = new Map(located.map((p, i) => [p.image, i]))
    for (const plot of plots) {
      const a = plot.start_image ? index.get(plot.start_image) : undefined
      const b = plot.end_image ? index.get(plot.end_image) : undefined
      if (a == null || b == null) continue
      const [s, e] = a <= b ? [a, b] : [b, a]
      L.polyline(located.slice(s, e + 1).map(ll), {
        color: "#16a34a",
        weight: 5,
      })
        .bindTooltip(`Plot ${plot.plot_id}`)
        .addTo(g)
    }
    const cur = located.find((p) => p.image === current)
    if (cur)
      L.circleMarker(ll(cur), {
        radius: 7,
        color: "#fff",
        weight: 2,
        fillColor: "#facc15",
        fillOpacity: 1,
      }).addTo(g)
  }, [located, plots, current])

  // The container is always rendered so the map exists before the track
  // arrives; an empty track just gets a notice on top.
  return (
    <div className="relative h-full min-h-[420px] w-full">
      <div ref={el} className="absolute inset-0" data-testid="pm-gps-map" />
      {located.length === 0 && (
        <div className="bg-background/90 text-muted-foreground absolute inset-0 z-[500] flex flex-col items-center justify-center gap-2 p-4 text-center text-sm">
          <MapIcon className="h-8 w-8 opacity-40" />
          <p>No GPS in this track's msgs_synced.csv.</p>
        </div>
      )}
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

interface PlotMarkerProps {
  run: Run
  scope: AerialScope | null
  onSaved: () => void
  onCancel: () => void
}

/** Every plot as a thin segment: where the work stands, and a quick way to
 *  jump. Green: start and end marked · amber: needs a look (moved, or a frame
 *  that is not in this track) · grey: not marked. A ring: checked (blue) or
 *  corrected (orange). The current plot stands taller. */
function PlotStrip({
  plots,
  current,
  imageSet,
  onPick,
}: {
  plots: PlotSelection[]
  current: number
  imageSet: Set<string>
  onPick: (i: number) => void
}) {
  return (
    <div className="flex h-3 w-full items-center gap-px" data-testid="pm-strip">
      {plots.map((p, i) => {
        const warn =
          p.translated ||
          (isComplete(p) &&
            (!imageSet.has(p.start_image as string) ||
              !imageSet.has(p.end_image as string)))
        const colour = warn
          ? "bg-amber-400"
          : isComplete(p)
            ? "bg-green-500"
            : "bg-muted-foreground/25"
        const ring =
          p.review === "corrected"
            ? "outline outline-1 outline-orange-400"
            : p.review === "ok"
              ? "outline outline-1 outline-sky-500"
              : ""
        return (
          <button
            type="button"
            key={p.plot_id}
            onClick={() => onPick(i)}
            className={`min-w-px flex-1 rounded-[1px] transition-all hover:opacity-80 ${colour} ${ring} ${
              i === current ? "h-3 ring-2 ring-primary" : "h-1.5"
            }`}
            title={`Plot ${p.plot_id}${isComplete(p) ? "" : " · not marked"}${warn ? " · needs a look" : ""}${p.review === "ok" ? " · checked" : p.review === "corrected" ? " · corrected" : ""}`}
            aria-label={`Plot ${p.plot_id}`}
          />
        )
      })}
    </div>
  )
}

export function PlotMarker({ run, scope, onCancel }: PlotMarkerProps) {
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const queryClient = useQueryClient()
  const directory = scope ? plotMarkingsDirectory(scope) : ""

  const {
    tracks,
    track,
    setTrackKey,
    points,
    images,
    isReady: trackReady,
    isLoading: framesLoading,
  } = useGroundTrack(scope, run.uploadScope?.datasetShortIds)
  const imageSet = useMemo(() => new Set(images), [images])
  const directionByImage = useMemo(
    () => new Map(points.map((p) => [p.image, p.direction])),
    [points],
  )

  const versions = useQuery<VersionRow[]>({
    queryKey: ["plot-markings", directory],
    queryFn: async () =>
      ((await PlotGeometryService.apiPlotGeometryVersionsListListVersions({
        requestBody: { directory },
      })) as unknown as VersionRow[]) ?? [],
    enabled: isLoggedIn() && Boolean(directory),
  })

  const [plots, setPlots] = useState<PlotSelection[]>([emptyPlot(1)])
  // Plots per frame (two when each frame shows one plot above another).
  const [layout, setLayout] = useState<FrameLayout>(SINGLE_LANE)
  const [activeVersion, setActiveVersion] = useState<number | null>(null)
  const [translatedBanner, setTranslatedBanner] = useState(false)
  const loadedRef = useRef(false)
  const dirtyRef = useRef(false)
  const edit = useCallback((fn: (prev: PlotSelection[]) => PlotSelection[]) => {
    dirtyRef.current = true
    setPlots(fn)
  }, [])

  const loadVersion = useCallback(
    async (version: number | undefined) => {
      try {
        const res =
          (await PlotGeometryService.apiPlotGeometryVersionsLoadLoadVersion({
            requestBody: { directory, ...(version ? { version } : {}) },
          })) as { version: number; state_snapshot: PlotMarkingSnapshot }
        const saved = res.state_snapshot?.selections ?? []
        const { selections, translated } = translateMarkings(
          saved,
          imageSet,
          points,
        )
        setPlots(selections.length ? selections : [emptyPlot(1)])
        setLayout(res.state_snapshot?.layout ?? SINGLE_LANE)
        setActiveVersion(res.version)
        setTranslatedBanner(translated)
        dirtyRef.current = false
      } catch {
        showErrorToast("Couldn't load that plot-marking version")
      }
    },
    [directory, imageSet, points, showErrorToast],
  )

  // Start from the active version once the track (for GPS remapping) is in.
  useEffect(() => {
    if (loadedRef.current || !versions.isSuccess || images.length === 0) return
    if (!trackReady) return
    loadedRef.current = true
    if ((versions.data ?? []).length > 0) void loadVersion(undefined)
  }, [
    versions.isSuccess,
    versions.data,
    images.length,
    trackReady,
    loadVersion,
  ])

  const [currentIdx, setCurrentIdx] = useState(0)
  const [step, setStep] = useState(1)
  const [plotPage, setPlotPage] = useState(0)
  const [plotNavInput, setPlotNavInput] = useState("1")
  const [showGps, setShowGps] = useState(false)
  const [dangerOpen, setDangerOpen] = useState(false)
  const [directionWarning, setDirectionWarning] = useState<
    null | "save" | "saveAs"
  >(null)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [saveAsName, setSaveAsName] = useState("")
  const [unsavedOpen, setUnsavedOpen] = useState(false)

  useEffect(() => setPlotNavInput(String(plotPage + 1)), [plotPage])
  useEffect(() => {
    if (plotPage > plots.length - 1) setPlotPage(Math.max(0, plots.length - 1))
  }, [plots.length, plotPage])

  const activePlot = plots[plotPage] ?? null
  const currentImage = images[currentIdx] ?? null
  const frame = useFrameUrl(track?.imagesPrefix ?? "", images, currentIdx, step)

  const prev = useCallback(
    () => setCurrentIdx((i) => Math.max(0, i - step)),
    [step],
  )
  const next = useCallback(
    () => setCurrentIdx((i) => Math.min(images.length - 1, i + step)),
    [images.length, step],
  )
  const setOnActive = useCallback(
    (patch: Partial<PlotSelection>) =>
      edit((ps) =>
        ps.map((p, i) =>
          i === plotPage
            ? {
                ...p,
                ...patch,
                translated: undefined,
                // a moved marker is a correction of what was there
                ...("start_image" in patch || "end_image" in patch
                  ? { review: "corrected" as const }
                  : {}),
              }
            : p,
        ),
      ),
    [edit, plotPage],
  )
  /** Show plot i: select it and put its start frame in the viewer. */
  const goToPlot = useCallback(
    (i: number) => {
      const p = plots[i]
      if (!p) return
      setPlotPage(i)
      const at = p.start_image ? images.indexOf(p.start_image) : -1
      if (at >= 0) setCurrentIdx(at)
    },
    [plots, images],
  )
  /** "Looks right": mark reviewed, then the next plot nobody has checked. */
  const approve = useCallback(() => {
    edit((ps) =>
      ps.map((p, i) =>
        i === plotPage ? { ...p, review: p.review ?? "ok" } : p,
      ),
    )
    const after = plots.findIndex((p, i) => i > plotPage && !p.review)
    const before = plots.findIndex((p, i) => i < plotPage && !p.review)
    const nextIdx = after >= 0 ? after : before
    if (nextIdx >= 0) goToPlot(nextIdx)
  }, [edit, plots, plotPage, goToPlot])
  const markStart = useCallback(() => {
    if (currentImage) setOnActive({ start_image: currentImage })
  }, [currentImage, setOnActive])
  const markEnd = useCallback(() => {
    if (currentImage) setOnActive({ end_image: currentImage })
  }, [currentImage, setOnActive])
  const addPlot = useCallback(() => {
    edit((ps) => {
      const at = plotPage + 1
      const dir = ps[plotPage]?.direction ?? ""
      return renumber([...ps.slice(0, at), emptyPlot(0, dir), ...ps.slice(at)])
    })
    setPlotPage((p) => p + 1)
  }, [edit, plotPage])
  const deletePlot = useCallback(() => {
    edit((ps) =>
      ps.length <= 1 ? ps : renumber(ps.filter((_, i) => i !== plotPage)),
    )
  }, [edit, plotPage])
  const jumpTo = (name: string | null) => {
    const i = name ? images.indexOf(name) : -1
    if (i >= 0) setCurrentIdx(i)
  }

  const incomplete = plots.filter((p) => !isComplete(p))
  const canSave = plots.length > 0 && incomplete.length === 0 && Boolean(track)

  const save = useMutation({
    mutationFn: async (opts: { asNew: boolean; name?: string }) => {
      if (!track) throw new Error("No track")
      const snapshot: PlotMarkingSnapshot = {
        selections: withGps(plots, points),
        track: {
          imagesPrefix: track.imagesPrefix,
          msgsSyncedPath: track.msgsSyncedPath,
        },
        ...(layout.lanes > 1 ? { layout } : {}),
      }
      return (await PlotGeometryService.apiPlotGeometryVersionsSaveSaveVersion({
        requestBody: {
          directory,
          state_snapshot: snapshot as unknown as Record<string, unknown>,
          ...(opts.name ? { name: opts.name } : {}),
          ...(!opts.asNew && activeVersion ? { version: activeVersion } : {}),
        },
      })) as { version: number }
    },
    onSuccess: (res, opts) => {
      dirtyRef.current = false
      setActiveVersion(res.version)
      setTranslatedBanner(false)
      setPlots((ps) => ps.map((p) => ({ ...p, translated: undefined })))
      queryClient.invalidateQueries({ queryKey: ["plot-markings", directory] })
      setStepState(run.id, "plot_marking", {
        status: "completed",
        completedAt: new Date().toISOString(),
        outputs: { directory, version: res.version, plots: plots.length },
      })
      showSuccessToast(
        opts.asNew
          ? `Saved plot markings as version ${res.version}`
          : `Saved ${plots.length} plot marking${plots.length === 1 ? "" : "s"}`,
      )
    },
    onError: (e) =>
      showErrorToast(
        e instanceof Error ? `Couldn't save: ${e.message}` : "Couldn't save",
      ),
  })

  const startSave = (kind: "save" | "saveAs") => {
    if (plots.some((p) => !p.direction)) {
      setDirectionWarning(kind)
      return
    }
    if (kind === "saveAs") {
      setSaveAsName("")
      setSaveAsOpen(true)
    } else save.mutate({ asNew: false })
  }
  const saveRef = useRef(startSave)
  saveRef.current = startSave
  const canSaveRef = useRef(canSave)
  canSaveRef.current = canSave

  const deleteVersion = async (version: number) => {
    try {
      await PlotGeometryService.apiPlotGeometryVersionsDeleteDeleteVersion({
        requestBody: { directory, version },
      })
      await queryClient.invalidateQueries({
        queryKey: ["plot-markings", directory],
      })
      const rest = (versions.data ?? []).filter((v) => v.version !== version)
      if (rest.length) void loadVersion(rest[0].version)
      else {
        setActiveVersion(null)
        setPlots([emptyPlot(1)])
      }
    } catch {
      showErrorToast("Couldn't delete that version")
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        if (canSaveRef.current) saveRef.current("save")
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (e.key === "ArrowLeft") prev()
      else if (e.key === "ArrowRight") next()
      else if (k === "s") markStart()
      else if (k === "e") markEnd()
      else if (k === "n") addPlot()
      else if (k === "d") deletePlot()
      else if (k === "y") approve()
      else if (e.key === "[") goToPlot(Math.max(0, plotPage - 1))
      else if (e.key === "]") goToPlot(Math.min(plots.length - 1, plotPage + 1))
      else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [
    prev,
    next,
    markStart,
    markEnd,
    addPlot,
    deletePlot,
    approve,
    goToPlot,
    plotPage,
    plots.length,
  ])

  if (!scope)
    return (
      <p className="text-muted-foreground text-sm">
        This run has no upload scope.
      </p>
    )
  if (framesLoading)
    return (
      <div className="text-muted-foreground flex h-64 items-center justify-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading frames…
      </div>
    )
  if (!track || images.length === 0)
    return (
      <div
        className="text-muted-foreground flex h-64 flex-col items-center justify-center gap-2"
        data-testid="pm-no-frames"
      >
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm">No extracted rover frames found for this run.</p>
        <p className="text-xs">
          Upload the Amiga .bin log under Files and wait for extraction to
          finish.
        </p>
        <p className="font-mono text-xs">{rawScopePrefix(scope)}</p>
      </div>
    )

  const doneCount = plots.filter(isComplete).length
  const heading = currentImage ? directionByImage.get(currentImage) : null

  return (
    <>
      <div className="space-y-3" data-testid="plot-marker">
        <div className="bg-muted/40 text-muted-foreground flex flex-wrap items-center justify-between gap-2 rounded px-3 py-1.5 text-xs">
          <span>
            <kbd className="bg-background rounded border px-1">←</kbd>
            <kbd className="bg-background ml-1 rounded border px-1">→</kbd>{" "}
            navigate ·{" "}
            <kbd className="bg-background rounded border px-1">S</kbd> start ·{" "}
            <kbd className="bg-background rounded border px-1">E</kbd> end ·{" "}
            <kbd className="bg-background rounded border px-1">N</kbd> new plot
            · <kbd className="bg-background rounded border px-1">D</kbd> delete
            plot · <kbd className="bg-background rounded border px-1">Ctrl</kbd>
            +<kbd className="bg-background rounded border px-1">S</kbd> save
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex items-center gap-1"
              data-testid="pm-layout"
              title="Some rover passes see more than one plot at once, e.g. one plot in the top half of every frame and the next bed's plot in the bottom half. Mark each stretch once: it is stitched as one plot per band of the frame (the blue boxes), each placed beside the GPS line by where its band sits. Save to keep this."
            >
              <span className="text-foreground">Plots per frame</span>
              {[1, 2, 3, 4].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={layout.lanes === n ? "default" : "outline"}
                  className="h-6 w-6 p-0 text-xs"
                  onClick={() => {
                    dirtyRef.current = true
                    setLayout((l) => ({ ...l, lanes: n }))
                  }}
                  data-testid={`pm-lanes-${n}`}
                >
                  {n}
                </Button>
              ))}
              {layout.lanes > 1 &&
                (
                  [
                    ["top_bottom", "Top / bottom"],
                    ["left_right", "Left / right"],
                  ] as const
                ).map(([v, label]) => (
                  <Button
                    key={v}
                    size="sm"
                    variant={layout.split === v ? "secondary" : "ghost"}
                    className="h-6 px-2 text-xs"
                    onClick={() => {
                      dirtyRef.current = true
                      setLayout((l) => ({ ...l, split: v }))
                    }}
                  >
                    {label}
                  </Button>
                ))}
            </div>
            {tracks.length > 1 && (
              <Select
                value={track.imagesPrefix}
                onValueChange={(v) => {
                  setTrackKey(v)
                  setCurrentIdx(0)
                }}
              >
                <SelectTrigger
                  className="h-6 w-44 text-xs"
                  data-testid="pm-track-select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tracks.map((t) => (
                    <SelectItem
                      key={t.imagesPrefix}
                      value={t.imagesPrefix}
                      className="text-xs"
                    >
                      Dataset {t.dataset} ({t.images.length} frames)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <button
              type="button"
              data-testid="pm-gps-toggle"
              onClick={() => setShowGps((v) => !v)}
              className={`flex items-center gap-1 rounded px-2 py-0.5 transition-colors ${
                showGps
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
            >
              <MapIcon className="h-3.5 w-3.5" />
              {showGps ? "Hide GPS map" : "GPS map"}
            </button>
          </div>
        </div>

        <AutoMarkBar
          runId={run.id}
          hasPlots={plots.length > 0}
          onSaved={() => {
            loadedRef.current = false
            void versions.refetch().then(() => loadVersion(undefined))
          }}
        />

        {!track.msgsSyncedPath && (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800 text-xs">
            This dataset has no msgs_synced.csv, so frames have no GPS: markings
            can't be georeferenced or reused on another date.
          </p>
        )}
        {translatedBanner && (
          <div
            className="flex items-start gap-2 rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-800"
            data-testid="pm-translated-banner"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
            <span className="flex-1">
              These plot markings were made on another track and have been moved
              to the nearest frames here by GPS. Check each plot's start and
              end, then save to keep them.
            </span>
            <button type="button" onClick={() => setTranslatedBanner(false)}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <div
          className={`grid gap-4 ${showGps ? "lg:grid-cols-[1fr_3fr_1fr]" : "lg:grid-cols-[3fr_1fr]"}`}
        >
          {showGps && (
            <div
              className="overflow-hidden rounded-lg border"
              style={{ minHeight: 420 }}
            >
              <GpsTrackMap
                points={points}
                current={currentImage}
                plots={plots}
              />
            </div>
          )}

          {/* Frame viewer */}
          <div className="space-y-2">
            <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-black">
              {frame.failed ? (
                <span className="text-sm text-white/60">
                  Couldn't load {currentImage}
                </span>
              ) : frame.url ? (
                <img
                  src={frame.url}
                  alt={currentImage ?? ""}
                  data-testid="pm-frame"
                  className="h-full w-full object-contain"
                  draggable={false}
                />
              ) : (
                <Loader2 className="h-6 w-6 animate-spin text-white/60" />
              )}
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 border-red-500/70 border-l-2 border-dashed" />
                <div className="absolute top-1/2 right-0 left-0 -translate-y-1/2 border-red-500/70 border-t-2 border-dashed" />
              </div>
              {layout.lanes > 1 && (
                // Where the frame is divided between the plots it shows.
                <div
                  className="pointer-events-none absolute inset-0"
                  data-testid="pm-lanes"
                >
                  {Array.from({ length: layout.lanes }, (_, i) => {
                    const lane = i + 1
                    const at = `${(i / layout.lanes) * 100}%`
                    const size = `${100 / layout.lanes}%`
                    const box =
                      layout.split === "left_right"
                        ? { left: at, width: size, top: 0, bottom: 0 }
                        : { top: at, height: size, left: 0, right: 0 }
                    return (
                      <div
                        key={lane}
                        className="absolute border-2 border-sky-400/80"
                        style={box}
                      >
                        <span className="absolute top-1 right-1 rounded bg-sky-500/80 px-1 text-[10px] text-white">
                          {activePlot
                            ? `plot ${lanePlotId(activePlot.plot_id, lane, layout)}`
                            : laneName(lane, layout)}{" "}
                          · {laneName(lane, layout)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
              {activePlot?.start_image === currentImage && (
                <Badge className="absolute top-2 left-2 bg-green-600 text-white">
                  START
                </Badge>
              )}
              {activePlot?.end_image === currentImage && (
                <Badge className="absolute top-2 right-2 bg-red-600 text-white">
                  END
                </Badge>
              )}
              {heading && (
                <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
                  Heading {heading}
                </span>
              )}
              {currentImage && track && (
                <button
                  type="button"
                  className="absolute right-2 bottom-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white hover:bg-black/80"
                  onClick={() =>
                    openFullImage(`${track.imagesPrefix}${currentImage}`)
                  }
                  title="This view is a reduced copy for quick stepping; open the camera's full frame"
                >
                  Full size
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={prev}
                disabled={currentIdx === 0}
                aria-label="Previous frame"
                data-testid="pm-prev"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-0 flex-1 text-center">
                <div
                  className="text-muted-foreground truncate font-mono text-xs"
                  data-testid="pm-frame-name"
                >
                  {currentImage ?? "—"}
                </div>
                <div className="flex items-center justify-center gap-1 font-semibold text-xs tabular-nums">
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label="Frame number"
                    data-testid="pm-frame-index"
                    value={String(currentIdx + 1)}
                    onChange={(e) => {
                      const n = Number.parseInt(e.target.value, 10)
                      if (!Number.isNaN(n) && n >= 1 && n <= images.length)
                        setCurrentIdx(n - 1)
                    }}
                    onFocus={(e) => e.target.select()}
                    className="border-muted-foreground/40 focus:border-primary w-10 border-b bg-transparent text-center outline-none"
                  />
                  <span data-testid="pm-frame-count">/ {images.length}</span>
                </div>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={next}
                disabled={currentIdx === images.length - 1}
                aria-label="Next frame"
                data-testid="pm-next"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="text-muted-foreground flex items-center justify-end gap-1 text-xs">
              <span>Step:</span>
              <Select
                value={String(step)}
                onValueChange={(v) => setStep(Number(v))}
              >
                <SelectTrigger
                  className="h-6 w-14 px-2 text-xs"
                  data-testid="pm-step"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 5, 10].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button
                className="flex-1"
                variant={
                  activePlot?.start_image === currentImage
                    ? "default"
                    : "outline"
                }
                onClick={markStart}
                disabled={!currentImage}
                data-testid="pm-mark-start"
              >
                <Flag className="mr-2 h-4 w-4 text-green-600" />
                Mark Start
              </Button>
              <Button
                className="flex-1"
                variant={
                  activePlot?.end_image === currentImage ? "default" : "outline"
                }
                onClick={markEnd}
                disabled={!currentImage}
                data-testid="pm-mark-end"
              >
                <FlagOff className="mr-2 h-4 w-4 text-red-600" />
                Mark End
              </Button>
            </div>
          </div>

          {/* Plot pager: one place to move between plots */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Previous plot"
                  onClick={() => goToPlot(Math.max(0, plotPage - 1))}
                  disabled={plotPage === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Label className="whitespace-nowrap text-sm font-medium">
                  Plot
                </Label>
                <Input
                  type="number"
                  min={1}
                  max={plots.length}
                  value={plotNavInput}
                  aria-label="Plot number"
                  // No up/down arrows: the ‹ › buttons and arrow keys step plots.
                  className="h-7 w-12 [appearance:textfield] text-center text-xs [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  onChange={(e) => setPlotNavInput(e.target.value)}
                  onBlur={() => {
                    const n = Number.parseInt(plotNavInput, 10)
                    if (n >= 1 && n <= plots.length) goToPlot(n - 1)
                    else setPlotNavInput(String(plotPage + 1))
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                  }}
                />
                <span
                  className="text-muted-foreground whitespace-nowrap text-xs"
                  data-testid="pm-plot-label"
                >
                  / {plots.length}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Next plot"
                  onClick={() =>
                    goToPlot(Math.min(plots.length - 1, plotPage + 1))
                  }
                  disabled={plotPage === plots.length - 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                {activePlot && isComplete(activePlot) ? (
                  <Check
                    className="h-3.5 w-3.5 shrink-0 text-green-600"
                    aria-label="Start and end marked"
                  />
                ) : null}
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    title="Add plot (N)"
                    aria-label="Add plot"
                    data-testid="pm-add-plot"
                    onClick={addPlot}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="text-muted-foreground hover:border-destructive hover:text-destructive h-7 w-7"
                    title="Delete current plot (D)"
                    aria-label="Delete plot"
                    data-testid="pm-delete-plot"
                    onClick={deletePlot}
                    disabled={plots.length <= 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <PlotStrip
                plots={plots}
                current={plotPage}
                imageSet={imageSet}
                onPick={goToPlot}
              />
              <p
                className="text-muted-foreground text-xs"
                data-testid="pm-done-count"
              >
                {doneCount}/{plots.length} marked ·{" "}
                {plots.filter((p) => p.review).length} checked
              </p>
            </div>

            <Card className="border-primary/40 py-3">
              <CardContent className="space-y-3 px-3">
                {activePlot && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      {(["start_image", "end_image"] as const).map((key) => (
                        <FrameThumb
                          key={key}
                          prefix={track?.imagesPrefix ?? ""}
                          name={activePlot[key]}
                          label={key === "start_image" ? "Start" : "End"}
                          active={activePlot[key] === currentImage}
                          onClick={() => jumpTo(activePlot[key])}
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-7 flex-1"
                        variant={activePlot.review ? "secondary" : "default"}
                        disabled={!isComplete(activePlot)}
                        data-testid="pm-approve"
                        title="Mark this plot checked and go to the next one (Y)"
                        onClick={approve}
                      >
                        <Check className="mr-1 h-3.5 w-3.5" />
                        {activePlot.review === "corrected"
                          ? "Corrected · next (Y)"
                          : activePlot.review === "ok"
                            ? "Checked · next (Y)"
                            : "Looks right · next (Y)"}
                      </Button>
                    </div>
                    {(["start_image", "end_image"] as const).map((key) => {
                      const value = activePlot[key]
                      const missing = value != null && !imageSet.has(value)
                      const isStart = key === "start_image"
                      return (
                        <div className="flex items-center gap-1" key={key}>
                          <Label className="text-muted-foreground w-8 shrink-0 text-xs">
                            {isStart ? "Start" : "End"}
                          </Label>
                          {value && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 shrink-0"
                              title="Jump to"
                              aria-label={`Jump to ${isStart ? "start" : "end"}`}
                              disabled={missing}
                              onClick={() => jumpTo(value)}
                            >
                              <ChevronRight className="h-3 w-3" />
                            </Button>
                          )}
                          <span
                            data-testid={isStart ? "pm-start" : "pm-end"}
                            className={`min-w-0 flex-1 truncate font-mono text-xs ${
                              missing
                                ? "text-amber-600"
                                : isStart
                                  ? "text-green-700 dark:text-green-400"
                                  : "text-red-700 dark:text-red-400"
                            }`}
                          >
                            {value ?? "—"}
                          </span>
                          {missing && (
                            <AlertCircle
                              className="h-3 w-3 shrink-0 text-amber-500"
                              aria-label="Frame not in this track"
                            />
                          )}
                          {value && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive h-5 w-5 shrink-0"
                              title={`Clear ${isStart ? "start" : "end"}`}
                              onClick={() => setOnActive({ [key]: null })}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      )
                    })}

                    {layout.lanes > 1 && (
                      <p
                        className="text-muted-foreground text-xs"
                        data-testid="pm-lane-plots"
                      >
                        This stretch is stitched as{" "}
                        {Array.from(
                          { length: layout.lanes },
                          (_, i) =>
                            `plot ${lanePlotId(activePlot.plot_id, i + 1, layout)} (${laneName(i + 1, layout)})`,
                        ).join(", ")}
                        .
                      </p>
                    )}
                    <div className="flex items-center gap-2">
                      <Label
                        className="text-muted-foreground shrink-0 text-xs"
                        htmlFor="pm-direction"
                      >
                        Stitching direction
                      </Label>
                      <Select
                        value={activePlot.direction || "__none__"}
                        onValueChange={(v) =>
                          setOnActive({ direction: v === "__none__" ? "" : v })
                        }
                      >
                        <SelectTrigger
                          id="pm-direction"
                          data-testid="pm-direction"
                          className={`h-7 flex-1 text-xs ${activePlot.direction ? "" : "text-amber-600"}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem
                            value="__none__"
                            className="text-muted-foreground text-xs"
                          >
                            — Select direction —
                          </SelectItem>
                          {DIRECTIONS.map((d) => (
                            <SelectItem
                              key={d.value}
                              value={d.value}
                              className="text-xs"
                            >
                              {d.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {incomplete.length > 0 && (
              <p className="text-amber-600 text-xs">
                {incomplete.length} plot{incomplete.length === 1 ? "" : "s"}{" "}
                still need
                {incomplete.length === 1 ? "s" : ""} start/end marked.
              </p>
            )}

            {(versions.data ?? []).length > 0 && (
              <div className="flex items-center gap-1.5 pt-1">
                <Layers className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                <select
                  aria-label="Plot marking version"
                  data-testid="pm-version-select"
                  value={activeVersion ?? ""}
                  onChange={(e) => void loadVersion(Number(e.target.value))}
                  className="border-input bg-background min-w-0 flex-1 rounded border px-1.5 py-1 text-xs focus:outline-none"
                >
                  {activeVersion == null && <option value="">—</option>}
                  {(versions.data ?? []).map((v) => (
                    <option key={v.version} value={v.version}>
                      {v.name ? `${v.name} (v${v.version})` : `v${v.version}`}
                    </option>
                  ))}
                </select>
                {activeVersion != null && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive h-6 w-6 shrink-0"
                    title="Delete this version"
                    aria-label="Delete this version"
                    onClick={() => void deleteVersion(activeVersion)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() =>
                  dirtyRef.current ? setUnsavedOpen(true) : onCancel()
                }
              >
                Back
              </Button>
              <Button
                variant="secondary"
                data-testid="pm-save"
                disabled={!canSave || save.isPending}
                onClick={() => startSave("save")}
              >
                {save.isPending ? "Saving…" : "Save"}
              </Button>
              <Button
                data-testid="pm-save-as"
                disabled={!canSave || save.isPending}
                onClick={() => startSave("saveAs")}
              >
                Save As
              </Button>
            </div>

            <div className="space-y-1.5 rounded-md border px-3 py-2">
              <button
                type="button"
                onClick={() => setDangerOpen((v) => !v)}
                className="text-muted-foreground hover:text-foreground flex w-full items-center justify-between text-xs"
              >
                <span>Danger zone</span>
                {dangerOpen ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </button>
              {dangerOpen && (
                <div className="space-y-1.5 pt-0.5">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 w-full text-xs"
                    onClick={() => {
                      edit(() => [emptyPlot(1)])
                      setPlotPage(0)
                      setDangerOpen(false)
                    }}
                  >
                    Clear All Plots
                  </Button>
                  <p className="text-center text-[10px] text-muted-foreground">
                    Resets to 1 empty plot so you can start fresh.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Dialog
        open={directionWarning != null}
        onOpenChange={(o) => !o && setDirectionWarning(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Missing stitching direction</DialogTitle>
            <DialogDescription>
              Some plots have no stitching direction; they will be stitched
              top-to-bottom ("Down"), which may not match how the rover moved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDirectionWarning(null)}>
              Go Back
            </Button>
            <Button
              onClick={() => {
                const kind = directionWarning
                setDirectionWarning(null)
                if (kind === "saveAs") {
                  setSaveAsName("")
                  setSaveAsOpen(true)
                } else save.mutate({ asNew: false })
              }}
            >
              Save Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={unsavedOpen}
        onOpenChange={(o) => !o && setUnsavedOpen(false)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Unsaved Changes</DialogTitle>
            <DialogDescription>
              You have unsaved plot markings. Leave without saving?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnsavedOpen(false)}>
              Stay
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setUnsavedOpen(false)
                onCancel()
              }}
            >
              Leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={saveAsOpen}
        onOpenChange={(o) => !o && setSaveAsOpen(false)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save As New Version</DialogTitle>
            <DialogDescription>
              Give this plot-marking version a name (optional).
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="pm-save-as-name" className="mb-1 block text-sm">
              Name
            </Label>
            <Input
              id="pm-save-as-name"
              placeholder="e.g. final, adjusted, retry"
              value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setSaveAsOpen(false)
                  save.mutate({
                    asNew: true,
                    name: saveAsName.trim() || undefined,
                  })
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveAsOpen(false)}>
              Cancel
            </Button>
            <Button
              data-testid="pm-save-as-confirm"
              onClick={() => {
                setSaveAsOpen(false)
                save.mutate({
                  asNew: true,
                  name: saveAsName.trim() || undefined,
                })
              }}
            >
              Save As
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
