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
  {
    key: "crop",
    label: "Crop",
    required: false,
    hint: "Crop or population of each plot: results of a field with several crops are filed per crop",
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
  crop: ["crop", "population", "population_exact", "species"],
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
  /** The file it came from (as kept by the agent on this computer), when known. */
  source?: string
}

/**
 * The grid transform for a field that lies as recorded (the agent's field
 * facts): the design's rows are tiers and its columns beds; the editor's
 * grid puts row 1 at the top (north) and column 1 at the left (west).
 *  - tiers along north-south: first tier at the south → rows flipped;
 *    first bed on the east → columns flipped.
 *  - tiers along east-west: axes swapped (grid columns are tiers); first
 *    tier at the east → tiers flipped; first bed at the south → beds flipped.
 * Unknown sides leave that axis as it is.
 */
export function transformFromFacts(facts: {
  first_tier_at?: string
  first_bed_at?: string
}): FdTransform {
  const tier = facts.first_tier_at
  const bed = facts.first_bed_at
  if (tier === "east" || tier === "west")
    return {
      swapAxes: true,
      flipRows: tier === "east",
      flipCols: bed === "south",
    }
  return {
    swapAxes: false,
    flipRows: tier === "south",
    flipCols: bed === "east",
  }
}

/** "tier 1 at the north end, bed 1 on the west side" — or null if unknown. */
export function describeFacts(facts: {
  first_tier_at?: string
  first_bed_at?: string
}): string | null {
  const parts = [
    facts.first_tier_at && `tier 1 at the ${facts.first_tier_at} end`,
    facts.first_bed_at && `bed 1 on the ${facts.first_bed_at} side`,
  ].filter(Boolean)
  return parts.length ? parts.join(", ") : null
}

/**
 * Pull (row, col) from a CSV row using the mapping. Returns null if either
 * is missing or non-numeric — caller should treat as "no design row here".
 */
export function rowColOf(
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

/** The design's range of rows and columns (it need not start at 1: a design
 *  may number its plots' rows 2–26 inside border rows). */
export function designExtent(fd: FieldDesign): {
  minR: number
  maxR: number
  minC: number
  maxC: number
} {
  let minR = Number.POSITIVE_INFINITY
  let maxR = 0
  let minC = Number.POSITIVE_INFINITY
  let maxC = 0
  for (const row of fd.rows) {
    const rc = rowColOf(row, fd.mapping)
    if (!rc) continue
    minR = Math.min(minR, rc.r)
    maxR = Math.max(maxR, rc.r)
    minC = Math.min(minC, rc.c)
    maxC = Math.max(maxC, rc.c)
  }
  if (!Number.isFinite(minR)) return { minR: 1, maxR: 1, minC: 1, maxC: 1 }
  return { minR, maxR, minC, maxC }
}

/**
 * The grid (rows, cols) the design needs: its range of rows and columns
 * (gaps inside it, e.g. buffer beds, are cells without a plot), turned
 * when the axes are swapped. Field-design mode draws exactly this grid.
 */
export function dimensionsFromDesign(fd: FieldDesign): {
  rows: number
  cols: number
} {
  const e = designExtent(fd)
  const rows = Math.max(1, e.maxR - e.minR + 1)
  const cols = Math.max(1, e.maxC - e.minC + 1)
  return fd.transform?.swapAxes ? { rows: cols, cols: rows } : { rows, cols }
}

/**
 * The design (r, c) a grid cell (1-based, in the grid drawn for this
 * design) stands for: swap the axes, flip within the design's range, then
 * shift to where the design's numbering starts.
 */
function transformLookup(
  geom: { r: number; c: number },
  fd: FieldDesign,
): { r: number; c: number } {
  const e = designExtent(fd)
  const t = fd.transform
  let r = geom.r
  let c = geom.c
  if (t.swapAxes) [r, c] = [c, r]
  if (t.flipRows) r = e.maxR - e.minR + 2 - r
  if (t.flipCols) c = e.maxC - e.minC + 2 - c
  return { r: r + e.minR - 1, c: c + e.minC - 1 }
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
/**
 * A check: does the design have a plot at a grid cell's position? A cell
 * without one is a border position (around or between the design's plots).
 */
export function designPlotChecker(
  fd: FieldDesign,
): (f: GeoJSON.Feature) => boolean {
  const index = indexByRowCol(fd)
  return (f) => {
    const p = (f.properties ?? {}) as Record<string, unknown>
    const gr = Number(p._grid_row ?? p.row)
    const gc = Number(p._grid_col ?? p.col)
    if (!Number.isFinite(gr) || !Number.isFinite(gc)) return true
    const at = transformLookup({ r: gr, c: gc }, fd)
    return index.has(`${at.r},${at.c}`)
  }
}

export function applyLabelsToFeatures(
  features: GeoJSON.Feature[],
  fd: FieldDesign,
): GeoJSON.Feature[] {
  if (features.length === 0) return features
  const index = indexByRowCol(fd)
  let unmatched = 0
  const out = features.map((f) => {
    const props = f.properties ?? {}
    // The cell's place in the grid: kept under _grid_* once labelled (the
    // design's own row/col then replace row/col), so labels can be redone.
    const gr = Number(props._grid_row ?? props.row)
    const gc = Number(props._grid_col ?? props.col)
    const gPlot = props._grid_plot ?? props.plot
    if (!Number.isFinite(gr) || !Number.isFinite(gc)) return f

    const lookup = transformLookup({ r: gr, c: gc }, fd)
    const csvRow = index.get(`${lookup.r},${lookup.c}`)
    const merged: Record<string, unknown> = {
      _grid_row: gr,
      _grid_col: gc,
      _grid_plot: gPlot,
      ...props,
      ...(csvRow ?? {}),
      // The editor labels its grids "Block 1" under `block`; keep the design's own block.
      ...(csvRow && (csvRow.block ?? csvRow.Block)
        ? { design_block: csvRow.block ?? csvRow.Block }
        : {}),
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
        // Its place in the design's grid (numbered from the design's start).
        const e = designExtent(fd)
        return {
          ...feature,
          properties: {
            ...feature.properties,
            row: rc.r - e.minR + 1,
            col: rc.c - e.minC + 1,
          },
        }
      })

  return {
    ...fc,
    features: applyLabelsToFeatures(source, fd),
  }
}

const NOT_DESIGN = new Set([
  "cellId",
  "blockId",
  "block",
  "role",
  "label",
  "design_block",
])

/**
 * A field design rebuilt from labelled plots: boundaries saved elsewhere (by
 * the agent, or imported from another date) whose cells carry their design's
 * labels — row/col (or tier/bed), plot, accession, crop — but not the
 * editor's own design. Lets the editor reopen them with the design in place.
 * Null when too few cells carry a row and column.
 */
export function designFromFeatures(
  features: GeoJSON.Feature[],
  transform: FdTransform = FD_TRANSFORM_IDENTITY,
): FieldDesign | null {
  const cells = features.filter((f) => f.properties?.role !== "outer")
  if (cells.length === 0) return null
  const rows: FieldDesignRow[] = []
  for (const f of cells) {
    const p = (f.properties ?? {}) as Record<string, unknown>
    const r = Number(p._grid_row ?? p.row ?? p.tier)
    const c = Number(p._grid_col ?? p.col ?? p.bed)
    if (!Number.isFinite(r) || !Number.isFinite(c)) continue
    const row: FieldDesignRow = { row: String(r), col: String(c) }
    for (const [k, v] of Object.entries(p)) {
      if (k.startsWith("_") || NOT_DESIGN.has(k) || k === "row" || k === "col")
        continue
      if (v == null || typeof v === "object") continue
      row[k] = String(v)
    }
    if (p.plot_label != null) row.plot = String(p.plot_label)
    rows.push(row)
  }
  if (rows.length < cells.length * 0.9) return null
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  const esc = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  const csv_text = [
    columns.join(","),
    ...rows.map((r) => columns.map((k) => esc(r[k] ?? "")).join(",")),
  ].join("\n")
  const mapping: Partial<Record<FdTargetKey, string>> = {
    row: "row",
    col: "col",
  }
  for (const k of ["plot", "accession", "crop"] as const)
    if (columns.includes(k)) mapping[k] = k
  return { csv_text, mapping, rows, transform }
}
