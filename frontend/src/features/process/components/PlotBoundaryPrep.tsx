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
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

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
import { NumberField } from "@/components/ui/number-field"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BoundaryMap } from "@/features/process/components/BoundaryMap"
import { FieldDesignUploadDialog } from "@/features/process/components/FieldDesignUploadDialog"
import { SelectionActionBar } from "@/features/process/components/SelectionActionBar"
import { VersionPicker } from "@/features/process/components/VersionPicker"
import { useDraftPersistence } from "@/features/process/hooks/useDraftPersistence"
import { useHistory } from "@/features/process/hooks/useHistory"
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
import { rotateFeatures } from "@/features/process/lib/groupTransform"
import type { AerialScope } from "@/features/process/lib/paths"
import { processedPrefix } from "@/features/process/lib/paths"
import {
  type BlockParams,
  DEFAULT_BLOCK_PARAMS,
  INITIAL_EDITOR_STATE,
  type PlotBoundaryEditorState,
} from "@/features/process/lib/plotBoundaryEditorState"
import { type Run, setStepState } from "@/features/process/lib/runStore"
import useCustomToast from "@/hooks/useCustomToast"

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

export function PlotBoundaryPrep({
  run,
  scope,
  onSaved,
  onCancel,
}: PlotBoundaryPrepProps) {
  const directory = useMemo(() => processedPrefix(scope), [scope])

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
  const [versionToLoad, setVersionToLoad] = useState<number | null>(null)
  const [versionName, setVersionName] = useState("")
  const [fdDialogOpen, setFdDialogOpen] = useState(false)
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
      ? blocks[activeBlockId]
      : {
          label: "",
          ...DEFAULT_BLOCK_PARAMS,
          ...(pendingDefaultParams ?? {}),
        }
  const { rows, cols, angle, gapMeters } = activeParams

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
    // No active block — apply rows/cols to pendingDefaultParams so the
    // value sticks until the user draws a boundary.
    if (patch.rows !== undefined || patch.cols !== undefined) {
      history.set(
        {
          ...s,
          pendingDefaultParams: {
            rows:
              patch.rows ??
              s.pendingDefaultParams?.rows ??
              DEFAULT_BLOCK_PARAMS.rows,
            cols:
              patch.cols ??
              s.pendingDefaultParams?.cols ??
              DEFAULT_BLOCK_PARAMS.cols,
          },
        },
        { tag: "params" },
      )
    }
  }
  const setRows = (v: number) => updateActiveParams({ rows: v })
  const setCols = (v: number) => updateActiveParams({ cols: v })
  const setAngle = (v: number) => updateActiveParams({ angle: v })
  const setGapMeters = (v: number) => updateActiveParams({ gapMeters: v })

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

  // Derived counts. The outer-boundary polygon is held in `features` (so
  // it renders/edits on the map) but isn't a plot — keep it out of the
  // count surfaced to the user and out of the save/clear gating.
  const plotFeatureCount = useMemo(
    () => features.filter((f) => f.properties?.role !== "outer").length,
    [features],
  )

  const loaded = useLoadPlotGeometryVersion(directory, versionToLoad)
  useEffect(() => {
    if (!loaded.data?.state_snapshot) return
    const fc = loaded.data.state_snapshot.boundaries
    const grid = loaded.data.state_snapshot.grid
    const fd = loaded.data.state_snapshot.field_design

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
    if (fd) {
      nextState = { ...nextState, fieldDesign: fd, gridMode: "fd" }
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
  }, [
    loaded.data,
    history.replace,
    history.clearHistory,
    draftApi.discardDraft,
    buildNextStateForFeatures,
  ])

  function regenerateGrid() {
    if (!activeBlockId) {
      showErrorToast("Draw a boundary first, then generate the grid.")
      return
    }
    const outer = features.find(
      (f): f is GeoJSON.Feature<GeoJSON.Polygon> =>
        f.geometry?.type === "Polygon" &&
        f.properties?.role === "outer" &&
        f.properties?.blockId === activeBlockId,
    )
    if (!outer) {
      showErrorToast(
        "Active block has no outer boundary — draw one or select another block.",
      )
      return
    }
    const grid = generateGridFeatures(outer.geometry, {
      rows,
      cols,
      angleDeg: angle,
      gapXMeters: gapMeters,
      gapYMeters: gapMeters,
    })
    // Stamp every cell with the parent blockId + the block label so the
    // map can colour them together and so saved snapshots carry the
    // grouping. Apply CSV-derived labels only when the user is in
    // field-design mode.
    const labeled =
      gridMode === "fd" && fieldDesign
        ? applyLabelsToFeatures(grid, fieldDesign)
        : grid
    const blockLabel = blocks[activeBlockId]?.label ?? activeBlockId
    const tagged = labeled.map((f) => ({
      ...f,
      properties: {
        ...(f.properties ?? {}),
        blockId: activeBlockId,
        block: blockLabel,
      },
    }))
    // Replace only the *active* block's existing cells. Other blocks'
    // outers and cells are preserved so the user can iterate per-block.
    const keep = features.filter((f) => {
      const props = (f.properties ?? {}) as Record<string, unknown>
      if (props.role === "outer") return true
      return props.blockId !== activeBlockId
    })
    // Run through the reconciler so each fresh cell picks up a stable
    // `cellId` (deterministic `${blockId}:${row}:${col}` when row/col
    // exist, UUID otherwise). Selection / group ops in the UI reference
    // cells by cellId, so skipping the reconciler would leave the new
    // grid unselectable.
    const reconciled = buildNextStateForFeatures(stateRef.current, [
      ...keep,
      ...tagged,
    ])
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
    let next: PlotBoundaryEditorState = {
      ...s,
      fieldDesign: fd,
      gridMode: "fd",
    }
    if (s.activeBlockId && next.blocks[s.activeBlockId]) {
      next = {
        ...next,
        blocks: {
          ...next.blocks,
          [s.activeBlockId]: {
            ...next.blocks[s.activeBlockId],
            rows: dims.rows,
            cols: dims.cols,
          },
        },
      }
    } else {
      next = {
        ...next,
        pendingDefaultParams: { rows: dims.rows, cols: dims.cols },
      }
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
    const plotFeatures = features.filter((f) => f.properties?.role !== "outer")
    if (plotFeatures.length === 0) {
      throw new Error("Draw at least one polygon first")
    }
    const snapshot: PlotGeometryStateSnapshot = {
      boundaries: { type: "FeatureCollection", features: plotFeatures },
      grid: { rows, cols, spacing_m: gapMeters, angle_deg: angle },
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
              onSelectionClear={() =>
                history.set(
                  { ...stateRef.current, selectedCellIds: [] },
                  { tag: "select", coalesce: true },
                )
              }
            />
            {history.state.selectedCellIds.length > 0 ? (
              <div className="mt-3">
                <SelectionActionBar
                  count={history.state.selectedCellIds.length}
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
              <p className="text-muted-foreground">
                {plotFeatureCount} plot{plotFeatureCount === 1 ? "" : "s"}{" "}
                across {Object.keys(blocks).length} block
                {Object.keys(blocks).length === 1 ? "" : "s"}
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
                        Gap (m)
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
                          loaded (
                          {activeBlockId
                            ? rows
                            : (pendingDefaultParams?.rows ?? rows)}{" "}
                          ×{" "}
                          {activeBlockId
                            ? cols
                            : (pendingDefaultParams?.cols ?? cols)}
                          )
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
                        Gap (m)
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
                  disabled={
                    !activeBlockId || (gridMode === "fd" && !fieldDesign)
                  }
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
