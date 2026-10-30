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

import { useQueries, useQuery } from "@tanstack/react-query"
import { PanelRightClose, PanelRightOpen } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { type FileMetadata, FilesService } from "@/client"
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
import { NumberField } from "@/components/ui/number-field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { agentApi } from "@/features/agent/lib/agentApi"
import { BoundaryImportPicker } from "@/features/process/components/BoundaryImportPicker"
import type { OrthoLayer } from "@/features/process/components/BoundaryMap"
import { BoundaryMap } from "@/features/process/components/BoundaryMap"
import { FieldDesignUploadDialog } from "@/features/process/components/FieldDesignUploadDialog"
import { FieldMapPanel } from "@/features/process/components/FieldMapPanel"
import { SelectionActionBar } from "@/features/process/components/SelectionActionBar"
import {
  StitchPlacementPanel,
  useStitchPlacement,
} from "@/features/process/components/StitchPlacement"
import { VersionPicker } from "@/features/process/components/VersionPicker"
import { useDraftPersistence } from "@/features/process/hooks/useDraftPersistence"
import { useHistory } from "@/features/process/hooks/useHistory"
import {
  type PlotGeometryStateSnapshot,
  useActivatePlotGeometryVersion,
  useLoadPlotGeometryVersion,
  usePlotGeometryVersions,
  useSavePlotGeometryVersion,
} from "@/features/process/hooks/usePlotGeometry"
import {
  buildTitilerTileUrl,
  resolveActiveOrtho,
  s3UrlForOrtho,
  tilejsonBoundsToLeaflet,
} from "@/features/process/lib/activeOrtho"
import { outerFromOrthoBounds } from "@/features/process/lib/autoBoundary"
import {
  applyLabelsToFeatures,
  describeFacts,
  designFromFeatures,
  designPlotChecker,
  dimensionsFromDesign,
  type FdTransform,
  type FieldDesign,
  mergeLabelsIntoExisting,
  transformFromFacts,
} from "@/features/process/lib/fieldDesign"
import { plotsFromGeojson } from "@/features/process/lib/geojsonImport"
import {
  type FillPattern,
  generateGridFeatures,
} from "@/features/process/lib/grid"
import {
  mirrorFeatures,
  rotateFeatures,
  translateFeaturesMeters,
} from "@/features/process/lib/groupTransform"
import { folderOrthos, nearestRegions } from "@/features/process/lib/multiOrtho"
import type { AerialScope } from "@/features/process/lib/paths"
import {
  inFolder,
  processedPrefix,
  uploadedOrthosPrefix,
} from "@/features/process/lib/paths"
import {
  type BlockParams,
  DEFAULT_BLOCK_PARAMS,
  INITIAL_EDITOR_STATE,
  type PlotBoundaryEditorState,
} from "@/features/process/lib/plotBoundaryEditorState"
import {
  type Run,
  setStepState,
  useAllRuns,
} from "@/features/process/lib/runStore"
import useCustomToast from "@/hooks/useCustomToast"
import { titilerBase } from "@/lib/stack"

const DEFAULT_BUCKET = "gemini"

function nextSelection(
  prev: ReadonlyArray<string>,
  id: string,
  mode: "replace" | "toggle" | "add",
): string[] {
  if (mode === "replace") return [id]
  if (mode === "add") return prev.includes(id) ? [...prev] : [...prev, id]
  return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
}

function bboxOuterFromFeatures(
  fs: GeoJSON.Feature[],
): GeoJSON.Feature<GeoJSON.Polygon> | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let any = false
  for (const f of fs) {
    if (f.geometry?.type !== "Polygon") continue
    for (const [x, y] of (f.geometry as GeoJSON.Polygon).coordinates[0] as [
      number,
      number,
    ][]) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      any = true
    }
  }
  if (!any) return null
  return {
    type: "Feature",
    properties: { role: "outer" },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
          [minX, minY],
        ],
      ],
    },
  }
}

export interface PlotBoundaryPrepProps {
  run: Run
  scope: AerialScope
  onSaved?: () => void
  onCancel?: () => void
}

const PANEL_KEY = "gemi.boundaryPrep.panel"

/** The name a plot added by hand gets: one after the highest plot number
 *  (or "added-N" when plots are not numbered). It can be renamed. */
export function nextPlotName(features: GeoJSON.Feature[]): string {
  let max = 0
  let plots = 0
  for (const f of features) {
    const p = (f.properties ?? {}) as Record<string, unknown>
    if (p.role === "outer" || p.border === true) continue
    plots += 1
    const n = Number(p.plot)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max > 0 ? String(Math.trunc(max) + 1) : `added-${plots + 1}`
}

export function PlotBoundaryPrep({
  run,
  scope,
  onSaved,
  onCancel,
}: PlotBoundaryPrepProps) {
  const directory = useMemo(() => processedPrefix(scope), [scope])
  // The grid side panel can be hidden so the map gets the full width;
  // remembered across visits.
  const [panelOpen, setPanelOpen] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) !== "closed"
    } catch {
      return true
    }
  })
  const togglePanel = () =>
    setPanelOpen((open) => {
      try {
        localStorage.setItem(PANEL_KEY, open ? "closed" : "open")
      } catch {
        // remembered for this visit only
      }
      return !open
    })

  const history = useHistory<PlotBoundaryEditorState>(INITIAL_EDITOR_STATE, {
    limit: 50,
  })
  const {
    features,
    blocks,
    activeBlockId,
    pendingDefaultParams,
    gridMode,
    fieldDesign,
  } = history.state

  // UI-only state — not part of editor history.
  // What the editor last loaded: one of this directory's versions, or one
  // imported from another directory (another date / sensor / experiment).
  const [loadSource, setLoadSource] = useState<{
    directory: string
    version: number
  } | null>(null)
  // Boundaries brought from another date and moved onto this map (not saved yet).
  const [importedSnapshot, setImportedSnapshot] =
    useState<PlotGeometryStateSnapshot | null>(null)
  const [versionName, setVersionName] = useState("")
  // Bumped when boundaries are loaded or imported: the map zooms to them.
  const [fitSignal, setFitSignal] = useState(0)
  const [fdDialogOpen, setFdDialogOpen] = useState(false)
  // How the design dialog opens: on the field's known design, or on a field map sheet.
  const [fdDialogStart, setFdDialogStart] = useState<
    "upload" | "preset" | "fieldmap"
  >("upload")
  // Map view: plots shown and how strongly, border positions, box select.
  const [showPlots, setShowPlots] = useState(true)
  const [plotOpacity, setPlotOpacity] = useState(1)
  const [showBorders, setShowBorders] = useState(true)
  const [boxSelect, setBoxSelect] = useState(false)
  // Move step for the selection, metres (buttons and arrow keys).
  const [nudgeStep, setNudgeStep] = useState(0.1)
  const nudgeStepRef = useRef(nudgeStep)
  nudgeStepRef.current = nudgeStep
  const [fieldMapOpen, setFieldMapOpen] = useState(false)
  // "Add a plot": the next shape drawn becomes a plot (not a new outline).
  const [addPlot, setAddPlotState] = useState(false)
  const addPlotRef = useRef(false)
  const addedRef = useRef(false)
  const setAddPlot = (on: boolean) => {
    addPlotRef.current = on
    setAddPlotState(on)
  }
  // The design this field already has (recorded with the agent for this run or
  // another date of the same field) and the orientation its facts give.
  const fieldInfo = useQuery({
    queryKey: ["agent", "field_designs", run.id],
    queryFn: () => agentApi.fieldDesigns(run.id),
    retry: false,
    staleTime: 60_000,
  })
  const fieldPreset = useMemo(() => {
    const facts = fieldInfo.data?.facts ?? {}
    const path = facts.design_path ?? fieldInfo.data?.suggested?.path
    if (!path || path === "stand-in") return null
    return {
      path,
      name: path.split(/[\\/]/).pop() ?? path,
      transform: transformFromFacts(facts),
      described: describeFacts(facts),
    }
  }, [fieldInfo.data])
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [draftBanner, setDraftBanner] = useState<{
    visible: boolean
    lastModifiedAt?: string
  }>({ visible: false })

  // Auto-save the editor state to localStorage on every change, with a
  // mount-time restore banner. Survives refresh, back button, and tab
  // close as long as the user hasn't explicitly discarded.
  const draftStorageKey = `gemini.plotBoundaryPrep.draft.v1::${directory}`
  const draftApi = useDraftPersistence<PlotBoundaryEditorState>({
    storageKey: draftStorageKey,
    state: history.state,
    runId: run.id,
    directory,
    isDirty: (s) =>
      s.features.length > 0 ||
      Object.keys(s.blocks).length > 0 ||
      s.fieldDesign !== null,
  })

  // Derived active-block params. Falls back to pending defaults (set
  // when a field design is loaded before any boundary is drawn), then
  // to global defaults, so the inputs always render something sensible.
  const activeParams: BlockParams =
    activeBlockId && blocks[activeBlockId]
      ? // Spread defaults under the stored block so blocks persisted
        // before rowOffset/colOffset/fillPattern existed still render
        // sensible values (undefined → default) instead of NaN inputs.
        // `blocks[activeBlockId]` is BlockParams, so its label is present.
        { ...DEFAULT_BLOCK_PARAMS, ...blocks[activeBlockId] }
      : {
          label: "",
          ...DEFAULT_BLOCK_PARAMS,
          ...(pendingDefaultParams ?? {}),
        }
  const { rows, cols, angle, gapMeters, rowOffset, colOffset, fillPattern } =
    activeParams
  const gapColMeters = activeParams.gapColMeters ?? gapMeters

  // History.state can change after a setter runs in this render; use a
  // ref to get the latest state inside callbacks without re-binding.
  const stateRef = useRef(history.state)
  stateRef.current = history.state

  function updateActiveParams(patch: Partial<BlockParams>) {
    const s = stateRef.current
    if (s.activeBlockId) {
      const prev = s.blocks[s.activeBlockId] ?? {
        label: s.blocks[s.activeBlockId]?.label ?? "",
        ...DEFAULT_BLOCK_PARAMS,
        ...(s.pendingDefaultParams ?? {}),
      }
      history.set(
        {
          ...s,
          blocks: {
            ...s.blocks,
            [s.activeBlockId]: { ...prev, ...patch },
          },
        },
        { tag: "params" },
      )
      return
    }
    // No active block yet: keep every setting (rows, cols, angle, gaps, plot
    // size, borders) for the first block drawn. Only rows and cols were kept
    // before, so an angle or gap typed before drawing the boundary was lost.
    history.set(
      {
        ...s,
        pendingDefaultParams: { ...(s.pendingDefaultParams ?? {}), ...patch },
      },
      { tag: "params" },
    )
  }
  const setRows = (v: number) => updateActiveParams({ rows: v })
  const setCols = (v: number) => updateActiveParams({ cols: v })
  const setAngle = (v: number) => updateActiveParams({ angle: v })
  const setGapMeters = (v: number) => updateActiveParams({ gapMeters: v })
  const setGapColMeters = (v: number) => updateActiveParams({ gapColMeters: v })
  const setRowOffset = (v: number) => updateActiveParams({ rowOffset: v })
  const setColOffset = (v: number) => updateActiveParams({ colOffset: v })
  const setFillPattern = (v: FillPattern) =>
    updateActiveParams({ fillPattern: v })

  // Reconcile an incoming feature list (from the map or grid generation)
  // with per-block state, returning the next EditorState. Mirrors the
  // three concerns of the original setFeatures: stamp fresh outers, drop
  // dead blocks, auto-select most-recently added outer.
  const buildNextStateForFeatures = useCallback(
    (
      base: PlotBoundaryEditorState,
      next: GeoJSON.Feature[],
    ): PlotBoundaryEditorState => {
      let nextActive: string | null = base.activeBlockId
      let newBlocks: Record<string, BlockParams> | null = null
      let highestNum = 0
      for (const id of Object.keys(base.blocks)) {
        const m = id.match(/^block-(\d+)$/)
        if (m) highestNum = Math.max(highestNum, Number(m[1]))
      }
      // Pass 1: stamp fresh outers.
      const stamped = next.map((f) => {
        if (f.geometry?.type !== "Polygon") return f
        const props = (f.properties ?? {}) as Record<string, unknown>
        if (props.role === "outer" || typeof props.blockId === "string")
          return f
        if (props.row !== undefined || props.col !== undefined) return f
        // "Add a plot": the shape just drawn is a plot of the selected block,
        // named after the highest plot number (renamed in the selection bar).
        if (addPlotRef.current && base.activeBlockId) {
          addPlotRef.current = false
          addedRef.current = true
          return {
            ...f,
            properties: {
              ...(f.properties ?? {}),
              blockId: base.activeBlockId,
              block:
                base.blocks[base.activeBlockId]?.label ?? base.activeBlockId,
              plot: nextPlotName(base.features),
              added: true,
            },
          }
        }
        highestNum += 1
        const newId = `block-${highestNum}`
        const label = `Block ${highestNum}`
        if (!newBlocks) newBlocks = { ...base.blocks }
        newBlocks[newId] = {
          label,
          ...DEFAULT_BLOCK_PARAMS,
          ...(base.pendingDefaultParams ?? {}),
        }
        nextActive = newId
        return {
          ...f,
          properties: {
            ...(f.properties ?? {}),
            role: "outer",
            blockId: newId,
            label,
          },
        }
      })
      // Pass 2: surviving block ids.
      const surviving = new Set<string>()
      for (const f of stamped) {
        const props = (f.properties ?? {}) as Record<string, unknown>
        if (props.role === "outer" && typeof props.blockId === "string") {
          surviving.add(props.blockId as string)
        }
      }
      // Pass 3: drop cells whose parent block is gone, then stamp a
      // stable cellId on every surviving cell so the selection state in
      // EditorState can reference cells by identity across edits. Prefer
      // a deterministic `${blockId}:${row}:${col}` so snapshots stay
      // diffable; fall back to a UUID when row/col are missing (legacy
      // imports / hand-drawn cells).
      const pruned = stamped
        .filter((f) => {
          const props = (f.properties ?? {}) as Record<string, unknown>
          if (props.role === "outer") return true
          const bid = typeof props.blockId === "string" ? props.blockId : null
          if (!bid) return true
          return surviving.has(bid)
        })
        .map((f) => {
          const props = (f.properties ?? {}) as Record<string, unknown>
          if (props.role === "outer") return f
          if (typeof props.cellId === "string") return f
          const bid = typeof props.blockId === "string" ? props.blockId : null
          const r = props.row
          const c = props.col
          const stable =
            bid &&
            (typeof r === "number" || typeof r === "string") &&
            (typeof c === "number" || typeof c === "string")
              ? `${bid}:${r}:${c}`
              : typeof crypto !== "undefined" && "randomUUID" in crypto
                ? (crypto as { randomUUID: () => string }).randomUUID()
                : `cell-${Math.random().toString(36).slice(2, 10)}`
          return {
            ...f,
            properties: { ...(f.properties ?? {}), cellId: stable },
          }
        })
      // Reconcile blocks dict.
      const baseBlocks = newBlocks ?? base.blocks
      let prunedBlocks: Record<string, BlockParams> = baseBlocks
      let blocksChanged = newBlocks !== null
      for (const id of Object.keys(baseBlocks)) {
        if (!surviving.has(id)) {
          if (!blocksChanged) {
            prunedBlocks = { ...baseBlocks }
            blocksChanged = true
          }
          delete prunedBlocks[id]
        }
      }
      if (nextActive && !surviving.has(nextActive)) {
        nextActive = surviving.values().next().value ?? null
      }
      // Prune selection to cells that still exist.
      const survivingCellIds = new Set<string>()
      for (const f of pruned) {
        const props = (f.properties ?? {}) as Record<string, unknown>
        if (typeof props.cellId === "string")
          survivingCellIds.add(props.cellId as string)
      }
      const nextSelected = base.selectedCellIds.filter((id) =>
        survivingCellIds.has(id),
      )
      return {
        ...base,
        features: pruned,
        blocks: blocksChanged ? prunedBlocks : base.blocks,
        activeBlockId: nextActive,
        pendingDefaultParams: newBlocks ? null : base.pendingDefaultParams,
        selectedCellIds:
          nextSelected.length === base.selectedCellIds.length
            ? base.selectedCellIds
            : nextSelected,
      }
    },
    [],
  )

  const setFeatures = useCallback(
    (next: GeoJSON.Feature[]) => {
      const nextState = buildNextStateForFeatures(stateRef.current, next)
      history.set(nextState, { tag: "features" })
    },
    [buildNextStateForFeatures, history],
  )

  // Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z (or Ctrl+Y) redo. The focus check
  // is what keeps native text-undo working inside form inputs: when the
  // user is typing in a textbox, this handler bails and the browser (or
  // Tauri WebView) handles undo as a text-edit operation.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return
      }
      const mod = e.metaKey || e.ctrlKey
      // Arrow keys move the selected plots by the move step (Shift: ten steps).
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, 1],
        ArrowDown: [0, -1],
      }
      if (!mod && arrows[e.key] && stateRef.current.selectedCellIds.length) {
        e.preventDefault()
        const step = nudgeStepRef.current * (e.shiftKey ? 10 : 1)
        const [ex, ny] = arrows[e.key]
        nudgeRef.current(ex * step, ny * step)
        return
      }
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === "z" && !e.shiftKey) {
        e.preventDefault()
        history.undo()
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault()
        history.redo()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [history.undo, history.redo])

  // Tauri Edit menu (when present): listen for editor:undo / editor:redo
  // events emitted by the native menu. The menu items don't register
  // accelerators, so Cmd-Z still flows through the window keydown above
  // (and so native text-undo inside form inputs keeps working).
  useEffect(() => {
    const w = window as unknown as { __TAURI_INTERNALS__?: unknown }
    if (!w.__TAURI_INTERNALS__) return
    let unlistenUndo: (() => void) | undefined
    let unlistenRedo: (() => void) | undefined
    let cancelled = false
    ;(async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event")
        if (cancelled) return
        unlistenUndo = await listen("editor:undo", () => history.undo())
        unlistenRedo = await listen("editor:redo", () => history.redo())
      } catch {
        // Tauri APIs unavailable — fine, browser path covers it.
      }
    })()
    return () => {
      cancelled = true
      unlistenUndo?.()
      unlistenRedo?.()
    }
  }, [history.undo, history.redo])

  // One-time draft restore. If localStorage holds an unsaved draft for
  // this directory and the runId matches, hydrate the editor with it
  // and surface a banner so the user can opt out. `initialDraft` is
  // stable across renders (read once at mount), so an empty deps array
  // is correct here.
  const restoredRef = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only restore
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true
    const d = draftApi.initialDraft
    if (d && d.runId === run.id) {
      history.replace(d.state)
      history.clearHistory(d.state)
      setDraftBanner({ visible: true, lastModifiedAt: d.lastModifiedAt })
    }
  }, [])

  // No draft: open on the boundaries this scope already uses (its active
  // version), however they were made: by hand, imported, or by the agent.
  // Otherwise saved boundaries only appeared after picking them in Versions,
  // and the map stayed empty.
  const versionsForOpen = usePlotGeometryVersions(directory)
  const openedActiveRef = useRef(false)
  useEffect(() => {
    if (openedActiveRef.current || loadSource) return
    if (draftApi.initialDraft?.runId === run.id) {
      openedActiveRef.current = true
      return
    }
    const rows = versionsForOpen.data
    if (!rows) return
    openedActiveRef.current = true
    const active = rows.find((v) => v.is_active)
    if (active) setLoadSource({ directory, version: active.version })
  }, [
    versionsForOpen.data,
    loadSource,
    directory,
    run.id,
    draftApi.initialDraft,
  ])

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
  // Imported orthos stay in Raw/…/Orthomosaic/; without this listing
  // buildOrthoVersions drops them (it keeps only versions whose file it
  // can see), and a run on an imported ortho had nothing to draw over.
  // Same key as RunDetail's query, so they share the cache.
  const uploadedOrthosQuery = useQuery({
    queryKey: ["files", "list", scope ? uploadedOrthosPrefix(scope) : null],
    queryFn: async () =>
      scope
        ? inFolder(
            (await FilesService.apiFilesListFilePathListFiles({
              filePath: `${DEFAULT_BUCKET}/${uploadedOrthosPrefix(scope)}`,
            })) as FileMetadata[] | null,
            uploadedOrthosPrefix(scope),
          )
        : [],
    enabled: Boolean(scope),
  })
  const activeOrtho = useMemo(
    () =>
      resolveActiveOrtho(run, scope, [
        ...((filesQuery.data as FileMetadata[] | null) ?? []),
        ...(uploadedOrthosQuery.data ?? []),
      ]),
    [run, scope, filesQuery.data, uploadedOrthosQuery.data],
  )
  // Ground runs have no ortho; draw over the stitch version association
  // uses (the fullest) — its georeferenced combined mosaic (main's ground
  // underlay) — with its plots' outlines and GPS corrections on top.
  const placement = useStitchPlacement(
    (filesQuery.data as FileMetadata[] | null) ?? undefined,
    scope,
  )
  const groundMosaic = placement.version?.combinedMosaic ?? null
  const s3Url = activeOrtho
    ? s3UrlForOrtho(activeOrtho)
    : groundMosaic
      ? `s3://${DEFAULT_BUCKET}/${groundMosaic}`
      : null

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
        `${titilerBase()}/cog/WebMercatorQuad/tilejson.json?url=${encodeURIComponent(s3Url!)}&tilesize=256`,
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

  // Several orthomosaics in this date's folder (e.g. one flight per
  // treatment): show them all, each where it is nearer than the others'
  // centres, so one set of boundaries can be drawn across both.
  const allRuns = useAllRuns()
  const folderOrthoList = useMemo(() => {
    const all = folderOrthos(
      (filesQuery.data as FileMetadata[] | null) ?? [],
      directory,
    )
    // A flight re-run leaves its older orthomosaic beside the new one: keep
    // each run's latest (the runs on this date folder say which job that was).
    const latest = new Set(
      allRuns
        .filter((r) => {
          const u = r.uploadScope
          return (
            u &&
            scope &&
            u.date === scope.date &&
            u.location === scope.location &&
            u.population === scope.population &&
            u.experiment === scope.experiment &&
            u.platform === scope.platform
          )
        })
        // A run of several treatments has one current orthomosaic each.
        .flatMap((r) => [
          r.steps.orthomosaic?.jobIds?.at(-1),
          ...(r.uploadScope?.treatments ?? []).map((t) => t.orthoJobId),
        ])
        .filter((j): j is string => Boolean(j)),
    )
    const kept = all.filter((o) => o.jobId && latest.has(o.jobId))
    return kept.length ? kept : all
  }, [filesQuery.data, directory, allRuns, scope])
  const multi = folderOrthoList.length > 1
  const orthoInfos = useQueries({
    queries: (multi ? folderOrthoList : []).map((o) => ({
      queryKey: [
        "titiler",
        "tilejson",
        `s3://${DEFAULT_BUCKET}/${o.cogPath ?? o.path}`,
      ],
      queryFn: async () => {
        const url = `s3://${DEFAULT_BUCKET}/${o.cogPath ?? o.path}`
        const res = await fetch(
          `${titilerBase()}/cog/WebMercatorQuad/tilejson.json?url=${encodeURIComponent(url)}&tilesize=256`,
        )
        if (!res.ok) throw new Error(`TiTiler tilejson failed: ${res.status}`)
        return (await res.json()) as {
          bounds: [number, number, number, number]
        }
      },
      staleTime: 5 * 60_000,
    })),
  })
  const boundsKey = orthoInfos
    .map((q) => q.data?.bounds?.join(",") ?? "")
    .join("|")
  const orthoLayers = useMemo<OrthoLayer[] | undefined>(() => {
    if (!multi) return undefined
    const parts = boundsKey.split("|")
    if (parts.some((b) => !b)) return undefined
    const bs = parts.map(
      (b) => b.split(",").map(Number) as [number, number, number, number],
    )
    const centres = bs.map(
      (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] as [number, number],
    )
    const all: [number, number, number, number] = [
      Math.min(...bs.map((b) => b[0])),
      Math.min(...bs.map((b) => b[1])),
      Math.max(...bs.map((b) => b[2])),
      Math.max(...bs.map((b) => b[3])),
    ]
    const regions = nearestRegions(centres, all)
    return folderOrthoList.map((o, i) => ({
      id: o.path,
      url: buildTitilerTileUrl(`s3://${DEFAULT_BUCKET}/${o.cogPath ?? o.path}`),
      region: regions[i],
    }))
  }, [multi, folderOrthoList, boundsKey])
  const orthoLabels = useMemo(
    () =>
      folderOrthoList.map((o) => {
        const r = allRuns.find((x) =>
          (x.steps.orthomosaic?.jobIds ?? []).includes(o.jobId ?? "—"),
        )
        const t = r?.uploadScope?.treatments?.find(
          (x) => x.orthoJobId && x.orthoJobId === o.jobId,
        )
        return (
          t?.label ||
          r?.uploadScope?.batchLabel ||
          o.jobId?.slice(0, 8) ||
          "orthomosaic"
        )
      }),
    [folderOrthoList, allRuns],
  )

  // tilejson bounds: [west, south, east, north] in WGS84.
  // BoundaryMap wants [[south, west], [north, east]].
  const orthoBounds = useMemo<
    [[number, number], [number, number]] | undefined
  >(() => {
    if (multi) {
      const bs = boundsKey
        .split("|")
        .filter(Boolean)
        .map(
          (b) => b.split(",").map(Number) as [number, number, number, number],
        )
      if (!bs.length) return undefined
      return tilejsonBoundsToLeaflet([
        Math.min(...bs.map((b) => b[0])),
        Math.min(...bs.map((b) => b[1])),
        Math.max(...bs.map((b) => b[2])),
        Math.max(...bs.map((b) => b[3])),
      ])
    }
    const b = tilejsonQuery.data?.bounds
    return b ? tilejsonBoundsToLeaflet(b) : undefined
  }, [tilejsonQuery.data, multi, boundsKey])

  // Derived counts. The outer-boundary polygon is held in `features` (so
  // it renders/edits on the map) but isn't a plot — keep it out of the
  // count surfaced to the user and out of the save/clear gating.
  const plotFeatureCount = useMemo(
    () =>
      features.filter(
        (f) => f.properties?.role !== "outer" && f.properties?.border !== true,
      ).length,
    [features],
  )
  const borderCount = useMemo(
    () => features.filter((f) => f.properties?.border === true).length,
    [features],
  )

  const loaded = useLoadPlotGeometryVersion(
    loadSource?.directory ?? null,
    loadSource?.version ?? null,
  )
  useEffect(() => {
    const snapshot = importedSnapshot ?? loaded.data?.state_snapshot
    if (!snapshot) return
    const fc = snapshot.boundaries
    const grid = snapshot.grid
    const fd = snapshot.field_design

    let nextState: PlotBoundaryEditorState = stateRef.current
    if (fc?.features) {
      const loadedFeatures = fc.features as GeoJSON.Feature[]
      // Group loaded cells by blockId. Snapshots saved before multi-block
      // support don't carry blockId — bucket those into "block-1" so the
      // UI presents them as a single legacy block.
      const byBlock = new Map<string, GeoJSON.Feature[]>()
      for (const f of loadedFeatures) {
        const props = (f.properties ?? {}) as Record<string, unknown>
        const bid =
          typeof props.blockId === "string" ? (props.blockId as string) : null
        const key = bid ?? "block-1"
        const arr = byBlock.get(key) ?? []
        arr.push(f)
        byBlock.set(key, arr)
      }
      const outers: GeoJSON.Feature[] = []
      const taggedCells: GeoJSON.Feature[] = []
      const blockEntries: Record<string, BlockParams> = {}
      let blockNum = 0
      for (const [bid, cells] of byBlock.entries()) {
        blockNum += 1
        const numericMatch = bid.match(/^block-(\d+)$/)
        const n = numericMatch ? Number(numericMatch[1]) : blockNum
        const label = `Block ${n}`
        const outer = bboxOuterFromFeatures(cells)
        if (outer) {
          outer.properties = {
            ...(outer.properties ?? {}),
            role: "outer",
            blockId: bid,
            label,
          }
          outers.push(outer)
        }
        for (const c of cells) {
          taggedCells.push({
            ...c,
            properties: { ...(c.properties ?? {}), blockId: bid, block: label },
          })
        }
        blockEntries[bid] = {
          label,
          rows: grid?.rows ?? DEFAULT_BLOCK_PARAMS.rows,
          cols: grid?.cols ?? DEFAULT_BLOCK_PARAMS.cols,
          angle: grid?.angle_deg ?? DEFAULT_BLOCK_PARAMS.angle,
          gapMeters: grid?.spacing_m ?? DEFAULT_BLOCK_PARAMS.gapMeters,
          gapColMeters: grid?.spacing_col_m ?? undefined,
          rowOffset: grid?.row_offset ?? DEFAULT_BLOCK_PARAMS.rowOffset,
          colOffset: grid?.col_offset ?? DEFAULT_BLOCK_PARAMS.colOffset,
          fillPattern: grid?.fill_pattern ?? DEFAULT_BLOCK_PARAMS.fillPattern,
        }
      }
      nextState = {
        ...nextState,
        features: [...outers, ...taggedCells],
        blocks: blockEntries,
        activeBlockId: Object.keys(blockEntries)[0] ?? null,
        selectedCellIds: [],
      }
    }
    // Only a field design the editor itself saved (its parsed rows and the
    // row/column transform) can be reopened in the editor. A version made
    // elsewhere (the agent, an import) may carry just a note of where the
    // design came from: reopening that as a design crashed the page.
    if (
      fd &&
      Array.isArray((fd as { rows?: unknown }).rows) &&
      (fd as { transform?: unknown }).transform
    ) {
      nextState = { ...nextState, fieldDesign: fd, gridMode: "fd" }
    } else if (fc?.features) {
      // The agent notes which file its boundaries came from: keep that name.
      const source = (fd as { source?: unknown } | undefined)?.source
      // Boundaries saved without the editor's design (by the agent, or brought
      // from another date) whose plots carry their design labels: the design is
      // rebuilt from those, so the Field design panel opens filled in. Unflipped:
      // each plot keeps exactly its own labels.
      const rebuilt = designFromFeatures(nextState.features)
      if (rebuilt)
        nextState = {
          ...nextState,
          fieldDesign: {
            ...rebuilt,
            ...(typeof source === "string" && source !== "mock"
              ? { source }
              : {}),
          },
          gridMode: "fd",
        }
    }
    // Run the reconciled features through buildNextStateForFeatures so
    // cellIds get stamped on loaded cells (older snapshots predate the
    // cellId convention; without this, loaded grids would be unselectable).
    nextState = buildNextStateForFeatures(nextState, nextState.features)
    // Loading a version is a fresh baseline — wipe past/future so the
    // user can't undo back to "empty" through a load, and clear any
    // stale draft (the loaded version supersedes it).
    history.replace(nextState)
    history.clearHistory(nextState)
    draftApi.discardDraft()
    setDraftBanner({ visible: false })
    setFitSignal((n) => n + 1) // the map zooms to what was loaded
  }, [
    loaded.data,
    importedSnapshot,
    history.replace,
    history.clearHistory,
    draftApi.discardDraft,
    buildNextStateForFeatures,
  ])

  // A plot was just added: leave "Add a plot" and select it, to rename it.
  useEffect(() => {
    if (!addedRef.current) return
    addedRef.current = false
    setAddPlotState(false)
    const added = [...history.state.features]
      .reverse()
      .find(
        (f) =>
          f.properties?.added === true &&
          typeof f.properties?.cellId === "string",
      )
    if (added) {
      history.set(
        {
          ...history.state,
          selectedCellIds: [added.properties?.cellId as string],
        },
        { tag: "select" },
      )
      showSuccessToast(
        `Plot ${String(added.properties?.plot)} added. Rename it below, or keep the name.`,
      )
    }
  }, [history.state, history.set, showSuccessToast])

  // Field-design mode: the grid the design needs, and the active block's
  // drawn grid when it differs (after a swap of axes, or one drawn in Manual).
  const fdSize = fieldDesign ? dimensionsFromDesign(fieldDesign) : null
  const fdMismatch = (() => {
    if (!fdSize || !activeBlockId) return null
    // The grid's span, as the design's size is measured: a design may number
    // its plots from above 1 (tiers 2–26, beds 20–24), and plots brought from
    // another date keep those numbers.
    let minR = Number.POSITIVE_INFINITY
    let maxR = 0
    let minC = Number.POSITIVE_INFINITY
    let maxC = 0
    for (const f of features) {
      const p = (f.properties ?? {}) as Record<string, unknown>
      if (p.role === "outer" || p.blockId !== activeBlockId || p.border)
        continue
      const gr = Number(p._grid_row ?? p.row)
      const gc = Number(p._grid_col ?? p.col)
      if (!gr || !gc) continue
      minR = Math.min(minR, gr)
      maxR = Math.max(maxR, gr)
      minC = Math.min(minC, gc)
      maxC = Math.max(maxC, gc)
    }
    if (!maxR || !maxC) return null
    const r = maxR - minR + 1
    const c = maxC - minC + 1
    if (r === fdSize.rows && c === fdSize.cols) return null
    return { rows: r, cols: c }
  })()

  // The arrow keys (a mount-time listener) call the latest version through this.
  const nudgeRef = useRef<(eastM: number, northM: number) => void>(() => {})
  nudgeRef.current = nudgeSelection
  function nudgeSelection(eastM: number, northM: number) {
    const s = stateRef.current
    const sel = new Set(s.selectedCellIds)
    if (!sel.size) return
    history.set(
      {
        ...s,
        features: translateFeaturesMeters(s.features, sel, eastM, northM),
      },
      { tag: "nudge", coalesce: true },
    )
  }

  /** Every plot removed; the outer boundaries (blocks) stay, to generate again. */
  function clearPlotsKeepOutlines() {
    const s = stateRef.current
    history.set(
      {
        ...s,
        features: s.features.filter((f) => f.properties?.role === "outer"),
        selectedCellIds: [],
      },
      { tag: "clear-plots" },
    )
  }

  /** Plots from a GeoJSON file made elsewhere: a new block (its outline drawn
   *  around them), each plot keeping its properties. */
  const geojsonInputRef = useRef<HTMLInputElement | null>(null)
  async function importGeojson(file: File) {
    let plots: GeoJSON.Feature<GeoJSON.Polygon>[]
    try {
      plots = plotsFromGeojson(await file.text())
    } catch (e) {
      showErrorToast(e instanceof Error ? e.message : String(e))
      return
    }
    const s = stateRef.current
    const outer = bboxOuterFromFeatures(plots)
    if (!outer) return
    let n = 0
    for (const id of Object.keys(s.blocks)) {
      const m = id.match(/^block-(\d+)$/)
      if (m) n = Math.max(n, Number(m[1]))
    }
    const blockId = `block-${n + 1}`
    const label = `Block ${n + 1}`
    const features = [
      ...s.features,
      { ...outer, properties: { role: "outer", blockId, label } },
      ...plots.map((f) => ({
        ...f,
        properties: { ...f.properties, blockId, block: label },
      })),
    ]
    const next = buildNextStateForFeatures(
      {
        ...s,
        blocks: { ...s.blocks, [blockId]: { label, ...DEFAULT_BLOCK_PARAMS } },
        activeBlockId: blockId,
        selectedCellIds: [],
      },
      features,
    )
    history.set(next, { tag: "import-geojson" })
    setFitSignal((k) => k + 1)
    showSuccessToast(
      `Imported ${plots.length} plots from ${file.name} as ${label}. Check the fit, then save to keep them.`,
    )
  }

  /** The plots as a GeoJSON file (no outer boundaries, no border positions). */
  function downloadGeojson() {
    const plots = stateRef.current.features
      .filter(
        (f) => f.properties?.role !== "outer" && f.properties?.border !== true,
      )
      .map((f) => ({
        type: "Feature" as const,
        geometry: f.geometry,
        properties: Object.fromEntries(
          Object.entries(f.properties ?? {}).filter(
            ([k]) => !k.startsWith("_") && k !== "cellId" && k !== "blockId",
          ),
        ),
      }))
    const blob = new Blob(
      [JSON.stringify({ type: "FeatureCollection", features: plots }, null, 1)],
      { type: "application/geo+json" },
    )
    const name = `${directory
      .replace(/^Processed\//, "")
      .replace(/\/+$/, "")
      .replace(/[^A-Za-z0-9._-]+/g, "_")}_plot_boundaries.geojson`
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

  function regenerateGrid() {
    // Everything from the editor's latest state, not this render's values:
    // a setting committed on the way to this button (blur) is already in it.
    const st = stateRef.current
    const blockId = st.activeBlockId
    if (!blockId) {
      showErrorToast("Draw a boundary first, then generate the grid.")
      return
    }
    const outer = st.features.find(
      (f): f is GeoJSON.Feature<GeoJSON.Polygon> =>
        f.geometry?.type === "Polygon" &&
        f.properties?.role === "outer" &&
        f.properties?.blockId === blockId,
    )
    if (!outer) {
      showErrorToast(
        "Active block has no outer boundary — draw one or select another block.",
      )
      return
    }
    const p: BlockParams = {
      ...DEFAULT_BLOCK_PARAMS,
      ...(st.pendingDefaultParams ?? {}),
      ...(st.blocks[blockId] ?? {}),
      label: st.blocks[blockId]?.label ?? "",
    }
    const design =
      st.gridMode === "fd" && st.fieldDesign ? st.fieldDesign : null
    // Field-design mode draws the grid the design needs, with border positions
    // around it when asked; Manual mode its own rows and columns.
    const span = design ? dimensionsFromDesign(design) : null
    const br = design ? Math.max(0, Math.trunc(p.borderRows ?? 0)) : 0
    const bc = design ? Math.max(0, Math.trunc(p.borderCols ?? 0)) : 0
    const size = span
      ? { rows: span.rows + 2 * br, cols: span.cols + 2 * bc }
      : { rows: p.rows, cols: p.cols }
    const grid = generateGridFeatures(outer.geometry, {
      rows: size.rows,
      cols: size.cols,
      angleDeg: p.angle,
      gapXMeters: p.gapColMeters ?? p.gapMeters,
      gapYMeters: p.gapMeters,
      plotWidthMeters: p.plotWidthM,
      plotLengthMeters: p.plotLengthM,
      // Field-coordinate offsets + plot-number order. In field-design
      // mode the CSV is authoritative for plot/row/col, so don't apply
      // the manual offsets/fill-pattern (they'd double-shift the labels).
      ...(design
        ? {}
        : {
            rowOffset: p.rowOffset,
            colOffset: p.colOffset,
            fillPattern: p.fillPattern,
          }),
    })
    let cells = grid
    if (design && span) {
      // Grid positions in the design's own frame (the border rows and columns
      // fall outside it), labelled from the design. A position with no plot in
      // the design (outside it, or a gap in it) is a border: drawn to help
      // place the grid, never saved as a plot.
      const shifted = grid.map((f) => {
        const pr = (f.properties ?? {}) as Record<string, unknown>
        const r = Number(pr.row) - br
        const c = Number(pr.col) - bc
        const inside = r >= 1 && r <= span.rows && c >= 1 && c <= span.cols
        return {
          ...f,
          properties: {
            ...pr,
            row: r,
            col: c,
            ...(inside ? {} : { border: true }),
          },
        }
      })
      const inside = shifted.filter((f) => !f.properties.border)
      const hasPlot = designPlotChecker(design)
      const labeled = applyLabelsToFeatures(inside, design).map((f) =>
        hasPlot(f)
          ? f
          : { ...f, properties: { ...(f.properties ?? {}), border: true } },
      )
      cells = [...labeled, ...shifted.filter((f) => f.properties.border)]
    }
    const blockLabel = st.blocks[blockId]?.label ?? blockId
    const tagged = cells.map((f) => ({
      ...f,
      properties: {
        ...(f.properties ?? {}),
        blockId,
        block: blockLabel,
      },
    }))
    // Replace only the *active* block's existing cells. Other blocks'
    // outers and cells are preserved so the user can iterate per-block.
    const keep = st.features.filter((f) => {
      const props = (f.properties ?? {}) as Record<string, unknown>
      if (props.role === "outer") return true
      // A plot added by hand stays: generating the grid again would lose it.
      if (props.added === true) return true
      return props.blockId !== blockId
    })
    // Run through the reconciler so each fresh cell picks up a stable
    // `cellId` (deterministic `${blockId}:${row}:${col}` when row/col
    // exist, UUID otherwise). Selection / group ops in the UI reference
    // cells by cellId, so skipping the reconciler would leave the new
    // grid unselectable.
    const reconciled = buildNextStateForFeatures(st, [...keep, ...tagged])
    history.set(reconciled, { tag: "grid-regenerate" })
  }

  function setFdTransform(transform: FdTransform) {
    const s = stateRef.current
    if (!s.fieldDesign) return
    const next: FieldDesign = { ...s.fieldDesign, transform }
    // Re-label the existing geometry live without redrawing. The outer
    // boundary (role="outer") is excluded — it isn't a plot and would
    // otherwise get spurious CSV row/col props bootstrapped onto it.
    const plotFeatures = s.features.filter(
      (f) => f.properties?.role !== "outer",
    )
    if (plotFeatures.length > 0) {
      const fc: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: plotFeatures,
      }
      const merged = mergeLabelsIntoExisting(fc, next)
      const outerFeatures = s.features.filter(
        (f) => f.properties?.role === "outer",
      )
      const nextFeatures = [
        ...outerFeatures,
        ...(merged.features as GeoJSON.Feature[]),
      ]
      const reconciled = buildNextStateForFeatures(
        { ...s, fieldDesign: next },
        nextFeatures,
      )
      history.set(reconciled, { tag: "fd-transform" })
    } else {
      history.set({ ...s, fieldDesign: next }, { tag: "fd-transform" })
    }
  }

  function handleFieldDesignSaved(fd: FieldDesign) {
    setFdDialogOpen(false)
    const s = stateRef.current
    const dims = dimensionsFromDesign(fd)
    // The design sets the grid's size in field-design mode; the Manual tab's
    // rows and columns are its own and stay as they were.
    const next: PlotBoundaryEditorState = {
      ...s,
      fieldDesign: fd,
      gridMode: "fd",
    }
    const plotFeatures = next.features.filter(
      (f) => f.properties?.role !== "outer",
    )
    if (plotFeatures.length === 0) {
      history.set(next, { tag: "field-design" })
      showSuccessToast(
        `Field design loaded — ${fd.rows.length} plots (${dims.rows} × ${dims.cols}).`,
      )
    } else {
      const fc: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: plotFeatures,
      }
      const merged = mergeLabelsIntoExisting(fc, fd)
      const outerFeatures = next.features.filter(
        (f) => f.properties?.role === "outer",
      )
      const nextFeatures = [
        ...outerFeatures,
        ...(merged.features as GeoJSON.Feature[]),
      ]
      const reconciled = buildNextStateForFeatures(next, nextFeatures)
      history.set(reconciled, { tag: "field-design" })
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
      // Saved + activated — clear the in-flight draft so the recovery
      // banner doesn't reappear on the next mount.
      draftApi.discardDraft()
      setDraftBanner({ visible: false })
      showSuccessToast(`Saved + activated v${v.version}`)
      onSaved?.()
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : "Failed to save and activate",
      )
    }
  }

  async function saveCurrent() {
    // Strip the role="outer" feature: SPLIT_ORTHOMOSAIC and EXTRACT_TRAITS
    // treat every feature in the saved FeatureCollection as a distinct
    // plot, so an enclosing rectangle would create a junk plot covering
    // the whole field.
    // Border positions (around or between the design's plots) help placing
    // the grid; they are not plots.
    const plotFeatures = features.filter(
      (f) => f.properties?.role !== "outer" && f.properties?.border !== true,
    )
    if (plotFeatures.length === 0) {
      throw new Error("Draw at least one polygon first")
    }
    const snapshot: PlotGeometryStateSnapshot = {
      boundaries: { type: "FeatureCollection", features: plotFeatures },
      grid: {
        rows,
        cols,
        spacing_m: gapMeters,
        spacing_col_m: gapColMeters,
        angle_deg: angle,
        row_offset: rowOffset,
        col_offset: colOffset,
        fill_pattern: fillPattern,
      },
      created_from: plotFeatures.length > 1 ? "grid" : "draw",
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

  // Plot length the field facts give (one number), offered for the grid.
  const factsPlotLength = (() => {
    const v = (fieldInfo.data?.facts as Record<string, unknown> | undefined)
      ?.plot_length_m
    const n =
      typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
    return Number.isFinite(n) && n > 0 ? n : null
  })()
  const plotSizeInputs = (
    <div className="space-y-1.5" data-testid="boundary-plot-size">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="grid-plot-width" className="mb-1.5 text-xs">
            Plot width (m)
          </Label>
          <NumberField
            id="grid-plot-width"
            data-testid="boundary-plot-width"
            min={0}
            step={0.1}
            value={activeParams.plotWidthM ?? 0}
            onCommit={(v) => updateActiveParams({ plotWidthM: v })}
          />
        </div>
        <div>
          <Label htmlFor="grid-plot-length" className="mb-1.5 text-xs">
            Plot length (m)
          </Label>
          <NumberField
            id="grid-plot-length"
            data-testid="boundary-plot-length"
            min={0}
            step={0.1}
            value={activeParams.plotLengthM ?? 0}
            onCommit={(v) => updateActiveParams({ plotLengthM: v })}
          />
        </div>
      </div>
      <p className="text-muted-foreground text-[11px]">
        Width across the columns, length along the rows. 0: plots fill the outer
        boundary; with a size, plots are exactly that size, centred in it.
        {factsPlotLength && !activeParams.plotLengthM ? (
          <>
            {" "}
            <button
              type="button"
              className="text-primary underline underline-offset-2"
              data-testid="boundary-plot-length-from-facts"
              onClick={() =>
                updateActiveParams({ plotLengthM: factsPlotLength })
              }
            >
              Use the field facts' length ({factsPlotLength} m)
            </button>
          </>
        ) : null}
      </p>
    </div>
  )

  return (
    <div className="space-y-4">
      {draftBanner.visible ? (
        <Card
          className="border-amber-300 bg-amber-50/40 dark:bg-amber-950/20"
          data-testid="draft-banner"
        >
          <CardContent className="flex flex-wrap items-center gap-3 py-3">
            <span className="text-sm">
              Restored unsaved changes
              {draftBanner.lastModifiedAt ? (
                <>
                  {" "}
                  from{" "}
                  <span className="font-medium">
                    {new Date(draftBanner.lastModifiedAt).toLocaleString()}
                  </span>
                </>
              ) : null}
              . Save now to keep them, or discard to return to the active
              version.
            </span>
            <div className="ml-auto flex gap-2">
              <Button
                size="sm"
                variant="outline"
                data-testid="draft-discard"
                onClick={() => {
                  draftApi.discardDraft()
                  history.replace(INITIAL_EDITOR_STATE)
                  history.clearHistory(INITIAL_EDITOR_STATE)
                  setDraftBanner({ visible: false })
                }}
              >
                Discard
              </Button>
              <Button
                size="sm"
                variant="ghost"
                data-testid="draft-dismiss"
                onClick={() => setDraftBanner({ visible: false })}
              >
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      <div
        className={`grid grid-cols-1 gap-4 ${panelOpen ? "lg:grid-cols-[2fr_1fr]" : ""}`}
      >
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">Map</CardTitle>
              <CardDescription>
                Use the toolbar to draw or edit polygons.
                {panelOpen
                  ? " The grid panel on the right lays out plots."
                  : " The grid panel is hidden; show it to lay out plots."}
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => togglePanel()}
              data-testid="boundary-panel-toggle"
              title={
                panelOpen
                  ? "Hide the grid panel so the map uses the full width"
                  : "Show the grid panel"
              }
            >
              {panelOpen ? (
                <>
                  <PanelRightClose className="mr-1.5 h-4 w-4" /> Full-width map
                </>
              ) : (
                <>
                  <PanelRightOpen className="mr-1.5 h-4 w-4" /> Grid panel
                </>
              )}
            </Button>
          </CardHeader>
          <CardContent>
            <div
              className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs"
              data-testid="boundary-map-toolbar"
            >
              <Button
                size="sm"
                variant={boxSelect ? "default" : "outline"}
                className="h-7"
                data-testid="boundary-box-select"
                title="Drag a box on the map to select the plots inside it (Shift: add to the selection); then move or rotate them"
                onClick={() => setBoxSelect((v) => !v)}
              >
                {boxSelect
                  ? "Selecting an area… (click to stop)"
                  : "Select an area"}
              </Button>
              <Button
                size="sm"
                variant={addPlot ? "default" : "outline"}
                className="h-7"
                data-testid="boundary-add-plot"
                disabled={!activeBlockId}
                title={
                  activeBlockId
                    ? "Draw one more plot (rectangle or polygon tool, top left of the map); it joins the selected block"
                    : "Draw or select an outer boundary first: an added plot joins its block"
                }
                onClick={() => setAddPlot(!addPlot)}
              >
                {addPlot ? "Draw the plot… (click to cancel)" : "Add a plot"}
              </Button>
              <span className="flex items-center gap-1.5">
                <Checkbox
                  id="boundary-show-plots"
                  checked={showPlots}
                  onCheckedChange={(v) => setShowPlots(v === true)}
                  data-testid="boundary-show-plots"
                />
                <label htmlFor="boundary-show-plots">Plots</label>
              </span>
              <label className="flex items-center gap-1.5">
                Opacity
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={plotOpacity}
                  disabled={!showPlots}
                  onChange={(e) => setPlotOpacity(Number(e.target.value))}
                  className="w-24"
                  aria-label="Plot overlay opacity"
                  data-testid="boundary-plot-opacity"
                />
              </label>
              <Button
                size="sm"
                variant={fieldMapOpen ? "default" : "outline"}
                className="h-7"
                data-testid="boundary-field-map"
                title="The field design laid out by rows and columns, or a field map sheet, to look at while placing plots (e.g. how many border plots)"
                onClick={() => setFieldMapOpen((v) => !v)}
              >
                Field map
              </Button>
              {features.some((f) => f.properties?.border === true) && (
                <span className="flex items-center gap-1.5">
                  <Checkbox
                    id="boundary-show-borders"
                    checked={showBorders}
                    onCheckedChange={(v) => setShowBorders(v === true)}
                    data-testid="boundary-show-borders"
                  />
                  <label htmlFor="boundary-show-borders">
                    Border positions (not saved)
                  </label>
                </span>
              )}
            </div>
            {/* The map's own height: its wrapper is h-full, which in this card
                (as tall as the settings beside it) pushed everything after the
                map out below the card. */}
            <div className="h-[500px]">
              <BoundaryMap
                showPlots={showPlots}
                plotOpacity={plotOpacity}
                hideBorders={!showBorders}
                boxSelect={boxSelect}
                onBoxSelect={(ids, add) =>
                  history.set(
                    {
                      ...stateRef.current,
                      selectedCellIds: add
                        ? [
                            ...new Set([
                              ...stateRef.current.selectedCellIds,
                              ...ids,
                            ]),
                          ]
                        : ids,
                    },
                    { tag: "select" },
                  )
                }
                features={features}
                fitSignal={fitSignal}
                onFeaturesChange={setFeatures}
                orthoTileUrl={multi ? undefined : orthoTileUrl}
                orthoLayers={orthoLayers}
                orthoBounds={orthoBounds}
                selectedBlockId={activeBlockId}
                onSelectBlock={(id) =>
                  history.set(
                    {
                      ...stateRef.current,
                      activeBlockId: id,
                      selectedCellIds: [],
                    },
                    { tag: "select-block" },
                  )
                }
                selectedCellIds={history.state.selectedCellIds}
                onCellSelect={(id, mode) =>
                  history.set(
                    {
                      ...stateRef.current,
                      selectedCellIds: nextSelection(
                        stateRef.current.selectedCellIds,
                        id,
                        mode,
                      ),
                    },
                    { tag: "select", coalesce: true },
                  )
                }
                overlays={placement.overlays}
                onOverlayClick={(bed) => placement.setSelectedBed(bed)}
                onSelectionClear={() =>
                  history.set(
                    { ...stateRef.current, selectedCellIds: [] },
                    { tag: "select", coalesce: true },
                  )
                }
              />
            </div>
            {fieldMapOpen && (
              <div className="mt-3 rounded-md border p-3">
                <FieldMapPanel fieldDesign={fieldDesign} />
              </div>
            )}
            {history.state.selectedCellIds.length > 0 ? (
              <div className="mt-3">
                <SelectionActionBar
                  count={history.state.selectedCellIds.length}
                  onNudge={nudgeSelection}
                  plotName={
                    history.state.selectedCellIds.length === 1
                      ? (() => {
                          const f = features.find(
                            (x) =>
                              x.properties?.cellId ===
                              history.state.selectedCellIds[0],
                          )
                          return f
                            ? String(f.properties?.plot ?? "")
                            : undefined
                        })()
                      : undefined
                  }
                  onRenamePlot={(name) => {
                    const s = stateRef.current
                    const id = s.selectedCellIds[0]
                    history.set(
                      {
                        ...s,
                        features: s.features.map((f) =>
                          f.properties?.cellId === id
                            ? {
                                ...f,
                                properties: { ...f.properties, plot: name },
                              }
                            : f,
                        ),
                      },
                      { tag: "rename" },
                    )
                  }}
                  nudgeStep={nudgeStep}
                  onNudgeStepChange={setNudgeStep}
                  hasActiveBlock={activeBlockId != null}
                  onRotate={(deg) => {
                    const sel = new Set(stateRef.current.selectedCellIds)
                    history.set(
                      {
                        ...stateRef.current,
                        features: rotateFeatures(
                          stateRef.current.features,
                          sel,
                          deg,
                        ),
                      },
                      { tag: "rotate" },
                    )
                  }}
                  onFlip={(axis) => {
                    const sel = new Set(stateRef.current.selectedCellIds)
                    history.set(
                      {
                        ...stateRef.current,
                        features: mirrorFeatures(
                          stateRef.current.features,
                          sel,
                          axis,
                        ),
                      },
                      { tag: "flip" },
                    )
                  }}
                  onDelete={() => {
                    const sel = new Set(stateRef.current.selectedCellIds)
                    history.set(
                      {
                        ...stateRef.current,
                        features: stateRef.current.features.filter((f) => {
                          const id = (f.properties as Record<string, unknown>)
                            ?.cellId
                          return typeof id !== "string" || !sel.has(id)
                        }),
                        selectedCellIds: [],
                      },
                      { tag: "delete" },
                    )
                  }}
                  onClear={() =>
                    history.set(
                      { ...stateRef.current, selectedCellIds: [] },
                      { tag: "select" },
                    )
                  }
                  onSelectAllInBlock={() => {
                    const s = stateRef.current
                    if (!s.activeBlockId) return
                    const ids = s.features
                      .filter(
                        (f) =>
                          (f.properties as Record<string, unknown>)?.blockId ===
                            s.activeBlockId &&
                          (f.properties as Record<string, unknown>)?.role !==
                            "outer",
                      )
                      .map(
                        (f) =>
                          (f.properties as Record<string, unknown>)?.cellId as
                            | string
                            | undefined,
                      )
                      .filter((id): id is string => typeof id === "string")
                    history.set(
                      { ...s, selectedCellIds: ids },
                      { tag: "select" },
                    )
                  }}
                  onSelectAll={() => {
                    const s = stateRef.current
                    const ids = s.features
                      .filter(
                        (f) =>
                          (f.properties as Record<string, unknown>)?.role !==
                          "outer",
                      )
                      .map(
                        (f) =>
                          (f.properties as Record<string, unknown>)?.cellId as
                            | string
                            | undefined,
                      )
                      .filter((id): id is string => typeof id === "string")
                    history.set(
                      { ...s, selectedCellIds: ids },
                      { tag: "select" },
                    )
                  }}
                />
              </div>
            ) : null}
            <div className="mt-2 flex items-center justify-between text-xs">
              {multi && (
                <p
                  className="text-muted-foreground"
                  data-testid="boundary-orthos"
                  title="Where the flights overlap, each point shows the orthomosaic whose centre it is nearer; plot images and traits are taken from the same one."
                >
                  {folderOrthoList.length} orthomosaics:{" "}
                  {orthoLabels.join(", ")} · each shown where it is nearest its
                  centre
                </p>
              )}
              <p className="text-muted-foreground">
                {plotFeatureCount} plot{plotFeatureCount === 1 ? "" : "s"}{" "}
                {borderCount
                  ? `(and ${borderCount} border positions, not saved) `
                  : ""}
                across {Object.keys(blocks).length} block
                {Object.keys(blocks).length === 1 ? "" : "s"}
              </p>
              {s3Url && tilejsonQuery.isError && (
                <p className="text-muted-foreground italic">
                  Couldn't read ortho metadata — drawing on basemap.
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Kept mounted when hidden so the panel's settings survive. */}
        <div className={panelOpen ? "space-y-4" : "hidden"}>
          <StitchPlacementPanel state={placement} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Grid
                {activeBlockId && blocks[activeBlockId] ? (
                  <span
                    className="ml-2 text-sm font-normal text-muted-foreground"
                    data-testid="active-block-label"
                  >
                    — {blocks[activeBlockId].label} active
                  </span>
                ) : null}
              </CardTitle>
              <CardDescription>
                {Object.keys(blocks).length > 1
                  ? "Click a boundary on the map to switch which block the grid panel targets."
                  : "Generate plot rectangles inscribed in the outer polygon."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {Object.keys(blocks).length > 1 ? (
                <div
                  className="flex flex-wrap gap-1.5"
                  data-testid="block-switcher"
                >
                  {Object.entries(blocks).map(([id, p]) => (
                    <Button
                      key={id}
                      size="sm"
                      variant={id === activeBlockId ? "default" : "outline"}
                      onClick={() =>
                        history.set(
                          {
                            ...stateRef.current,
                            activeBlockId: id,
                            selectedCellIds: [],
                          },
                          { tag: "select-block" },
                        )
                      }
                      data-testid={`block-switch-${id}`}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
              ) : null}
              <Tabs
                value={gridMode}
                onValueChange={(v) =>
                  history.set(
                    {
                      ...stateRef.current,
                      gridMode: v as "manual" | "fd",
                    },
                    { tag: "grid-mode" },
                  )
                }
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
                      <NumberField
                        id="grid-rows"
                        data-testid="boundary-rows"
                        integer
                        min={1}
                        step={1}
                        value={rows}
                        onCommit={setRows}
                      />
                    </div>
                    <div>
                      <Label htmlFor="grid-cols" className="mb-1.5 text-xs">
                        Cols
                      </Label>
                      <NumberField
                        id="grid-cols"
                        data-testid="boundary-cols"
                        integer
                        min={1}
                        step={1}
                        value={cols}
                        onCommit={setCols}
                      />
                    </div>
                    <div>
                      <Label htmlFor="grid-angle" className="mb-1.5 text-xs">
                        Angle (°)
                      </Label>
                      <NumberField
                        id="grid-angle"
                        data-testid="boundary-angle"
                        allowNegative
                        step={1}
                        value={angle}
                        onCommit={setAngle}
                      />
                    </div>
                    <div>
                      <Label htmlFor="grid-gap" className="mb-1.5 text-xs">
                        Gap between rows (m)
                      </Label>
                      <NumberField
                        id="grid-gap"
                        data-testid="boundary-gap"
                        min={0}
                        step={0.1}
                        value={gapMeters}
                        onCommit={setGapMeters}
                      />
                    </div>
                    <div>
                      <Label htmlFor="grid-gap-cols" className="mb-1.5 text-xs">
                        Gap between columns (m)
                      </Label>
                      <NumberField
                        id="grid-gap-cols"
                        data-testid="boundary-gap-cols"
                        min={0}
                        step={0.1}
                        value={gapColMeters}
                        onCommit={setGapColMeters}
                      />
                    </div>
                    <div>
                      <Label
                        htmlFor="grid-row-offset"
                        className="mb-1.5 text-xs"
                      >
                        Row offset
                      </Label>
                      <NumberField
                        id="grid-row-offset"
                        data-testid="boundary-row-offset"
                        integer
                        min={0}
                        step={1}
                        value={rowOffset}
                        onCommit={setRowOffset}
                      />
                    </div>
                    <div>
                      <Label
                        htmlFor="grid-col-offset"
                        className="mb-1.5 text-xs"
                      >
                        Col offset
                      </Label>
                      <NumberField
                        id="grid-col-offset"
                        data-testid="boundary-col-offset"
                        integer
                        min={0}
                        step={1}
                        value={colOffset}
                        onCommit={setColOffset}
                      />
                    </div>
                    <div className="col-span-2">
                      <Label
                        htmlFor="grid-fill-pattern"
                        className="mb-1.5 text-xs"
                      >
                        Plot numbering
                      </Label>
                      <Select
                        value={fillPattern}
                        onValueChange={(v) => setFillPattern(v as FillPattern)}
                      >
                        <SelectTrigger
                          id="grid-fill-pattern"
                          data-testid="boundary-fill-pattern"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="row-major">
                            Row by row (1,2,3 / 4,5,6)
                          </SelectItem>
                          <SelectItem value="snake">
                            Snake (1,2,3 / 6,5,4)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Offsets place this block within the full field (0 = field
                    origin). Irregular numbering that fits neither pattern → use
                    a field-design CSV.
                  </p>
                  {plotSizeInputs}
                </TabsContent>

                <TabsContent value="fd" className="space-y-3 pt-3">
                  <div
                    className="rounded border bg-muted/30 p-2 text-xs"
                    data-testid="field-design-banner"
                  >
                    {fieldDesign ? (
                      <>
                        <p className="mb-1.5">
                          Field design
                          {fieldDesign.source ? (
                            <>
                              {" "}
                              <strong data-testid="field-design-source">
                                {fieldDesign.source}
                              </strong>
                            </>
                          ) : null}
                          : <strong>{fieldDesign.rows.length}</strong> plots on
                          a {fdSize?.rows} × {fdSize?.cols} grid (rows ×
                          columns, from the design)
                        </p>
                        {fdMismatch && (
                          <p
                            className="mb-1.5 text-amber-600"
                            data-testid="field-design-mismatch"
                          >
                            The drawn grid is {fdMismatch.rows} ×{" "}
                            {fdMismatch.cols}: Generate plot grid again to match
                            the design.
                          </p>
                        )}
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
                          onClick={() => {
                            setFdDialogStart("upload")
                            setFdDialogOpen(true)
                          }}
                        >
                          Replace field design
                        </Button>
                        {fieldPreset &&
                        fieldPreset.name !== fieldDesign.source ? (
                          // The field facts name another design (saved there since).
                          <p
                            className="mt-1.5 text-sky-700 dark:text-sky-400"
                            data-testid="field-design-facts-differ"
                          >
                            The field facts give{" "}
                            <strong>{fieldPreset.name}</strong>.{" "}
                            <button
                              type="button"
                              className="underline underline-offset-2"
                              onClick={() => {
                                setFdDialogStart("preset")
                                setFdDialogOpen(true)
                              }}
                            >
                              Use it instead
                            </button>
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <>
                        {fieldPreset ? (
                          <p
                            className="mb-1.5"
                            data-testid="field-design-known"
                          >
                            This field's design is{" "}
                            <strong>{fieldPreset.name}</strong>
                            {fieldPreset.described
                              ? ` (${fieldPreset.described})`
                              : ""}
                            . Use it, then draw the outer boundary around the
                            design's plots and generate the grid.
                          </p>
                        ) : (
                          <p className="text-muted-foreground mb-1.5">
                            Upload a CSV mapping (row, col) coordinates to plot
                            metadata. Rows/cols come from the design.
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant={fieldPreset ? "default" : "outline"}
                            data-testid="field-design-upload"
                            onClick={() => {
                              setFdDialogStart(
                                fieldPreset ? "preset" : "upload",
                              )
                              setFdDialogOpen(true)
                            }}
                          >
                            {fieldPreset
                              ? `Use ${fieldPreset.name}`
                              : "Upload field design"}
                          </Button>
                          {fieldPreset && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setFdDialogStart("upload")
                                setFdDialogOpen(true)
                              }}
                            >
                              Another file
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid="field-design-from-map"
                            title="A sheet with the plot numbers laid out as the plots lie in the field: click two opposite corners of this field"
                            onClick={() => {
                              setFdDialogStart("fieldmap")
                              setFdDialogOpen(true)
                            }}
                          >
                            From a field map sheet
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="grid-angle-fd" className="mb-1.5 text-xs">
                        Angle (°)
                      </Label>
                      <NumberField
                        id="grid-angle-fd"
                        data-testid="boundary-angle-fd"
                        allowNegative
                        step={1}
                        value={angle}
                        onCommit={setAngle}
                      />
                    </div>
                    <div>
                      <Label htmlFor="grid-gap-fd" className="mb-1.5 text-xs">
                        Gap between rows (m)
                      </Label>
                      <NumberField
                        id="grid-gap-fd"
                        data-testid="boundary-gap-fd"
                        min={0}
                        step={0.1}
                        value={gapMeters}
                        onCommit={setGapMeters}
                      />
                    </div>
                    <div>
                      <Label
                        htmlFor="grid-gap-cols-fd"
                        className="mb-1.5 text-xs"
                      >
                        Gap between columns (m)
                      </Label>
                      <NumberField
                        id="grid-gap-cols-fd"
                        data-testid="boundary-gap-fd-cols"
                        min={0}
                        step={0.1}
                        value={gapColMeters}
                        onCommit={setGapColMeters}
                      />
                    </div>
                  </div>
                  {plotSizeInputs}
                  <div className="space-y-1.5" data-testid="boundary-borders">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label
                          htmlFor="grid-border-rows"
                          className="mb-1.5 text-xs"
                        >
                          Border rows (each end)
                        </Label>
                        <NumberField
                          id="grid-border-rows"
                          data-testid="boundary-border-rows"
                          min={0}
                          step={1}
                          value={activeParams.borderRows ?? 0}
                          onCommit={(v) =>
                            updateActiveParams({
                              borderRows: Math.max(0, Math.trunc(v)),
                            })
                          }
                        />
                      </div>
                      <div>
                        <Label
                          htmlFor="grid-border-cols"
                          className="mb-1.5 text-xs"
                        >
                          Border columns (each side)
                        </Label>
                        <NumberField
                          id="grid-border-cols"
                          data-testid="boundary-border-cols"
                          min={0}
                          step={1}
                          value={activeParams.borderCols ?? 0}
                          onCommit={(v) =>
                            updateActiveParams({
                              borderCols: Math.max(0, Math.trunc(v)),
                            })
                          }
                        />
                      </div>
                    </div>
                    <p className="text-muted-foreground text-[11px]">
                      Positions around the design, and gaps in it, are drawn as
                      dashed border plots to help place the grid (the field map
                      shows how many); they are not saved. Hide them with
                      "Border positions" above the map.
                    </p>
                  </div>
                </TabsContent>
              </Tabs>

              {features.length === 0 ? (
                <p className="text-amber-700 dark:text-amber-400 text-xs">
                  Draw an outer boundary on the map
                  {orthoBounds ? " (or use the ortho's extent)" : ""}, then
                  click <strong>Generate plot grid</strong>.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {orthoBounds && (
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid="boundary-auto-from-ortho"
                    title="Outer boundary = the orthomosaic's extent, inset 2.5% to trim its ragged edge"
                    onClick={() =>
                      setFeatures([
                        ...stateRef.current.features,
                        outerFromOrthoBounds(orthoBounds),
                      ])
                    }
                  >
                    Boundary from ortho extent
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={regenerateGrid}
                  disabled={
                    !activeBlockId || (gridMode === "fd" && !fieldDesign)
                  }
                >
                  Generate plot grid
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="boundary-clear-plots"
                  title="Remove the plots; the outer boundaries stay, to generate the grid again"
                  onClick={clearPlotsKeepOutlines}
                  disabled={
                    !features.some((f) => f.properties?.role !== "outer")
                  }
                >
                  Clear plots (keep outlines)
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="boundary-import-geojson"
                  title="Plot boundaries from a GeoJSON file made elsewhere (QGIS, another tool): added as a new block"
                  onClick={() => geojsonInputRef.current?.click()}
                >
                  Import GeoJSON…
                </Button>
                <input
                  ref={geojsonInputRef}
                  type="file"
                  accept=".geojson,.json,application/geo+json,application/json"
                  className="hidden"
                  data-testid="boundary-import-geojson-file"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ""
                    if (f) void importGeojson(f)
                  }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="boundary-download-geojson"
                  title="The plots as a GeoJSON file (no outer boundaries or border positions)"
                  onClick={downloadGeojson}
                  disabled={
                    !features.some(
                      (f) =>
                        f.properties?.role !== "outer" &&
                        f.properties?.border !== true,
                    )
                  }
                >
                  Download GeoJSON
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
                    plotFeatureCount === 0 ||
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
                  disabled={plotFeatureCount === 0 || save.isPending}
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
          <TabsTrigger value="import" data-testid="boundary-import-tab">
            Import from…
          </TabsTrigger>
        </TabsList>
        <TabsContent value="versions" className="pt-3">
          <VersionPicker
            directory={directory}
            activeVersion={
              loadSource?.directory === directory ? loadSource.version : null
            }
            onLoad={(v) => {
              setImportedSnapshot(null)
              setLoadSource({ directory, version: v })
            }}
          />
        </TabsContent>
        <TabsContent value="import" className="pt-3">
          <BoundaryImportPicker
            directory={directory}
            onImportSnapshot={(snap, note) => {
              setImportedSnapshot(snap as unknown as PlotGeometryStateSnapshot)
              showSuccessToast(
                `${note} Check the fit, then save to keep them here.`,
              )
            }}
            onImport={(dir, version, plotCount) => {
              setImportedSnapshot(null)
              setLoadSource({ directory: dir, version })
              showSuccessToast(
                `Imported ${plotCount} plots. Check the fit, then save to keep them here.`,
              )
            }}
          />
        </TabsContent>
      </Tabs>

      <FieldDesignUploadDialog
        open={fdDialogOpen}
        onClose={() => setFdDialogOpen(false)}
        onSaved={handleFieldDesignSaved}
        preset={fieldPreset}
        startWith={fdDialogStart}
        keep={
          scope
            ? {
                year: scope.year,
                location: scope.location,
                experiment: scope.experiment,
              }
            : undefined
        }
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
              the grid. You can undo this with Cmd/Ctrl+Z.
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
                history.set(
                  {
                    ...INITIAL_EDITOR_STATE,
                    gridMode: stateRef.current.gridMode,
                    fieldDesign: stateRef.current.fieldDesign,
                  },
                  { tag: "clear" },
                )
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
