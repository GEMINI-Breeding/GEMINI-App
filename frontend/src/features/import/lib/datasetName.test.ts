/**
 * Tests for buildDatasetName — the import wizard's auto-name generator.
 *
 * Key invariants we lock down:
 *  - Never emits today's date (or any date) on its own as a fallback —
 *    that would lie about the data's collection date.
 *  - Always appends a hex disambiguator so re-uploads are unique by default.
 *  - Category labels are humanised (csv_tabular → "Traits").
 */
import { describe, expect, it } from "vitest"

import { buildDatasetName, shortHex } from "./datasetName"

describe("buildDatasetName", () => {
  it("uses the experiment name and category label, plus a hex tag", () => {
    const name = buildDatasetName({
      expName: "GEMINI",
      category: "csv_tabular",
      hex: "a3f7",
    })
    expect(name).toBe("GEMINI - Traits - a3f7")
  })

  it("includes the collection date when one is provided", () => {
    const name = buildDatasetName({
      expName: "GEMINI",
      category: "csv_tabular",
      collectionDate: "2024-06-15",
      hex: "a3f7",
    })
    expect(name).toBe("GEMINI - Traits - 2024-06-15 - a3f7")
  })

  it("omits the date entirely when none is detected — never falls back to today", () => {
    const name = buildDatasetName({
      expName: "GEMINI",
      category: "csv_tabular",
      collectionDate: null,
      hex: "a3f7",
    })
    // Crucially: no "2026" or any other YYYY-MM-DD substring.
    expect(name).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(name).toBe("GEMINI - Traits - a3f7")
  })

  it("falls back to 'Collection' when the experiment name is empty", () => {
    expect(
      buildDatasetName({ expName: null, category: "csv_tabular", hex: "a3f7" }),
    ).toBe("Collection - Traits - a3f7")
    expect(
      buildDatasetName({ expName: "   ", category: "csv_tabular", hex: "a3f7" }),
    ).toBe("Collection - Traits - a3f7")
  })

  it("renders category labels for known categories", () => {
    expect(
      buildDatasetName({ expName: "X", category: "drone_imagery", hex: "0001" }),
    ).toBe("X - Imagery - 0001")
    expect(
      buildDatasetName({ expName: "X", category: "genomic", hex: "0002" }),
    ).toBe("X - Genomic - 0002")
    expect(
      buildDatasetName({ expName: "X", category: "thermal", hex: "0003" }),
    ).toBe("X - Thermal - 0003")
  })

  it("skips the category segment for unknown categories", () => {
    expect(
      buildDatasetName({ expName: "X", category: "unknown_blah", hex: "0004" }),
    ).toBe("X - 0004")
    expect(
      buildDatasetName({ expName: "X", category: null, hex: "0005" }),
    ).toBe("X - 0005")
  })

  it("generates a 4-char lowercase hex by default", () => {
    const name = buildDatasetName({ expName: "X" })
    const m = name.match(/ - ([0-9a-f]{4})$/)
    expect(m).not.toBeNull()
  })
})

describe("shortHex", () => {
  it("pads to 4 characters", () => {
    // Inject a deterministic rng so the hex is reproducible.
    expect(shortHex(() => 0)).toBe("0000")
    expect(shortHex(() => 0.5)).toBe("8000")
    // 0x10000 is the upper bound (exclusive); the largest representable
    // value is 0xffff, which we get just below the bound.
    expect(shortHex(() => 0xffff / 0x10000)).toBe("ffff")
  })
})
