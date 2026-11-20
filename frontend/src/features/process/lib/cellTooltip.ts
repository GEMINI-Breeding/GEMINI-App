/**
 * What a plot cell on the boundary map carries from the field design, for the
 * hover tooltip: enough to check the design sits on the field the right way
 * round (plot number, entry, its tier and bed, crop, rep/block).
 */

type Props = Record<string, unknown>

const first = (p: Props, keys: string[]): string | null => {
  for (const k of keys) {
    const v = p[k]
    if (v !== undefined && v !== null && String(v).trim() !== "")
      return String(v)
  }
  return null
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  )

export interface CellInfo {
  plot: string | null
  accession: string | null
  /** The design's row (tier) and column (bed). */
  row: string | null
  col: string | null
  crop: string | null
  rep: string | null
  block: string | null
  /** Where the cell is in the drawn grid, when the design numbers it differently. */
  grid: string | null
}

export function cellInfo(p: Props): CellInfo {
  const row = first(p, ["row", "tier", "Tier", "plot_row_number"])
  const col = first(p, ["col", "bed", "Bed", "plot_column_number"])
  const gr = first(p, ["_grid_row"])
  const gc = first(p, ["_grid_col"])
  return {
    plot: first(p, [
      "plot_label",
      "plot",
      "Plot",
      "plot_id",
      "plot_number",
      "Field.plot.number",
    ]),
    accession: first(p, [
      "accession",
      "Accession",
      "genotype",
      "Genotype",
      "entry",
      "label",
      "line_id",
    ]),
    row,
    col,
    crop: first(p, ["crop", "Crop", "population"]),
    rep: first(p, ["rep", "Rep", "replicate"]),
    block:
      first(p, ["Block", "block_id", "design_block"]) ??
      (typeof p.block === "string" && !/^Block \d+$/.test(p.block)
        ? p.block
        : null),
    grid: gr && gc && (gr !== row || gc !== col) ? `${gr}, ${gc}` : null,
  }
}

/** The tooltip's HTML (values escaped). */
export function cellTooltipHtml(p: Props): string | null {
  const c = cellInfo(p)
  if (!c.plot && !c.accession && !c.row) return null
  const lines: string[] = []
  lines.push(
    `<b>Plot ${esc(c.plot ?? "—")}</b>${c.accession ? ` · ${esc(c.accession)}` : ""}`,
  )
  const where = [c.row && `tier ${esc(c.row)}`, c.col && `bed ${esc(c.col)}`]
    .filter(Boolean)
    .join(", ")
  if (where) lines.push(where)
  const more = [
    c.crop && esc(c.crop),
    c.rep && `rep ${esc(c.rep)}`,
    c.block && `block ${esc(c.block)}`,
  ]
    .filter(Boolean)
    .join(" · ")
  if (more) lines.push(more)
  if (c.grid)
    lines.push(`<span style="opacity:.7">grid cell ${esc(c.grid)}</span>`)
  return lines.join("<br/>")
}
