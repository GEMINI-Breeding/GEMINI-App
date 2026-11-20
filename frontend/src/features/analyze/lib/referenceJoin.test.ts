import { describe, expect, it } from "vitest"
import type { MatrixRow } from "./multivariate"
import {
  attachReference,
  datasetsForScope,
  isRefColumn,
  type RefDataset,
  refColumnName,
} from "./referenceJoin"

const row = (
  plot: number,
  r: number,
  c: number,
  height: number,
): MatrixRow => ({
  plot_number: plot,
  plot_row_number: r,
  plot_column_number: c,
  values: { height },
})

const ds = (over: Partial<RefDataset> = {}): RefDataset => ({
  id: "d1",
  name: "Hand LAI",
  experiment: "Exp",
  location: "Davis",
  population: "Cowpea",
  trait_columns: ["LAI"],
  ...over,
})

describe("datasetsForScope", () => {
  const all = [
    ds({ id: "a" }),
    ds({ id: "b", population: "" }),
    ds({ id: "c", population: "Bean" }),
    ds({ id: "d", location: "Kearney" }),
  ]
  it("keeps same-population and population-less datasets", () => {
    const ids = datasetsForScope(all, {
      experiment: "exp",
      location: "davis",
      population: "Cowpea",
    }).map((d) => d.id)
    expect(ids).toEqual(["a", "b"])
  })
  it("with no population picked, keeps every population at the site", () => {
    const ids = datasetsForScope(all, {
      experiment: "Exp",
      location: "Davis",
    }).map((d) => d.id)
    expect(ids).toEqual(["a", "b", "c"])
  })
})

describe("attachReference", () => {
  it("matches by plot_id and adds a named column", () => {
    const out = attachReference(
      [row(1, 1, 1, 10), row(2, 1, 2, 20)],
      [
        {
          dataset: ds(),
          plots: [{ plot_id: "2", traits: { LAI: 3.5 } }],
        },
      ],
    )
    const col = refColumnName("LAI", "Hand LAI")
    expect(out.columns).toEqual([col])
    expect(out.rows[0].values[col]).toBeUndefined()
    expect(out.rows[1].values).toEqual({ height: 20, [col]: 3.5 })
  })

  it("falls back to row/col when plot_id is absent", () => {
    const out = attachReference(
      [row(7, 3, 4, 10)],
      [
        {
          dataset: ds(),
          plots: [{ plot_row: "3", plot_column: "4", traits: { LAI: "2.25" } }],
        },
      ],
    )
    expect(out.rows[0].values[refColumnName("LAI", "Hand LAI")]).toBe(2.25)
  })

  it("prefers plot_id over row/col", () => {
    const out = attachReference(
      [row(5, 1, 1, 0)],
      [
        {
          dataset: ds(),
          plots: [
            { plot_row: "1", plot_column: "1", traits: { LAI: 1 } },
            { plot_id: "5", traits: { LAI: 9 } },
          ],
        },
      ],
    )
    expect(out.rows[0].values[refColumnName("LAI", "Hand LAI")]).toBe(9)
  })

  it("adds no column when nothing matches, and drops non-numeric values", () => {
    const out = attachReference(
      [row(1, 1, 1, 10)],
      [
        { dataset: ds(), plots: [{ plot_id: "701", traits: { LAI: 1 } }] },
        {
          dataset: ds({ id: "d2", name: "Notes", trait_columns: ["note"] }),
          plots: [{ plot_id: "1", traits: { note: "lodged" } }],
        },
      ],
    )
    expect(out.columns).toEqual([])
    expect(out.rows[0].values).toEqual({ height: 10 })
  })

  it("identifies reference columns by name", () => {
    expect(isRefColumn(refColumnName("LAI", "Hand LAI"))).toBe(true)
    expect(isRefColumn("height")).toBe(false)
  })
})
