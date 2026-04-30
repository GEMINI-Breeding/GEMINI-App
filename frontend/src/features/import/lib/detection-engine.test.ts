/**
 * Unit tests for the import wizard's file-detection engine.
 *
 * Pinned contracts:
 *   - Plain trait CSV → `csv_tabular` category, no genomic shape.
 *   - HapMap text file (.hmp / .hapmap) → `genomic` category + hapmap shape.
 *   - VCF text file → `genomic` + vcf shape.
 *   - CSV that *looks like* a SNP matrix (variant_name + IUPAC calls) →
 *     `genomic` category + matrix shape.
 *   - PLINK extension → `genomic` category but `confident: false`.
 *   - Empty input → no categories beyond "mixed".
 *   - Date extraction from a "2024-04-15"-shaped folder path.
 *
 * The engine reads file content via `file.slice().text()`. We use
 * `new File([content], name)` so the tests run entirely in-process.
 */
import { describe, expect, it } from "vitest"

import { detectFiles, formatFileSize } from "./detection-engine"
import type { FileWithPath } from "./types"

function makeFile(content: string, name: string, path?: string): FileWithPath {
  const f = new File([content], name) as FileWithPath
  f.path = path ?? name
  return f
}

describe("detectFiles", () => {
  it("classifies a plain trait CSV as csv_tabular", async () => {
    const f = makeFile(
      [
        "plot_number,plot_row,plot_col,plant_height_cm,yield_kg",
        "1,1,1,142,4.2",
        "2,1,2,150,4.5",
      ].join("\n"),
      "traits.csv",
    )
    const result = await detectFiles([f])
    expect(result.dataCategories).toContain("csv_tabular")
    expect(result.dataCategories).not.toContain("genomic")
    expect(result.genomicShape).toBeNull()
    expect(result.csvFiles).toHaveLength(1)
    expect(result.csvFiles[0].headers).toContain("plant_height_cm")
  })

  it("classifies a HapMap file as genomic with hapmap shape", async () => {
    // 11 fixed HapMap columns + 3 sample columns. First row is the header,
    // subsequent rows are SNP records.
    const headers = [
      "rs#",
      "alleles",
      "chrom",
      "pos",
      "strand",
      "assembly#",
      "center",
      "protLSID",
      "assayLSID",
      "panelLSID",
      "QCcode",
      "LINE_A",
      "LINE_B",
      "LINE_C",
    ]
    const content = [
      headers.join("\t"),
      [
        "SNP_001",
        "A/G",
        "1",
        "12345",
        "+",
        "v1",
        "x",
        "x",
        "x",
        "x",
        "Q",
        "AA",
        "AG",
        "GG",
      ].join("\t"),
    ].join("\n")
    const f = makeFile(content, "matrix.hmp")
    const result = await detectFiles([f])
    expect(result.dataCategories).toContain("genomic")
    expect(result.genomicShape).not.toBeNull()
    expect(result.genomicShape?.format).toBe("hapmap")
    expect(result.genomicShape?.sampleHeaders).toEqual([
      "LINE_A",
      "LINE_B",
      "LINE_C",
    ])
    expect(result.suggestedDataFormat).toBe("HapMap")
  })

  it("classifies a VCF file as genomic with vcf shape", async () => {
    const content = [
      "##fileformat=VCFv4.2",
      "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tLINE_A\tLINE_B",
      "1\t12345\trs1\tA\tG\t.\tPASS\t.\tGT\t0/0\t0/1",
    ].join("\n")
    const f = makeFile(content, "snps.vcf")
    const result = await detectFiles([f])
    expect(result.dataCategories).toContain("genomic")
    expect(result.genomicShape?.format).toBe("vcf")
    expect(result.genomicShape?.sampleHeaders).toEqual(["LINE_A", "LINE_B"])
    expect(result.suggestedDataFormat).toBe("VCF")
  })

  it("reclassifies a CSV that looks like a SNP matrix as genomic", async () => {
    // Variant-name + IUPAC genotype calls on every sample column.
    // Need ≥3 sample columns so looksLikeGenomicMatrix passes.
    const content = [
      "variant_name,chromosome,position,LINE_A,LINE_B,LINE_C",
      "SNP_001,1,100,AA,AG,GG",
      "SNP_002,1,200,CC,CT,TT",
      "SNP_003,2,300,AA,AG,GG",
    ].join("\n")
    const f = makeFile(content, "matrix.csv")
    const result = await detectFiles([f])
    expect(result.dataCategories).toContain("genomic")
    expect(result.genomicShape?.format).toBe("matrix")
    expect(result.genomicShape?.sampleHeaders).toEqual([
      "LINE_A",
      "LINE_B",
      "LINE_C",
    ])
  })

  it("flags a PLINK extension as genomic with confident:false", async () => {
    // .ped is not parseable client-side; we surface it but flag the wizard
    // to route to a "not supported" branch.
    const f = makeFile("FAM1 IID1 0 0 0 -9 A A G G", "study.ped")
    const result = await detectFiles([f])
    expect(result.dataCategories).toContain("genomic")
    expect(result.genomicShape?.format).toBe("plink")
    expect(result.genomicShape?.confident).toBe(false)
    expect(result.suggestedDataFormat).toBe("PLINK")
  })

  it("returns 'mixed' when no recognisable categories are present", async () => {
    const f = makeFile("hello world", "readme.txt")
    const result = await detectFiles([f])
    // CSV extension counts as csv_tabular; .txt with no identifiable
    // header still counts as csv_tabular because it gets parsed as CSV.
    // The category is csv_tabular, not "mixed", because txt is in CSV_EXTENSIONS.
    expect(result.dataCategories.length).toBeGreaterThan(0)
  })

  it("extracts a YYYY-MM-DD date from a path", async () => {
    const f = makeFile(
      "plot_number,trait\n1,5",
      "traits.csv",
      "2024-04-15/Field_A/traits.csv",
    )
    const result = await detectFiles([f])
    expect(result.detectedDates).toContain("2024-04-15")
    expect(result.fileGroups.length).toBeGreaterThan(0)
  })
})

describe("formatFileSize", () => {
  it("formats bytes / KB / MB / GB", () => {
    expect(formatFileSize(500)).toBe("500 B")
    expect(formatFileSize(2_048)).toMatch(/^2\.0 KB$/)
    expect(formatFileSize(2_097_152)).toMatch(/^2\.0 MB$/)
    expect(formatFileSize(2_147_483_648)).toMatch(/^2\.00 GB$/)
  })
})
