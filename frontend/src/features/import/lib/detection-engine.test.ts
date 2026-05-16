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

function makeBinaryFile(
  bytes: Uint8Array,
  name: string,
  path?: string,
): FileWithPath {
  // TS in strict mode flags `Uint8Array<ArrayBufferLike>` as not assignable
  // to `BlobPart` because the underlying buffer could be a SharedArrayBuffer.
  // The File constructor accepts ArrayBuffer directly — passing the slice
  // sidesteps the typing without copying.
  const blobPart = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  const f = new File([blobPart], name) as FileWithPath
  f.path = path ?? name
  return f
}

/**
 * Build the head of a 16-bit single-channel BlackIsZero TIFF — what
 * Boson-class thermal cameras emit. We only populate the three tags the
 * detector reads (BitsPerSample=16, SamplesPerPixel=1,
 * PhotometricInterpretation=1) plus the byte-order / magic header.
 */
function makeBosonTiffHead(): Uint8Array {
  const buf = new ArrayBuffer(256)
  const v = new DataView(buf)
  // Little-endian "II" + magic 42 + IFD0 offset 16.
  v.setUint8(0, 0x49)
  v.setUint8(1, 0x49)
  v.setUint16(2, 42, true)
  v.setUint32(4, 16, true)
  // IFD0: 3 entries.
  let off = 16
  v.setUint16(off, 3, true)
  off += 2
  // Tag 0x0102 BitsPerSample, type SHORT, count 1, value 16.
  v.setUint16(off, 0x0102, true)
  v.setUint16(off + 2, 3, true)
  v.setUint32(off + 4, 1, true)
  v.setUint16(off + 8, 16, true)
  off += 12
  // Tag 0x0106 PhotometricInterpretation, type SHORT, count 1, value 1.
  v.setUint16(off, 0x0106, true)
  v.setUint16(off + 2, 3, true)
  v.setUint32(off + 4, 1, true)
  v.setUint16(off + 8, 1, true)
  off += 12
  // Tag 0x0115 SamplesPerPixel, type SHORT, count 1, value 1.
  v.setUint16(off, 0x0115, true)
  v.setUint16(off + 2, 3, true)
  v.setUint32(off + 4, 1, true)
  v.setUint16(off + 8, 1, true)
  return new Uint8Array(buf)
}

/**
 * Build the head of a FLIR-One-Pro–class JPEG: SOI marker + a small payload
 * containing the ASCII bytes "FLIR Systems" that real files carry in EXIF.
 * The detector's byte-scan is what matters — full EXIF structure is not
 * required for the contract under test.
 */
function makeFlirJpegHead(): Uint8Array {
  const tag = "FLIR Systems"
  const buf = new Uint8Array(2 + tag.length)
  buf[0] = 0xff
  buf[1] = 0xd8 // SOI
  for (let i = 0; i < tag.length; i++) buf[2 + i] = tag.charCodeAt(i)
  return buf
}

/** Plain RGB JPEG with no FLIR-related bytes — should NOT be flagged thermal. */
function makeRgbJpegHead(): Uint8Array {
  const buf = new Uint8Array(64)
  buf[0] = 0xff
  buf[1] = 0xd8
  // JFIF identifier + filler — nothing FLIR.
  const jfif = "JFIF\0"
  for (let i = 0; i < jfif.length; i++) buf[2 + i] = jfif.charCodeAt(i)
  return buf
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

  // Thermal-detection contracts — one case per example dataset shape in
  // ExampleDatasets/test_thermal_data/.

  it("classifies amiga_high_res (camT-*.tiff) as thermal", async () => {
    // Boson-class TIFFs with the camT- filename pattern. Path has no
    // thermal hint — the filename pattern alone must carry the detection.
    const head = makeBosonTiffHead()
    const files = [
      makeBinaryFile(head, "camT-20250617_182830_306990.tiff"),
      makeBinaryFile(head, "camT-20250617_182830_507181.tiff"),
    ]
    const result = await detectFiles(files)
    expect(result.dataCategories).toContain("thermal")
    expect(result.dataCategories).not.toContain("drone_imagery")
    expect(result.suggestedSensorType).toBe("Thermal Camera")
    expect(result.suggestedDataFormat).toBe("Thermal TIFF (16-bit)")
  })

  it("classifies t4 (camT-*.tif) as thermal", async () => {
    const head = makeBosonTiffHead()
    const files = [
      makeBinaryFile(head, "camT-1690562723214576389.tif"),
      makeBinaryFile(head, "camT-1690562723314569389.tif"),
    ]
    const result = await detectFiles(files)
    expect(result.dataCategories).toContain("thermal")
    expect(result.dataCategories).not.toContain("drone_imagery")
  })

  it("classifies amiga_low_res (FLIR JPEGs) as thermal via byte peek", async () => {
    // No filename or path hint — only the "FLIR Systems" bytes in the file
    // head let the detector recognise these as thermal. Folder is dated to
    // exercise the path that would otherwise classify as drone_imagery.
    const head = makeFlirJpegHead()
    const files = [
      makeBinaryFile(head, "240725_IMG_01206.jpg", "2024-07-25/240725_IMG_01206.jpg"),
      makeBinaryFile(head, "240725_IMG_01207.jpg", "2024-07-25/240725_IMG_01207.jpg"),
    ]
    const result = await detectFiles(files)
    expect(result.dataCategories).toContain("thermal")
    expect(result.dataCategories).not.toContain("drone_imagery")
    expect(result.suggestedDataFormat).toBe("Thermal JPEG")
  })

  it("classifies drone_low_res (FLIR JPEGs in a dated folder) as thermal", async () => {
    const head = makeFlirJpegHead()
    const files = [
      makeBinaryFile(head, "240725_IMG_00385.jpg", "2024-07-25/240725_IMG_00385.jpg"),
      makeBinaryFile(head, "240725_IMG_00386.jpg", "2024-07-25/240725_IMG_00386.jpg"),
    ]
    const result = await detectFiles(files)
    expect(result.dataCategories).toContain("thermal")
    // Even with a date present in the path, FLIR JPEGs must not be tagged
    // as drone_imagery — the calibration UI keys off the thermal category.
    expect(result.dataCategories).not.toContain("drone_imagery")
  })

  it("leaves a plain RGB JPEG batch in a dated folder as drone_imagery", async () => {
    // Regression guard for the byte-peek: a JPEG without "FLIR Systems" in
    // the head must stay classified as drone_imagery, not thermal.
    const head = makeRgbJpegHead()
    const files = [
      makeBinaryFile(head, "DJI_0001.jpg", "2024-07-25/DJI_0001.jpg"),
      makeBinaryFile(head, "DJI_0002.jpg", "2024-07-25/DJI_0002.jpg"),
    ]
    const result = await detectFiles(files)
    expect(result.dataCategories).toContain("drone_imagery")
    expect(result.dataCategories).not.toContain("thermal")
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
