import type { FieldDesign } from "@/features/process/lib/fieldDesign"

export type BlockParams = {
  label: string
  rows: number
  cols: number
  angle: number
  gapMeters: number
}

export const DEFAULT_BLOCK_PARAMS: Omit<BlockParams, "label"> = {
  rows: 4,
  cols: 10,
  angle: 0,
  gapMeters: 0,
}

export type PlotBoundaryEditorState = {
  features: GeoJSON.Feature[]
  blocks: Record<string, BlockParams>
  activeBlockId: string | null
  pendingDefaultParams: { rows: number; cols: number } | null
  gridMode: "manual" | "fd"
  fieldDesign: FieldDesign | null
  selectedCellIds: string[]
}

export const INITIAL_EDITOR_STATE: PlotBoundaryEditorState = {
  features: [],
  blocks: {},
  activeBlockId: null,
  pendingDefaultParams: null,
  gridMode: "manual",
  fieldDesign: null,
  selectedCellIds: [],
}
