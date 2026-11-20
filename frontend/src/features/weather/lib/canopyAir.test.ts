import { describe, expect, it } from "vitest"

import {
  canopyAir,
  meanAround,
  type Station,
  stationFor,
  vpd,
  wallClock,
} from "./canopyAir"

function station(name: string, treatment: string, base: number): Station {
  // One reading a minute, 09:00–11:59, warming 0.1 °C a minute.
  const rows = []
  for (let m = 0; m < 180; m++) {
    const hh = String(9 + Math.floor(m / 60)).padStart(2, "0")
    const mm = String(m % 60).padStart(2, "0")
    rows.push({
      time: `2026-07-27 ${hh}:${mm}:00`,
      values: { air_temp_c: base + m * 0.1, rh: 40 },
    })
  }
  return {
    meta: {
      station: name,
      treatment,
      columns: ["air_temp_c", "rh"],
      describe: {},
      interval_minutes: 1,
      first: rows[0].time,
      last: rows[rows.length - 1].time,
      rows: rows.length,
      files: [],
      clock: "",
      uploaded: "",
    },
    columns: ["air_temp_c", "rh"],
    rows,
  }
}

describe("canopy − air temperature", () => {
  it("reads the wall clock as stored", () => {
    expect(wallClock("2026-07-27T09:34:07-07:00")).toBe("2026-07-27 09:34:07")
    expect(wallClock("2026-07-27 09:34")).toBe("2026-07-27 09:34:00")
    expect(wallClock("bad")).toBeNull()
  })

  it("averages air temperature around a time", () => {
    const s = station("A", "", 20)
    // 09:50 is minute 50 → 25.0; ±10 min is symmetric, so the mean is 25.0.
    expect(
      meanAround(s.rows, "air_temp_c", "2026-07-27 09:50:00", 10),
    ).toBeCloseTo(25)
    expect(
      meanAround(s.rows, "air_temp_c", "2026-07-28 09:50:00", 10),
    ).toBeNull()
  })

  it("computes VPD", () => {
    expect(vpd(25, 50)).toBeCloseTo(1.584, 2)
  })

  it("matches stations by treatment, whole words only", () => {
    const st = [station("S1", "well-watered", 20), station("S2", "drought", 20)]
    expect(
      stationFor(st, "PLOT_FRAMES · x · Thermal frames · drought", []),
    ).toBe(1)
    expect(stationFor(st, "run", ["Well-Watered"])).toBe(0)
    expect(stationFor(st, "watered plots", [])).toBeNull()
  })

  it("gives CTD per plot and against the flight's median", () => {
    const st = [station("S1", "wet", 20), station("S2", "dry", 22)]
    const rec = (plot: number, v: number) => ({
      trait_value: v,
      timestamp: "2026-07-27T09:50:00-07:00",
      dataset_name: "PLOT_FRAMES · run · 1234abcd",
      plot_number: plot,
      population_name: "Cowpea",
    })
    const out = canopyAir([rec(1, 24), rec(2, 26), rec(3, 28)], st, {
      choice: "mean",
    })
    // Mean of the two stations at 09:50: (25 + 27) / 2 = 26.
    expect(out.rows.map((r) => r.ctd)).toEqual(
      [-2, 0, 2].map((v) => expect.closeTo(v)),
    )
    expect(out.rows.map((r) => r.ctdRel)).toEqual(
      [-2, 0, 2].map((v) => expect.closeTo(v)),
    )
    expect(out.flights).toHaveLength(1)
    expect(out.flights[0].time).toBe("09:50")

    const one = canopyAir([rec(1, 24)], st, { choice: 1 })
    expect(one.rows[0].air).toBeCloseTo(27)
    expect(one.rows[0].station).toBe("S2")
  })

  it("leaves out readings with no air temperature near them", () => {
    const st = [station("S1", "", 20)]
    const out = canopyAir(
      [
        {
          trait_value: 30,
          timestamp: "2026-08-01T10:00:00",
          dataset_name: "x",
        },
      ],
      st,
      { choice: "mean" },
    )
    expect(out.rows).toHaveLength(0)
    expect(out.missing).toBe(1)
  })
})
