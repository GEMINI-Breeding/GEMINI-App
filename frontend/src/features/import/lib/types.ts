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

export interface WizardState {
  files: FileWithPath[]
  detection: DetectionResult | null
  metadata: ImportMetadata | null
  columnMapping: ColumnMapping | null
  germplasmReview: GermplasmReview | null
  uploadResults: UploadResults | null
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
