/**
 * File-type detection engine for the /import wizard.
 *
 * Ported verbatim from
 * `backend/gemini-ui/src/components/import-wizard/detection-engine.ts`.
 * Only adaptation is the `FileWithPath` import — gemini-ui pulled it from a
 * `react-dropzone`-augmented dropzone module; we define it locally in
 * `./types` since our app uses a native UploadZone.
 *
 * Detection inspects file extensions plus a small content peek (first
 * 8–16 KB) to classify each file. Output drives the WizardShell branch
 * (genomic vs tabular) and the StepDetect summary panel.
 */
import {
  jpegLooksLikeFlir as sharedJpegLooksLikeFlir,
  tiffLooksLikeThermal as sharedTiffLooksLikeThermal,
} from "@/lib/thermalProbe"

import type { FileWithPath } from "./types"

export interface DetectedFileGroup {
  date: string | null
  folder: string
  files: FileWithPath[]
  fileCount: number
  totalSize: number
}

export interface DetectedCsv {
  file: FileWithPath
  name: string
  headers: string[]
  sampleRows: string[][]
  category:
    | "field_design"
    | "gcp_locations"
    | "trait_data"
    | "sensor_data"
    | "genomic_matrix"
    | "unknown"
}

export interface GenomicMatrixShape {
  format: "matrix" | "hapmap" | "vcf" | "plink"
  /** Zero-based index of the header row; 0 unless a banner row precedes it. */
  headerRowIndex: number
  metadataColumnIndices: number[]
  sampleColumnIndices: number[]
  sampleHeaders: string[]
  variantNameColumnIndex: number | null
  chromosomeColumnIndex: number | null
  positionColumnIndex: number | null
  allelesColumnIndex: number | null
  designSequenceColumnIndex: number | null
  /** True when we're confident; false when we guessed a fallback. */
  confident: boolean
}

export type DataCategory =
  | "drone_imagery"
  | "csv_tabular"
  | "genomic"
  | "thermal"
  | "elevation"
  | "mixed"

export interface DetectionResult {
  fileGroups: DetectedFileGroup[]
  csvFiles: DetectedCsv[]
  totalFiles: number
  totalSize: number
  detectedDates: string[]
  suggestedDataFormat: string
  suggestedSensorType: string | null
  suggestedPlatform: string | null
  suggestedExperimentName: string | null
  suggestedSiteName: string | null
  dataCategories: DataCategory[]
  genomicShape?: GenomicMatrixShape | null
  genomicFile?: FileWithPath | null
}

const DATE_PATTERN = /(\d{4})-(\d{2})-(\d{2})/
const DJI_PATTERN = /DJI_\d{4}/i
const AMIGA_PATTERN = /Amiga/i
// `camT-<timestamp>.tif[f]` — emitted by farm-ng Amiga / T4 thermal-capture
// rigs. The example datasets in ExampleDatasets/test_thermal_data/ all use
// this convention; the TIFFs themselves carry no Make/Model EXIF, so this
// filename pattern is our only fast signal for Boson-class output.
const THERMAL_FILENAME_PATTERN = /^camT[-_]/i
// Folder-name substrings that strongly imply thermal. Kept conservative —
// these don't fire on plain RGB datasets.
const THERMAL_PATH_HINTS = ["flir", "thermal", "boson", "/t4/", "irx"]

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "tif", "tiff"])
const JPEG_EXTENSIONS = new Set(["jpg", "jpeg"])
const TIFF_EXTENSIONS = new Set(["tif", "tiff"])
const GENOMIC_EXTENSIONS = new Set([
  "vcf",
  "hapmap",
  "hmp",
  "ped",
  "map",
  "bed",
  "bim",
  "fam",
])
const HAPMAP_EXTENSIONS = new Set(["hmp", "hapmap"])
const VCF_EXTENSIONS = new Set(["vcf"])
const PLINK_EXTENSIONS = new Set(["ped", "map", "bed", "bim", "fam"])
const CSV_EXTENSIONS = new Set(["csv", "tsv", "txt"])
const SPREADSHEET_EXTENSIONS = new Set(["xlsx", "xls", "ods"])
const THERMAL_EXTENSIONS = new Set(["fff", "seq"])

const VARIANT_NAME_HEADER_RE =
  /^(snp[\s_]?name|rs#?|marker|variant[_\s]?name|id)$/i
const CHROMOSOME_HEADER_RE = /^(chr(om(osome)?)?|#chrom)$/i
const POSITION_HEADER_RE = /^(pos(ition)?|bp|cm|map[\s_]?pos)$/i
const ALLELES_HEADER_RE = /^(alleles?|snp[_\s]?allele|ref[/\\]?alt)$/i
const DESIGN_SEQ_HEADER_RE =
  /^(design[_\s]?seq(uence)?|flanking[_\s]?seq(uence)?|sequence)$/i
/** Two-letter IUPAC genotype calls, single-base, or numeric 0/1/2. */
const GENOTYPE_CALL_RE = /^([ACGTNacgtn-]{1,2}|[012]|NA|-)$/

function getExtension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() || ""
}

function extractDateFromPath(path: string): string | null {
  const match = path.match(DATE_PATTERN)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null
}

function inferSiteName(paths: string[]): string | null {
  for (const p of paths) {
    const parts = p.split("/")
    for (const part of parts) {
      const cleaned = part
        .replace(DATE_PATTERN, "")
        .replace(/^-|-$/g, "")
        .trim()
      if (
        cleaned.length > 2 &&
        !cleaned.match(/^\d+$/) &&
        !cleaned.match(/DJI|MEDIA|DCIM/i)
      ) {
        return cleaned
      }
    }
  }
  return null
}

function categorizeCSV(
  headers: string[],
  sampleRows: string[][] = [],
): DetectedCsv["category"] {
  if (looksLikeGenomicMatrix(headers, sampleRows)) {
    return "genomic_matrix"
  }
  const lower = headers.map((h) => h.toLowerCase())
  if (
    lower.some(
      (h) =>
        h.includes("plot") &&
        (h.includes("row") || h.includes("col") || h.includes("range")),
    )
  ) {
    return "field_design"
  }
  if (
    lower.some(
      (h) =>
        h.includes("gcp") ||
        h.includes("ground_control") ||
        (h.includes("lat") && lower.some((l) => l.includes("lon"))),
    )
  ) {
    return "gcp_locations"
  }
  if (
    lower.some(
      (h) =>
        h.includes("trait") ||
        h.includes("measurement") ||
        h.includes("phenotype"),
    )
  ) {
    return "trait_data"
  }
  if (
    lower.some(
      (h) =>
        h.includes("sensor") ||
        h.includes("temperature") ||
        h.includes("humidity"),
    )
  ) {
    return "sensor_data"
  }
  return "unknown"
}

function looksLikeGenomicMatrix(
  headers: string[],
  sampleRows: string[][],
): boolean {
  if (headers.length < 4 || sampleRows.length === 0) return false

  const metadataIndices = new Set<number>()
  let hasVariantName = false
  headers.forEach((h, i) => {
    const trimmed = (h || "").trim()
    if (VARIANT_NAME_HEADER_RE.test(trimmed)) {
      metadataIndices.add(i)
      hasVariantName = true
    } else if (CHROMOSOME_HEADER_RE.test(trimmed)) metadataIndices.add(i)
    else if (POSITION_HEADER_RE.test(trimmed)) metadataIndices.add(i)
    else if (ALLELES_HEADER_RE.test(trimmed)) metadataIndices.add(i)
    else if (DESIGN_SEQ_HEADER_RE.test(trimmed)) metadataIndices.add(i)
  })

  if (!hasVariantName) return false

  const sampleIndices = headers
    .map((_, i) => i)
    .filter((i) => !metadataIndices.has(i))

  if (sampleIndices.length < 3) return false

  let total = 0
  let matches = 0
  for (const row of sampleRows.slice(0, 3)) {
    for (const idx of sampleIndices) {
      const cell = (row[idx] ?? "").toString().trim()
      if (!cell) continue
      total++
      if (GENOTYPE_CALL_RE.test(cell)) matches++
    }
  }
  if (total === 0) return false
  return matches / total >= 0.6
}

export function buildMatrixShape(
  headers: string[],
  format: GenomicMatrixShape["format"] = "matrix",
  headerRowIndex = 0,
): GenomicMatrixShape | null {
  let variantNameColumnIndex: number | null = null
  let chromosomeColumnIndex: number | null = null
  let positionColumnIndex: number | null = null
  let allelesColumnIndex: number | null = null
  let designSequenceColumnIndex: number | null = null
  const metadataColumnIndices: number[] = []

  headers.forEach((h, i) => {
    const trimmed = (h || "").trim()
    if (VARIANT_NAME_HEADER_RE.test(trimmed)) {
      if (variantNameColumnIndex === null) variantNameColumnIndex = i
      metadataColumnIndices.push(i)
    } else if (CHROMOSOME_HEADER_RE.test(trimmed)) {
      chromosomeColumnIndex = i
      metadataColumnIndices.push(i)
    } else if (POSITION_HEADER_RE.test(trimmed)) {
      positionColumnIndex = i
      metadataColumnIndices.push(i)
    } else if (ALLELES_HEADER_RE.test(trimmed)) {
      allelesColumnIndex = i
      metadataColumnIndices.push(i)
    } else if (DESIGN_SEQ_HEADER_RE.test(trimmed)) {
      designSequenceColumnIndex = i
      metadataColumnIndices.push(i)
    }
  })

  if (variantNameColumnIndex === null) return null

  const metaSet = new Set(metadataColumnIndices)
  const sampleColumnIndices: number[] = []
  const sampleHeaders: string[] = []
  headers.forEach((h, i) => {
    if (metaSet.has(i)) return
    const trimmed = (h || "").trim()
    if (!trimmed) return
    sampleColumnIndices.push(i)
    sampleHeaders.push(trimmed)
  })

  return {
    format,
    headerRowIndex,
    metadataColumnIndices,
    sampleColumnIndices,
    sampleHeaders,
    variantNameColumnIndex,
    chromosomeColumnIndex,
    positionColumnIndex,
    allelesColumnIndex,
    designSequenceColumnIndex,
    confident: true,
  }
}

function splitCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (char === delimiter && !inQuotes) {
      result.push(current.trim())
      current = ""
      continue
    }
    current += char
  }
  result.push(current.trim())
  return result
}

function readBoundedText(file: File, bytes: number): Promise<string> {
  // FileReader supports both jsdom and real browsers (`File.text()` is
  // missing in jsdom 22's File polyfill). Reading the whole file then
  // slicing keeps peak memory bounded by file size; in production
  // callers cap the budget at ~16 KB so this is fine.
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? "")
      resolve(result.length > bytes ? result.slice(0, bytes) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error("read failed"))
    reader.readAsText(file)
  })
}

async function parseCSVPreview(file: FileWithPath): Promise<DetectedCsv> {
  const text = await readBoundedText(file, 8192)
  const lines = text.split("\n").filter((l) => l.trim())
  const delimiter = lines[0]?.includes("\t") ? "\t" : ","
  const headers = lines[0] ? splitCSVLine(lines[0], delimiter) : []
  const sampleRows = lines
    .slice(1, 4)
    .map((line) => splitCSVLine(line, delimiter))

  return {
    file,
    name: file.name,
    headers,
    sampleRows,
    category: categorizeCSV(headers, sampleRows),
  }
}

function readArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error("read failed"))
    reader.readAsArrayBuffer(file)
  })
}

async function peekSpreadsheet(file: FileWithPath): Promise<{
  headers: string[]
  sampleRows: string[][]
  headerRowIndex: number
} | null> {
  try {
    const XLSX = await import("xlsx")
    const buffer = await readArrayBuffer(file)
    const workbook = XLSX.read(buffer, { type: "array", sheetRows: 8 })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) return null
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) return null
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
    })
    let headerRowIndex = 0
    for (let i = 0; i < Math.min(raw.length, 5); i++) {
      const row = raw[i] ?? []
      const populated = row.filter((c) => c !== "" && c != null).length
      if (populated >= 4) {
        headerRowIndex = i
        break
      }
    }
    const headerRow = (raw[headerRowIndex] ?? []).map((c) =>
      String(c ?? "").trim(),
    )
    const sampleRows = raw
      .slice(headerRowIndex + 1, headerRowIndex + 4)
      .map((r) => (r ?? []).map((c) => String(c ?? "")))
    return { headers: headerRow, sampleRows, headerRowIndex }
  } catch {
    return null
  }
}

async function peekTextHead(
  file: FileWithPath,
  bytes = 16384,
): Promise<string> {
  return readBoundedText(file, bytes)
}

// Probes used to live inline here. They moved to `src/lib/thermalProbe.ts`
// so the legacy Image Data upload form can call the exact same byte
// scans without depending on the wizard's detection-engine surface.
// Thin wrappers preserve the FileWithPath-typed signatures the caller
// already uses.
function jpegLooksLikeFlir(file: FileWithPath): Promise<boolean> {
  return sharedJpegLooksLikeFlir(file)
}

function tiffLooksLikeThermal(file: FileWithPath): Promise<boolean> {
  return sharedTiffLooksLikeThermal(file)
}

function pathHasThermalHint(path: string): boolean {
  const lower = path.toLowerCase()
  return THERMAL_PATH_HINTS.some((h) => lower.includes(h))
}

function inspectVcfPreview(text: string): GenomicMatrixShape | null {
  const lines = text.split("\n")
  const headerLine = lines.find((l) => l.startsWith("#CHROM"))
  if (!headerLine) return null
  const cols = headerLine.replace(/^#/, "").split("\t")
  const fixedCount = 9
  if (cols.length <= fixedCount) return null
  const sampleHeaders = cols
    .slice(fixedCount)
    .map((s) => s.trim())
    .filter(Boolean)
  if (sampleHeaders.length === 0) return null
  const metadataColumnIndices = Array.from({ length: fixedCount }, (_, i) => i)
  const sampleColumnIndices = Array.from(
    { length: sampleHeaders.length },
    (_, i) => fixedCount + i,
  )
  return {
    format: "vcf",
    headerRowIndex: 0,
    metadataColumnIndices,
    sampleColumnIndices,
    sampleHeaders,
    variantNameColumnIndex: 2,
    chromosomeColumnIndex: 0,
    positionColumnIndex: 1,
    allelesColumnIndex: 3,
    designSequenceColumnIndex: null,
    confident: true,
  }
}

function inspectHapmapPreview(text: string): GenomicMatrixShape | null {
  const lines = text.split("\n").filter((l) => l.trim())
  if (lines.length === 0) return null
  const headers = lines[0].split("\t").map((s) => s.trim())
  if (headers.length <= 11) return null
  if (!/^rs#?$/i.test(headers[0])) return null
  const metadataColumnIndices = Array.from({ length: 11 }, (_, i) => i)
  const sampleHeaders = headers.slice(11)
  const sampleColumnIndices = Array.from(
    { length: sampleHeaders.length },
    (_, i) => 11 + i,
  )
  return {
    format: "hapmap",
    headerRowIndex: 0,
    metadataColumnIndices,
    sampleColumnIndices,
    sampleHeaders,
    variantNameColumnIndex: 0,
    chromosomeColumnIndex: 2,
    positionColumnIndex: 3,
    allelesColumnIndex: 1,
    designSequenceColumnIndex: null,
    confident: true,
  }
}

export async function detectFiles(
  files: FileWithPath[],
): Promise<DetectionResult> {
  const groups = new Map<string, FileWithPath[]>()
  const csvFiles: FileWithPath[] = []
  const spreadsheetFiles: FileWithPath[] = []
  const dates = new Set<string>()
  let hasDJI = false
  let hasAmiga = false
  let hasImages = false
  let hasGenomicExt = false
  let hasPlinkExt = false
  let hasHapmapExt = false
  let hasVcfExt = false
  let hasThermal = false
  let hasSpreadsheet = false

  for (const file of files) {
    const ext = getExtension(file.name)
    const path = file.path || file.name

    const date = extractDateFromPath(path)
    if (date) dates.add(date)

    const parts = path.split("/")
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "."
    if (!groups.has(folder)) groups.set(folder, [])
    groups.get(folder)?.push(file)

    if (DJI_PATTERN.test(file.name)) hasDJI = true
    if (AMIGA_PATTERN.test(path)) hasAmiga = true
    if (IMAGE_EXTENSIONS.has(ext)) hasImages = true
    if (GENOMIC_EXTENSIONS.has(ext)) hasGenomicExt = true
    if (PLINK_EXTENSIONS.has(ext)) hasPlinkExt = true
    if (HAPMAP_EXTENSIONS.has(ext)) hasHapmapExt = true
    if (VCF_EXTENSIONS.has(ext)) hasVcfExt = true
    // Fast-path thermal signals: dedicated FLIR raw extensions, camT-* TIFF
    // filenames, or a path that mentions a thermal-capture rig. Byte-level
    // probes for ambiguous JPEG/TIFF groups run after the loop.
    if (
      THERMAL_EXTENSIONS.has(ext) ||
      (TIFF_EXTENSIONS.has(ext) && THERMAL_FILENAME_PATTERN.test(file.name)) ||
      ((IMAGE_EXTENSIONS.has(ext) || THERMAL_EXTENSIONS.has(ext)) &&
        pathHasThermalHint(path))
    )
      hasThermal = true
    if (CSV_EXTENSIONS.has(ext)) csvFiles.push(file)
    if (SPREADSHEET_EXTENSIONS.has(ext)) {
      hasSpreadsheet = true
      spreadsheetFiles.push(file)
    }
  }

  const parsedCsvs = await Promise.all(csvFiles.map(parseCSVPreview))

  let genomicShape: GenomicMatrixShape | null = null
  let genomicFile: FileWithPath | null = null
  let matrixXlsxFile: FileWithPath | null = null

  for (const sheetFile of spreadsheetFiles) {
    const peek = await peekSpreadsheet(sheetFile)
    if (!peek) continue
    if (looksLikeGenomicMatrix(peek.headers, peek.sampleRows)) {
      const shape = buildMatrixShape(
        peek.headers,
        "matrix",
        peek.headerRowIndex,
      )
      if (shape) {
        genomicShape = shape
        genomicFile = sheetFile
        matrixXlsxFile = sheetFile
        break
      }
    }
  }

  if (!genomicShape && hasHapmapExt) {
    const hapmapFile = files.find((f) =>
      HAPMAP_EXTENSIONS.has(getExtension(f.name)),
    )
    if (hapmapFile) {
      const head = await peekTextHead(hapmapFile)
      const shape = inspectHapmapPreview(head)
      if (shape) {
        genomicShape = shape
        genomicFile = hapmapFile
      }
    }
  }

  if (!genomicShape && hasVcfExt) {
    const vcfFile = files.find((f) => VCF_EXTENSIONS.has(getExtension(f.name)))
    if (vcfFile) {
      const head = await peekTextHead(vcfFile)
      const shape = inspectVcfPreview(head)
      if (shape) {
        genomicShape = shape
        genomicFile = vcfFile
      }
    }
  }

  if (!genomicShape && hasPlinkExt) {
    const plinkFile = files.find((f) =>
      PLINK_EXTENSIONS.has(getExtension(f.name)),
    )
    if (plinkFile) {
      genomicFile = plinkFile
      genomicShape = {
        format: "plink",
        headerRowIndex: 0,
        metadataColumnIndices: [],
        sampleColumnIndices: [],
        sampleHeaders: [],
        variantNameColumnIndex: null,
        chromosomeColumnIndex: null,
        positionColumnIndex: null,
        allelesColumnIndex: null,
        designSequenceColumnIndex: null,
        confident: false,
      }
    }
  }

  if (!genomicShape) {
    const matrixCsv = parsedCsvs.find((c) => c.category === "genomic_matrix")
    if (matrixCsv) {
      const shape = buildMatrixShape(matrixCsv.headers, "matrix", 0)
      if (shape) {
        genomicShape = shape
        genomicFile = matrixCsv.file
      }
    }
  }

  const hasGenomic = hasGenomicExt || genomicShape !== null

  const fileGroups: DetectedFileGroup[] = []
  for (const [folder, folderFiles] of groups) {
    const date = extractDateFromPath(folder)
    fileGroups.push({
      date,
      folder,
      files: folderFiles,
      fileCount: folderFiles.length,
      totalSize: folderFiles.reduce((sum, f) => sum + f.size, 0),
    })
  }
  fileGroups.sort((a, b) => (a.date || "").localeCompare(b.date || ""))

  // Slow-path: only fires when the fast path didn't already conclude this
  // batch is thermal, and the batch is a single image-only group (the case
  // where a FLIR-One-Pro JPEG batch is otherwise indistinguishable from a
  // DJI RGB drone batch). Cost is bounded to one byte-peek per ambiguous
  // group.
  if (!hasThermal && hasImages && !hasGenomic) {
    for (const group of fileGroups) {
      const imageFiles = group.files.filter((f) =>
        IMAGE_EXTENSIONS.has(getExtension(f.name)),
      )
      if (imageFiles.length === 0) continue
      const sample = imageFiles[0]
      const ext = getExtension(sample.name)
      const looksThermal = JPEG_EXTENSIONS.has(ext)
        ? await jpegLooksLikeFlir(sample)
        : TIFF_EXTENSIONS.has(ext)
          ? await tiffLooksLikeThermal(sample)
          : false
      if (looksThermal) {
        hasThermal = true
        break
      }
    }
  }

  const categories: DataCategory[] = []
  // Thermal is exclusive with drone_imagery: a FLIR JPEG batch should not
  // also be tagged drone_imagery just because it has images + dates. ODM is
  // handled the same way for both downstream; the wizard only branches on
  // category for the calibration UI.
  if (hasThermal) categories.push("thermal")
  if (!hasThermal && (hasDJI || (hasImages && dates.size > 0)))
    categories.push("drone_imagery")
  if (hasGenomic) categories.push("genomic")
  const suppressTabular =
    matrixXlsxFile !== null &&
    spreadsheetFiles.length === 1 &&
    parsedCsvs.length === 0
  if (!suppressTabular) {
    if (parsedCsvs.some((c) => c.category !== "genomic_matrix") && !hasImages) {
      categories.push("csv_tabular")
    }
    if (hasSpreadsheet && !matrixXlsxFile) categories.push("csv_tabular")
  }
  if (categories.length === 0) categories.push("mixed")

  const allPaths = files.map((f) => f.path || f.name)
  const suggestedSiteName = inferSiteName(allPaths)

  let suggestedSensorType: string | null = null
  let suggestedPlatform: string | null = null
  let suggestedDataFormat: string

  if (hasThermal) {
    suggestedSensorType = "Thermal Camera"
    suggestedPlatform = hasAmiga
      ? "Amiga Robot"
      : hasDJI
        ? "DJI Drone"
        : null
    // Format reflects what's actually on disk so downstream "data type"
    // chips render something meaningful. JPEG = FLIR One Pro–class, TIFF =
    // Boson-class raw.
    const hasJpeg = files.some((f) =>
      JPEG_EXTENSIONS.has(getExtension(f.name)),
    )
    const hasTiff = files.some((f) =>
      TIFF_EXTENSIONS.has(getExtension(f.name)),
    )
    suggestedDataFormat = hasJpeg
      ? "Thermal JPEG"
      : hasTiff
        ? "Thermal TIFF (16-bit)"
        : "Thermal"
  } else if (hasDJI) {
    suggestedSensorType = "RGB Camera"
    suggestedPlatform = "DJI Drone"
    suggestedDataFormat = "JPEG"
  } else if (hasAmiga) {
    suggestedSensorType = "Multi-sensor"
    suggestedPlatform = "Amiga Robot"
    suggestedDataFormat = "Mixed"
  } else if (hasGenomic) {
    if (genomicShape?.format === "hapmap") suggestedDataFormat = "HapMap"
    else if (genomicShape?.format === "vcf") suggestedDataFormat = "VCF"
    else if (genomicShape?.format === "plink") suggestedDataFormat = "PLINK"
    else if (genomicShape?.format === "matrix")
      suggestedDataFormat = "Genomic Matrix"
    else {
      const ext = files.find((f) =>
        GENOMIC_EXTENSIONS.has(getExtension(f.name)),
      )
      suggestedDataFormat = ext
        ? getExtension(ext.name).toUpperCase()
        : "Genomic"
    }
  } else if (hasImages) {
    suggestedSensorType = "Camera"
    suggestedDataFormat = "JPEG"
  } else if (hasSpreadsheet) {
    suggestedDataFormat = "XLSX"
  } else if (parsedCsvs.length > 0) {
    suggestedDataFormat = "CSV"
  } else {
    suggestedDataFormat = "Unknown"
  }

  const topFolders = [
    ...new Set(files.map((f) => (f.path || f.name).split("/")[0])),
  ]
  const suggestedExperimentName =
    topFolders.length === 1 && topFolders[0] !== files[0]?.name
      ? topFolders[0].replace(DATE_PATTERN, "").replace(/^-|-$/g, "").trim() ||
        null
      : null

  return {
    fileGroups,
    csvFiles: parsedCsvs,
    totalFiles: files.length,
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
    detectedDates: [...dates].sort(),
    suggestedDataFormat,
    suggestedSensorType,
    suggestedPlatform,
    suggestedExperimentName,
    suggestedSiteName,
    dataCategories: categories,
    genomicShape,
    genomicFile,
  }
}

export function needsSensorFields(categories: DataCategory[]): boolean {
  const sensorCategories: DataCategory[] = [
    "drone_imagery",
    "thermal",
    "elevation",
  ]
  return categories.some((c) => sensorCategories.includes(c))
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}
