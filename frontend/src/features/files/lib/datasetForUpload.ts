/**
 * Shared "create or get the dataset for this upload batch" helper.
 *
 * Lifted from `features/import/components/StepUpload.tsx` so the Files-
 * page direct upload, the trait wizard, and any future upload path can
 * share one create-or-get policy. Post-migration-0007 every chunked
 * upload claims a `dataset_id` so `Dataset.delete()` can sweep just
 * that batch instead of forcing the user to nuke the whole experiment.
 *
 * Naming is deterministic and collision-safe: `{experiment}__{data type
 * slug}__{YYYYMMDD}__{HHMMSS}__{shortUploadId}`. The
 * `HHMMSS+shortUploadId` tail prevents collisions when the same user
 * submits the same data type twice in the same second. The trait
 * wizard still passes its user-supplied name through this helper too —
 * we just bypass `autoDatasetName` and use the supplied name.
 */
import { DatasetsService, type DatasetOutput } from "@/client"

export type CreateOrGetDatasetArgs = {
  /** Backing experiment for the batch (post-Files-page UI gate this is required). */
  experimentName: string
  /**
   * Human-readable data type label (matches keys in `src/config/dataTypes.ts`).
   * Used to form the slug component of the auto-name.
   */
  dataTypeLabel: string
  /**
   * Optional caller-supplied name. When provided we skip `autoDatasetName`
   * and use this verbatim — the trait wizard does this so the user-typed
   * name in the metadata step is preserved.
   */
  explicitName?: string
}

function dataTypeSlug(label: string): string {
  return label.replace(/[^a-zA-Z0-9]+/g, "")
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0")
}

/**
 * Build the deterministic auto-name. Exported so callers (and the
 * unit test) can preview the name without hitting the backend.
 */
export function autoDatasetName(
  experimentName: string,
  dataTypeLabel: string,
  when: Date = new Date(),
): string {
  const slug = dataTypeSlug(dataTypeLabel)
  const ymd = `${when.getFullYear()}${pad2(when.getMonth() + 1)}${pad2(when.getDate())}`
  const hms = `${pad2(when.getHours())}${pad2(when.getMinutes())}${pad2(when.getSeconds())}`
  // 4-char random tail. crypto.getRandomValues is available in every
  // browser we ship to + jsdom; falling back to Math.random keeps the
  // helper synchronous for the unit test environment.
  let rand = ""
  try {
    const buf = new Uint8Array(2)
    crypto.getRandomValues(buf)
    rand = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("")
  } catch {
    rand = Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, "0")
  }
  return `${experimentName}__${slug}__${ymd}__${hms}__${rand}`
}

export type CreateOrGetDatasetResult = {
  dataset: DatasetOutput
  /**
   * True if the API call actually inserted a new row, false if it
   * returned an existing row (name collision → "or get" branch).
   * Callers use this to decide whether it's safe to auto-delete the
   * dataset on upload failure: a freshly-created dataset has no
   * pre-existing files behind it, so cleanup is risk-free; an
   * existing one might already own data from a prior run.
   */
  wasCreated: boolean
}

/**
 * Create the dataset for an upload batch, or return the existing one
 * if a previous submission collided on name. Returns the resolved
 * `DatasetOutput` plus a `wasCreated` flag so callers can clean up
 * after themselves on failure.
 *
 * Throws on hard backend failure.
 */
export async function createOrGetDatasetForUpload(
  args: CreateOrGetDatasetArgs,
): Promise<CreateOrGetDatasetResult> {
  const datasetName =
    args.explicitName?.trim() ||
    autoDatasetName(args.experimentName, args.dataTypeLabel)
  // The path here is informational only — the backend stores it in
  // `dataset_info` for later reference; the actual files land at
  // whatever path the chunked-upload caller picks.
  const filesPrefix = `Raw/${args.experimentName}`
  try {
    const created = (await DatasetsService.apiDatasetsCreateDataset({
      requestBody: {
        dataset_name: datasetName,
        experiment_name: args.experimentName,
        dataset_info: {
          files_prefix: `gemini/${filesPrefix}`,
          bucket: "gemini",
          data_type_label: args.dataTypeLabel,
        },
      },
    })) as DatasetOutput
    return { dataset: created, wasCreated: true }
  } catch (err) {
    // Name collision — the "or get" branch. Trait wizard relies on
    // this when the user re-runs the import for the same name.
    const existing = (await DatasetsService.apiDatasetsGetDatasets({
      datasetName,
    })) as DatasetOutput[] | null
    const match = existing?.find((d) => d.dataset_name === datasetName)
    if (match) return { dataset: match, wasCreated: false }
    throw err
  }
}
