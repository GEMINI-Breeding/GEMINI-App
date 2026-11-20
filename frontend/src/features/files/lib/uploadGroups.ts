/**
 * Which upload batch a file belongs to, when one day's data for the same
 * experiment / site / population / platform / sensor was collected in
 * several parts: more than one run of the day, or one run per treatment.
 *
 * Each part becomes its own upload batch (its own dataset and its own
 * folder in storage), labelled with an optional **run of the day** and an
 * optional **treatment**. The labels live on the dataset
 * (`dataset_info.run_of_day`, `dataset_info.treatment`), not in the storage
 * path, so nothing that reads the path layout changes.
 *
 * When whole directories are dropped, the folder each file came from is
 * remembered here, and the person says what the folders stand for: runs,
 * treatments, or nothing (one batch).
 */

/** Folder (relative to what was dropped) each file came from. */
const folders = new WeakMap<File, string>()

export function setFolder(file: File, folder: string): void {
  const clean = folder.replace(/^\/+|\/+$/g, "")
  if (clean) folders.set(file, clean)
}

/** "" for a file that was picked or dropped on its own. */
export function folderOf(file: File): string {
  return (
    folders.get(file) ??
    // A folder chosen through the picker carries its path on the file.
    (file.webkitRelativePath
      ? file.webkitRelativePath.split("/").slice(0, -1).join("/")
      : "")
  )
}

export type FolderMeaning = "runs" | "treatments" | "one"

export interface BatchLabels {
  /** Which run of that day: "1", "2", "morning"… Empty when there is one. */
  run: string
  /** Treatment the data belongs to: "irrigated", "drought"… Empty when not split. */
  treatment: string
}

export interface FolderGroup extends BatchLabels {
  /** Folder as dropped, e.g. "2026-09-17/run2". */
  folder: string
  files: File[]
  /** False: leave this folder out of the upload. */
  include: boolean
}

/** Last part of a folder path: what a person would call the folder. */
export function leafName(folder: string): string {
  const parts = folder.split("/").filter(Boolean)
  return parts[parts.length - 1] ?? ""
}

/**
 * The distinct folders among the files, in natural order. Files with no
 * folder are grouped under "". A single group means there is nothing to
 * map: the upload is one batch.
 */
export function foldersOf(files: File[]): string[] {
  const seen = new Set<string>()
  for (const f of files) seen.add(folderOf(f))
  return [...seen].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  )
}

/**
 * Folders that differ only above a shared parent are named by what
 * differs: "flight/run1" and "flight/run2" are "run1" and "run2".
 */
export function distinctName(folder: string, all: string[]): string {
  if (!folder) return ""
  const split = all.filter(Boolean).map((f) => f.split("/"))
  let shared = 0
  while (
    split.every((p) => p.length > shared + 1) &&
    split.every((p) => p[shared] === split[0][shared])
  )
    shared++
  return folder.split("/").slice(shared).join("/")
}

/**
 * A run label from a folder name: "run2", "Run_02", "flight 3" give the
 * number; anything else is kept as written.
 */
export function runFromFolderName(name: string): string {
  const m = name.match(/^(?:run|flight|pass|rep|r)[\s_-]*0*(\d+)$/i)
  return m ? m[1] : name
}

/** One group per folder, labelled by what the folders are said to stand for. */
export function groupByFolder(
  files: File[],
  meaning: FolderMeaning,
  base: BatchLabels,
): FolderGroup[] {
  const all = foldersOf(files)
  if (meaning === "one" || all.length <= 1) {
    return [{ folder: "", files, include: true, ...base }]
  }
  return all.map((folder, i) => {
    const name = distinctName(folder, all) || `(loose files ${i + 1})`
    return {
      folder,
      files: files.filter((f) => folderOf(f) === folder),
      include: true,
      run: meaning === "runs" ? runFromFolderName(name) : base.run,
      treatment: meaning === "treatments" ? name : base.treatment,
    }
  })
}

/** Two included groups with the same labels would be indistinguishable later. */
export function duplicateLabels(groups: FolderGroup[]): string[] {
  const seen = new Map<string, number>()
  for (const g of groups.filter((x) => x.include)) {
    const key = `${g.run.trim().toLowerCase()}|${g.treatment.trim().toLowerCase()}`
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  return [...seen.entries()]
    .filter(([, n]) => n > 1)
    .map(([k]) => {
      const [run, treatment] = k.split("|")
      return (
        [run && `run ${run}`, treatment && `treatment ${treatment}`]
          .filter(Boolean)
          .join(", ") || "no run and no treatment"
      )
    })
}

/** What is stored on the dataset for a batch. Empty labels are left out. */
export function batchInfo(
  labels: BatchLabels,
  scope: Record<string, string>,
  folder?: string,
): Record<string, string> {
  const out: Record<string, string> = {}
  if (labels.run.trim()) out.run_of_day = labels.run.trim()
  if (labels.treatment.trim()) out.treatment = labels.treatment.trim()
  if (folder) out.source_folder = folder
  // Where the batch belongs, so same-day batches can be found again
  // without reading storage paths.
  for (const [k, key] of [
    ["season", "season"],
    ["location", "site"],
    ["population", "population"],
    ["date", "collection_date"],
    ["platform", "platform"],
    ["sensor", "sensor"],
  ] as const) {
    if (scope[k]) out[key] = scope[k]
  }
  return out
}

/** Short text for a batch: "run 2 · drought", or "" when it has no labels. */
export function batchLabelText(info: unknown): string {
  const i = (info ?? {}) as Record<string, unknown>
  const run = typeof i.run_of_day === "string" ? i.run_of_day.trim() : ""
  const treatment = typeof i.treatment === "string" ? i.treatment.trim() : ""
  return [run && `run ${run}`, treatment].filter(Boolean).join(" · ")
}

/** Slug for the dataset's name, so batches can be told apart in lists. */
export function batchNameSuffix(labels: BatchLabels): string {
  const slug = (s: string) => s.trim().replace(/[^a-zA-Z0-9]+/g, "-")
  return [
    labels.run.trim() && `run-${slug(labels.run)}`,
    labels.treatment.trim() && `trt-${slug(labels.treatment)}`,
  ]
    .filter(Boolean)
    .join("__")
}
