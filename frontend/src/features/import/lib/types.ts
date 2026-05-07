/**
 * Shared types for the /import wizard.
 *
 * Ported from `backend/gemini-ui/src/components/import-wizard/wizard-shell.tsx`
 * (the reference UI). Kept in a dedicated file so step components don't
 * pull in the WizardShell module just to read its types.
 *
 * Detection-related types live in `./detection-engine.ts`.
 */
import type { DetectionResult } from "./detection-engine"

export interface FileWithPath extends File {
  /** Relative path from the dropped folder root, when available. Falls back
   *  to `name` for single-file selections. Mirrors `react-dropzone`'s
   *  augmentation of `File` so detection logic that walks paths works on
   *  both gemini-ui and our codebase. */
  path?: string
}

export interface ParsedSheet {
  /** Sheet name. Always "Sheet1" (or the file basename) for CSV/TSV; the
   *  actual sheet name for xlsx workbooks. */
  name: string
  headers: string[]
  /** Each row is keyed by header. Empty cells are preserved as "". */
  rows: Record<string, unknown>[]
}

export interface ImportMetadata {
  experimentId: string | null
  experimentName: string
  sensorPlatformName: string
  sensorName: string
  datasetNames: string[]
  createNew: {
    experiment: boolean
    sensorPlatform: boolean
    sensor: boolean
  }
}

export interface TraitColumn {
  /** Original header text in the sheet. */
  columnHeader: string
  /** Editable trait label, defaults to columnHeader. Becomes the Trait
   *  entity name. */
  traitName: string
  /** Optional units string (e.g. "cm", "g/m²"). Stored on the Trait. */
  units: string
  /** Whether this column is currently selected for import. */
  enabled: boolean
}

export interface MetadataColumn {
  /** Original header text. */
  columnHeader: string
  /** Label used as the key in record_info; defaults to columnHeader. */
  label: string
}

export interface SheetMapping {
  sheetName: string
  /** When true the sheet is excluded from import. */
  skipped: boolean
  plotNumberColumn: string | null
  plotRowColumn: string | null
  plotColumnColumn: string | null
  traitColumns: TraitColumn[]
  populationName: string
  accessionNameColumn: string | null
  lineNameColumn: string | null
  aliasColumn: string | null
  collectionDateMode: "fixed" | "column" | "unknown"
  collectionDate: string
  collectionDateColumn: string | null
  seasonMode: "fixed" | "column"
  seasonName: string
  seasonColumn: string | null
  siteMode: "fixed" | "column"
  siteName: string
  siteColumn: string | null
  timestampColumn: string | null
  metadataColumns: MetadataColumn[]
}

export interface ColumnMapping {
  recordType: "trait" | "dataset"
  sheets: ParsedSheet[]
  /** One config per sheet, same order as sheets. */
  sheetConfigs: SheetMapping[]
}

export interface GermplasmReview {
  /** Every germplasm value encountered across sheets, deduped. */
  allNames: string[]
  /** input_name → resolution outcome. */
  resolved: Record<
    string,
    {
      match_kind: string
      accession_id?: string | null
      line_id?: string | null
      canonical_name?: string | null
    }
  >
}

export interface UploadResults {
  createdEntities: { type: string; name: string; id: string }[]
  uploadedFiles: number
  failedFiles: number
  experimentId: string | null
  /** Optional study id for the genomic flow. The trait flow leaves this null. */
  studyId?: string | null
}

/**
 * Genomic flow's per-step state. The trait flow doesn't use this slot;
 * the genomic flow does not use `columnMapping` (no spreadsheet → DB
 * record mapping). Both flows share `metadata` (for experiment) and the
 * shared `files` / `detection` / `uploadResults` slots.
 */
export interface GenomicWizardState {
  /** Selected genotyping study id, or null if the user is creating a new
   *  one (in which case `studyName` carries the new name). */
  studyId: string | null
  studyName: string
  createNewStudy: boolean
  /** Optional. When set, the ingest endpoint links every accession the
   *  wizard creates (from `createdAccessions` + the .psam sample
   *  pass) to this population in the chosen experiment, the same way
   *  the trait wizard does. The Population row + experiment link are
   *  get-or-created server-side, so picking an existing population or
   *  creating a new one are both safe. */
  populationName: string | null
  /** Filled by StepSampleResolve. */
  sampleResolution: SampleResolution | null
  /** Promise of the heavy SheetJS parse, kicked off in parallel with the
   *  germplasm resolver call so the workbook is in memory by the time
   *  the user reaches the ingest step. The shape is `unknown` here so
   *  this types module doesn't have to import the parser's
   *  `PreparedMatrix` type. The ingest step casts when consuming. */
  preparedMatrix?: Promise<unknown> | null
}

/**
 * Outcome of the sample-resolution step. Records which raw sample column
 * headers map to which canonical accession names (`canonicalByHeader`),
 * which headers should be skipped at ingest time, and which canonical
 * names need fresh accession rows created before ingest.
 */
export interface SampleResolution {
  canonicalByHeader: Record<string, string>
  skippedHeaders: string[]
  /** Canonical names that need to be created as accessions before
   *  ingest. Already deduped. */
  createdAccessions: string[]
}

export interface WizardState {
  files: FileWithPath[]
  detection: DetectionResult | null
  metadata: ImportMetadata | null
  columnMapping: ColumnMapping | null
  germplasmReview: GermplasmReview | null
  uploadResults: UploadResults | null
  genomic: GenomicWizardState | null
}

/**
 * Generic upload-progress shape used by `UploadProgress`. Mirrors the
 * gemini-ui `UploadState` interface so the visual primitive can be ported
 * without rewriting its consumers.
 */
export interface UploadFileState {
  file: File
  objectName: string
  status: "pending" | "uploading" | "complete" | "error"
  progress: number
  error?: string
}

export interface UploadState {
  files: UploadFileState[]
  isUploading: boolean
  completedCount: number
  errorCount: number
  /** 0–100. */
  overallProgress: number
}
