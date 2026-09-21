import type { FieldDesign } from "@/features/process/lib/fieldDesign"
import type { FillPattern } from "@/features/process/lib/grid"

export type BlockParams = {
  label: string
  rows: number
  cols: number
  angle: number
  gapMeters: number
  /** Field-row/col of this block's top-left plot (0 = field origin).
   *  Lets a grid drawn over a subset of the field emit field-coordinate
   *  row/col so trait records keyed by field position join. */
  rowOffset: number
  colOffset: number
  /** Plot-number assignment order across the grid. */
  fillPattern: FillPattern
}

export const DEFAULT_BLOCK_PARAMS: Omit<BlockParams, "label"> = {
  rows: 4,
  cols: 10,
  angle: 0,
  gapMeters: 0,
  rowOffset: 0,
  colOffset: 0,
  fillPattern: "row-major",
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
