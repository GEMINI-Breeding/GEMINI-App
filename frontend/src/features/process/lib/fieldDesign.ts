/**
 * Field-design domain logic for plot-boundary labeling.
 *
 * A "field design" is a CSV the user uploads that maps grid (row, col)
 * coordinates to plot metadata (accession, line ID, rep…). When the user
 * generates a plot grid we merge each polygon's (row, col) against the
 * design and tag the polygon with the matching CSV row's properties so
 * downstream trait extraction surfaces real plot identity.
 *
 * A FieldDesign also carries a `transform` ({ flipRows, flipCols, swapAxes })
 * because real-world fields are often flown opposite to the CSV's
 * indexing — flipRows lets the user invert the row axis without
 * re-uploading.
 *
 * All functions here are pure; the React layer owns state and persistence.
 */

export type FieldDesignRow = Record<string, string>

export type FdTransform = {
  flipRows: boolean
  flipCols: boolean
  swapAxes: boolean
}

export const FD_TRANSFORM_IDENTITY: FdTransform = {
  flipRows: false,
  flipCols: false,
  swapAxes: false,
}

export const FD_TARGET_COLS = [
  {
    key: "row",
    label: "Row",
    required: true,
    hint: "Grid row number (1, 2, 3…)",
  },
  {
    key: "col",
    label: "Column",
    required: true,
    hint: "Grid column number (1, 2, 3…)",
  },
  {
    key: "plot",
    label: "Plot ID",
    required: false,
    hint: "Plot label or identifier",
  },
  {
    key: "accession",
    label: "Accession",
    required: false,
    hint: "Entry / variety / line name",
  },
] as const

export type FdTargetKey = (typeof FD_TARGET_COLS)[number]["key"]

export const FD_ALIASES: Record<FdTargetKey, string[]> = {
  row: ["row", "row_num", "row_number", "range", "tier"],
  col: ["col", "column", "col_num", "column_number", "bed"],
  plot: [
    "plot",
    "plot_id",
    "plotid",
    "plot_no",
    "plot_number",
    "field.plot.number",
  ],
  accession: [
    "accession",
    "acc",
    "entry",
    "variety",
    "genotype",
    "label",
    "treatment",
    "line id",
    "line_id",
  ],
}

export type FieldDesign = {
  /**
   * The original (or remapped-and-serialized) CSV text. Persisted on the
   * snapshot so a future reload can re-derive everything.
   */
  csv_text: string
  /** {targetKey → sourceColumn} from the column-mapping step. */
  mapping: Partial<Record<FdTargetKey, string>>
  /** Parsed rows after mapping is resolved (each row keyed by source column). */
  rows: FieldDesignRow[]
  transform: FdTransform
}

/**
 * Pull (row, col) from a CSV row using the mapping. Returns null if either
 * is missing or non-numeric — caller should treat as "no design row here".
 */
function rowColOf(
  row: FieldDesignRow,
  mapping: Partial<Record<FdTargetKey, string>>,
): { r: number; c: number } | null {
  const rSrc = mapping.row
  const cSrc = mapping.col
  if (!rSrc || !cSrc) return null
  const r = Number(row[rSrc])
  const c = Number(row[cSrc])
  if (!Number.isFinite(r) || !Number.isFinite(c)) return null
  return { r, c }
}

/**
 * Compute (rows, cols) from the design's max row/col after mapping. Used
 * to auto-populate the wizard's Rows/Cols inputs.
 */
export function dimensionsFromDesign(fd: FieldDesign): {
  rows: number
  cols: number
} {
  let maxR = 0
  let maxC = 0
  for (const row of fd.rows) {
    const rc = rowColOf(row, fd.mapping)
    if (!rc) continue
    if (rc.r > maxR) maxR = rc.r
    if (rc.c > maxC) maxC = rc.c
  }
  return { rows: Math.max(1, maxR), cols: Math.max(1, maxC) }
}

/**
 * Apply the transform to a (r, c) lookup: returns the (r, c) we should
 * search the CSV for given a polygon's geometric (r, c). The CSV is
 * conceptually fixed; the user is reorienting how we walk into it.
 */
function transformLookup(
  geom: { r: number; c: number },
  maxRow: number,
  maxCol: number,
  t: FdTransform,
): { r: number; c: number } {
  let r = geom.r
  let c = geom.c
  if (t.flipRows) r = maxRow - r + 1
  if (t.flipCols) c = maxCol - c + 1
  if (t.swapAxes) [r, c] = [c, r]
  return { r, c }
}

/**
 * Index CSV rows by (r, c) for O(1) lookup. Rows without a valid (r, c)
 * are skipped.
 */
function indexByRowCol(fd: FieldDesign): Map<string, FieldDesignRow> {
  const index = new Map<string, FieldDesignRow>()
  for (const row of fd.rows) {
    const rc = rowColOf(row, fd.mapping)
    if (!rc) continue
    index.set(`${rc.r},${rc.c}`, row)
  }
  return index
}

/**
 * Tag each feature's `properties` with its matching CSV row. Grid origin
 * (geometric row/col/plot) is preserved under namespaced keys so callers
 * can still recover position even when CSV defines its own `plot`.
 */
export function applyLabelsToFeatures(
  features: GeoJSON.Feature[],
  fd: FieldDesign,
): GeoJSON.Feature[] {
  if (features.length === 0) return features
  const index = indexByRowCol(fd)
  const dims = dimensionsFromDesign(fd)
  let unmatched = 0
  const out = features.map((f) => {
    const props = f.properties ?? {}
    const gr = Number(props.row)
    const gc = Number(props.col)
    const gPlot = props.plot
    if (!Number.isFinite(gr) || !Number.isFinite(gc)) return f

    const lookup = transformLookup(
      { r: gr, c: gc },
      dims.rows,
      dims.cols,
      fd.transform,
    )
    const csvRow = index.get(`${lookup.r},${lookup.c}`)
    const merged: Record<string, unknown> = {
      _grid_row: gr,
      _grid_col: gc,
      _grid_plot: gPlot,
      ...props,
      ...(csvRow ?? {}),
    }
    if (!csvRow) unmatched += 1
    return { ...f, properties: merged }
  })
  if (unmatched > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[fieldDesign] ${unmatched} of ${features.length} polygons had no matching CSV row`,
    )
  }
  return out
}

/**
 * Re-apply field-design labels onto an existing FeatureCollection without
 * touching geometry. Used when the user toggles a transform after the
 * grid is already drawn — labels remap live, polygons stay put.
 *
 * If features lack `row`/`col` (e.g. ground pipeline features that only
 * carry `plot_id`), assigns them sequentially from the design before
 * applying the transform — same fallback main uses.
 */
export function mergeLabelsIntoExisting(
  fc: GeoJSON.FeatureCollection,
  fd: FieldDesign,
): GeoJSON.FeatureCollection {
  if (fc.features.length === 0) return fc

  // Bootstrap row/col on features that don't have them, by walking the CSV
  // in its native order. This matches main's behavior for ground pipelines.
  const hasRowCol = fc.features.some(
    (f) =>
      Number.isFinite(Number(f.properties?.row)) &&
      Number.isFinite(Number(f.properties?.col)),
  )
  const source = hasRowCol
    ? fc.features
    : fc.features.map((feature, idx) => {
        const designRow = fd.rows[idx]
        if (!designRow) return feature
        const rc = rowColOf(designRow, fd.mapping)
        if (!rc) return feature
        return {
          ...feature,
          properties: { ...feature.properties, row: rc.r, col: rc.c },
        }
      })

  return {
    ...fc,
    features: applyLabelsToFeatures(source, fd),
  }
}
