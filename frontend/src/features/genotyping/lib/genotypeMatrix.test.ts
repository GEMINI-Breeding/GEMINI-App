/**
 * Unit tests for the genotype-matrix CSV/TSV parser.
 *
 * The parser is the load-bearing piece of Phase 9b: a regression here
 * would silently drop data on its way to the backend. Cases pinned:
 *
 *   - CSV + TSV inputs both work (delimiter auto-detected from header).
 *   - Missing optional metadata columns default to null on every row.
 *   - Null-call tokens (NA, ".", "--", "?", "") all map to null in
 *     calls[], so the backend skips those records.
 *   - A row missing variant_name produces a warning + skip rather than
 *     a thrown error (don't kill an otherwise-good matrix).
 *   - Helpful error messages on truly broken input (no header, no
 *     samples, no rows).
 */
import { describe, expect, it } from "vitest"

import {
  GenotypeMatrixParseError,
  parseGenotypeMatrix,
  parseGenotypeMatrixBatches,
} from "./genotypeMatrix"

describe("parseGenotypeMatrix", () => {
  it("parses a simple 2-variant × 3-sample CSV", () => {
    const csv = [
      "variant_name,chromosome,position,alleles,design_sequence,LINE_A,LINE_B,LINE_C",
      "SNP_001,1,12345,A/G,ACGTACGT,A/A,A/G,G/G",
      "SNP_002,1,23456,C/T,GTGTGTGT,C/T,T/T,C/C",
    ].join("\n")

    const out = parseGenotypeMatrix(csv)
    expect(out.sampleHeaders).toEqual(["LINE_A", "LINE_B", "LINE_C"])
    expect(out.variantCount).toBe(2)
    expect(out.batch.sample_headers).toEqual(["LINE_A", "LINE_B", "LINE_C"])
    expect(out.batch.variant_rows[0]).toEqual({
      variant_name: "SNP_001",
      chromosome: 1,
      position: 12345,
      alleles: "A/G",
      design_sequence: "ACGTACGT",
      calls: ["A/A", "A/G", "G/G"],
    })
    expect(out.warnings).toEqual([])
  })

  it("auto-detects tab delimiter when the header is TSV", () => {
    const tsv = [
      "variant_name\tchromosome\tposition\talleles\tdesign_sequence\tLINE_A\tLINE_B",
      "SNP_001\t1\t10\tA/G\tACGT\tA/A\tA/G",
    ].join("\n")
    const out = parseGenotypeMatrix(tsv)
    expect(out.sampleHeaders).toEqual(["LINE_A", "LINE_B"])
    expect(out.batch.variant_rows[0].calls).toEqual(["A/A", "A/G"])
  })

  it("defaults missing optional metadata columns to null", () => {
    // Only variant_name and samples — no chromosome / position / alleles
    // / design_sequence columns.
    const csv = ["variant_name,LINE_A,LINE_B", "SNP_X,A/A,A/G"].join("\n")
    const out = parseGenotypeMatrix(csv)
    expect(out.batch.variant_rows[0]).toEqual({
      variant_name: "SNP_X",
      chromosome: null,
      position: null,
      alleles: null,
      design_sequence: null,
      calls: ["A/A", "A/G"],
    })
  })

  it("normalises null-call tokens to null in calls[]", () => {
    const csv = [
      "variant_name,LINE_A,LINE_B,LINE_C,LINE_D,LINE_E",
      "SNP_X,NA,.,--,?,A/G",
    ].join("\n")
    const out = parseGenotypeMatrix(csv)
    expect(out.batch.variant_rows[0].calls).toEqual([
      null,
      null,
      null,
      null,
      "A/G",
    ])
  })

  it("warns and skips rows missing variant_name", () => {
    const csv = [
      "variant_name,LINE_A",
      "SNP_GOOD,A/G",
      ",A/A",
      "SNP_GOOD2,G/G",
    ].join("\n")
    const out = parseGenotypeMatrix(csv)
    expect(out.variantCount).toBe(2)
    expect(out.batch.variant_rows.map((v) => v.variant_name)).toEqual([
      "SNP_GOOD",
      "SNP_GOOD2",
    ])
    expect(out.warnings).toHaveLength(1)
    expect(out.warnings[0]).toMatch(/Row 3/)
  })

  it("throws on empty file", () => {
    expect(() => parseGenotypeMatrix("")).toThrow(GenotypeMatrixParseError)
  })

  it("throws when no sample columns are present", () => {
    const csv = "variant_name,chromosome,position\nSNP_X,1,100"
    expect(() => parseGenotypeMatrix(csv)).toThrow(/sample columns/i)
  })

  it("throws when variant_name column is missing entirely", () => {
    const csv = "chromosome,position,LINE_A\n1,100,A/G"
    expect(() => parseGenotypeMatrix(csv)).toThrow(/variant_name/i)
  })

  it("throws when only a header is provided (no rows)", () => {
    const csv = "variant_name,LINE_A,LINE_B"
    expect(() => parseGenotypeMatrix(csv)).toThrow(/No variant rows/i)
  })
})

describe("parseGenotypeMatrixBatches", () => {
  function buildCsv(variantCount: number): string {
    const header = "variant_name,chromosome,position,LINE_A,LINE_B"
    const rows = Array.from({ length: variantCount }, (_, i) => {
      const v = `SNP_${String(i + 1).padStart(4, "0")}`
      return `${v},1,${(i + 1) * 100},A/A,A/G`
    })
    return [header, ...rows].join("\n")
  }

  it("yields a single batch when rows fit", () => {
    const csv = buildCsv(3)
    const batches = Array.from(parseGenotypeMatrixBatches(csv, 500))
    expect(batches).toHaveLength(1)
    expect(batches[0].batch.variant_rows).toHaveLength(3)
    expect(batches[0].batch.sample_headers).toEqual(["LINE_A", "LINE_B"])
    expect(batches[0].batchIndex).toBe(0)
    expect(batches[0].totalRows).toBe(3)
  })

  it("splits across batches at the configured size", () => {
    const csv = buildCsv(5)
    const batches = Array.from(parseGenotypeMatrixBatches(csv, 2))
    expect(batches.map((b) => b.batch.variant_rows.length)).toEqual([2, 2, 1])
    expect(batches.map((b) => b.batchIndex)).toEqual([0, 1, 2])
    expect(batches.map((b) => b.totalRows)).toEqual([2, 4, 5])
    // Sample headers stay pinned across every batch.
    for (const b of batches) {
      expect(b.batch.sample_headers).toEqual(["LINE_A", "LINE_B"])
    }
  })

  it("preserves warnings cumulatively across batches", () => {
    const csv = [
      "variant_name,LINE_A,LINE_B",
      "SNP_1,A/A,A/G",
      ",A/A,A/G", // missing variant_name → warning, skipped
      "SNP_2,A/A,A/G",
      "SNP_3,A/A,A/G",
    ].join("\n")
    const batches = Array.from(parseGenotypeMatrixBatches(csv, 2))
    expect(batches).toHaveLength(2)
    expect(batches[0].warnings).toEqual([
      "Row 3: missing variant_name; skipped.",
    ])
    // Second batch carries the same warning forward (cumulative).
    expect(batches[1].warnings).toEqual([
      "Row 3: missing variant_name; skipped.",
    ])
    // Three real rows total split as 2 + 1.
    expect(batches.map((b) => b.batch.variant_rows.length)).toEqual([2, 1])
  })

  it("throws on header-only matrix even in streaming mode", () => {
    const csv = "variant_name,LINE_A,LINE_B"
    expect(() => Array.from(parseGenotypeMatrixBatches(csv, 500))).toThrow(
      /No variant rows/i,
    )
  })

  it("rejects non-positive batchSize", () => {
    expect(() =>
      Array.from(parseGenotypeMatrixBatches("variant_name,L\nSNP_1,A", 0)),
    ).toThrow(GenotypeMatrixParseError)
  })
})
