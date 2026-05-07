import { ChevronDown, ChevronUp, File, X } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { dataTypes } from "@/config/dataTypes"
import type { EntityChoice } from "@/features/files/components/EntitySelectField"
import {
  type UploadTask,
  useUploadQueue,
} from "@/features/files/hooks/useUploadQueue"
import {
  type ResolvedScope,
  type UploadScopeChoices,
  useResolveScope,
} from "@/features/files/hooks/useUploadScope"
import { isExtensionAllowed } from "@/features/files/utils/extensions"
import useCustomToast from "@/hooks/useCustomToast"
import { UploadZone } from "./UploadZone"

// Form-field key (the dataTypes config language) → scope key (the entity
// language). Used to translate the scope map the parent passes in.
const FORM_FIELD_TO_SCOPE_KEY: Record<string, keyof UploadScopeChoices> = {
  experiment: "experiment",
  location: "site",
  population: "population",
  platform: "sensorPlatform",
  sensor: "sensor",
}

interface UploadListProps {
  dataType: string | null
  formValues: Record<string, string>
  /**
   * Per-form-field entity choice (existing/new/none). The upload click
   * resolves any "new" choice via the scope-resolver hook before chunked
   * upload starts, so the experiment/site/etc. row exists in the DB by
   * the time the file lands in MinIO.
   */
  scope?: Record<string, EntityChoice>
  onFilesSelected?: (files: File[]) => void
  /** Fired with the MinIO object paths of the successfully uploaded files. */
  onUploadComplete?: (destPaths: string[]) => void
  /** Optional label shown above the upload zone. */
  label?: string
  /** Optional sub-path appended to the target directory (e.g. "DEM"). */
  subDir?: string
  /** When true, the inner UploadZone refuses clicks and drops, and
   *  shows `disabledReason` in place of the usual instructions. Used
   *  by the Files page to gate the upload affordance behind required
   *  scope fields (data type, experiment). */
  disabled?: boolean
  disabledReason?: string
}

function buildTargetRootDir(
  dataType: string,
  formValues: Record<string, string>,
  subDir?: string,
): string | null {
  const cfg = dataTypes[dataType as keyof typeof dataTypes]
  if (!cfg) return null
  // Preserve the existing MinIO path convention so the new FilesService
  // listing endpoints find the uploads under a predictable prefix.
  const values = { ...formValues }
  if (values.date) values.year = values.date.split("-")[0]
  let root = cfg.directory
    .map((field) => values[field.toLowerCase()] || field)
    .join("/")
  if (subDir) root += `/${subDir}`
  return root
}

function requiredFormFields(dataType: string): string[] {
  const cfg = dataTypes[dataType as keyof typeof dataTypes]
  return ((cfg as { fields?: string[] } | undefined)?.fields ?? []).slice()
}

/**
 * A form field is considered "filled" if either:
 *   - it has a non-empty plain value (date), OR
 *   - the parent passed an EntityChoice that is `existing` or a `new` with a
 *     non-blank name (the upload click will resolve it before posting).
 */
function isFieldFilled(
  field: string,
  formValues: Record<string, string>,
  scope: Record<string, EntityChoice> | undefined,
): boolean {
  if (formValues[field]?.trim()) return true
  const c = scope?.[field]
  if (!c) return false
  if (c.kind === "existing") return Boolean(c.id && c.name)
  if (c.kind === "new") return c.name.trim().length > 0
  return false
}

function followUpForDataType(dataType: string): UploadTask["followUpJob"] {
  // Amiga .bin files auto-extract via the FLIR worker. Everything else
  // drops onto MinIO and is done.
  if (dataType === "Farm-ng Binary File") return { kind: "extract_binary" }
  return { kind: "none" }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}

/**
 * Browsers represent a dropped *folder* as a single 0-byte File entry whose
 * name is the folder name (no extension, type === ""). UploadZone.tsx now
 * walks `webkitGetAsEntry()` to expand directories into their files, so any
 * 0-byte / type-less entry that reaches us here is a real upload artifact
 * we deliberately want to flag — not a folder mis-detected as a file.
 */
function looksLikeFolderArtifact(f: File): boolean {
  return f.size === 0 && (f.type === "" || !f.name.includes("."))
}

type RejectionDetails = {
  title: string
  description: string
  /** Per-file lines so the user sees exactly what was rejected. */
  rejectedNames: string[]
  /** Optional remediation hint shown under the description. */
  remediation?: string
}

export function UploadList({
  dataType,
  formValues,
  scope,
  onFilesSelected,
  onUploadComplete,
  label,
  subDir,
  disabled = false,
  disabledReason,
}: UploadListProps) {
  const [selected, setSelected] = useState<File[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [resolveStatus, setResolveStatus] = useState<string | null>(null)
  const [rejection, setRejection] = useState<RejectionDetails | null>(null)
  const { showErrorToastWithCopy } = useCustomToast()
  const { run } = useUploadQueue()
  const { resolveScope } = useResolveScope()

  const acceptAttr = useMemo(() => {
    if (!dataType) return undefined
    const cfg = dataTypes[dataType as keyof typeof dataTypes]
    return cfg?.fileType && cfg.fileType !== "*" ? cfg.fileType : undefined
  }, [dataType])

  const addFiles = (files: File[]) => {
    if (!dataType) {
      setRejection({
        title: "Pick a data type first",
        description:
          "Choose a data type (e.g. Image Data, Orthomosaic) before adding files. " +
          "The data type controls where the files land in storage and which extensions are allowed.",
        rejectedNames: files.map((f) => f.name),
      })
      return
    }

    const cfg = dataTypes[dataType as keyof typeof dataTypes]
    const accepted: File[] = []
    const folderArtifacts: File[] = []
    const wrongType: File[] = []

    for (const f of files) {
      if (looksLikeFolderArtifact(f)) {
        folderArtifacts.push(f)
        continue
      }
      if (cfg?.fileType && !isExtensionAllowed(f.name, cfg.fileType)) {
        wrongType.push(f)
        continue
      }
      accepted.push(f)
    }

    if (
      folderArtifacts.length > 0 &&
      accepted.length === 0 &&
      wrongType.length === 0
    ) {
      // Pure folder drop where the dropzone walker couldn't expand them.
      // This happens on browsers without webkitGetAsEntry (rare) or when
      // a user drops a folder that the browser refuses to read for
      // permission reasons.
      setRejection({
        title: "Couldn't read that folder",
        description:
          "Folders should expand into the files they contain, but the browser " +
          "passed them through as zero-byte entries. Try dropping the contents " +
          "of the folder instead, or click the dropzone to pick files via the " +
          "file picker.",
        rejectedNames: folderArtifacts.map((f) => f.name),
        remediation:
          "Open the folder in Finder, select all the files inside, and drop those.",
      })
      return
    }

    if (wrongType.length > 0 || folderArtifacts.length > 0) {
      const allowed = cfg?.fileType ?? "(any)"
      const names = [...folderArtifacts, ...wrongType].map((f) => f.name)
      const desc =
        folderArtifacts.length > 0
          ? `Some entries weren't usable. Folders need to be expanded into their files; other files don't match the allowed extensions for "${dataType}" (${allowed}).`
          : `These files don't match the allowed extensions for "${dataType}" (${allowed}).`
      setRejection({
        title:
          accepted.length > 0
            ? `${names.length} file(s) skipped — ${accepted.length} accepted`
            : "No files matched the selected data type",
        description: desc,
        rejectedNames: names,
        remediation:
          accepted.length > 0
            ? "The accepted files are ready to upload. Press Upload to continue, or pick again."
            : "Pick a different data type, or pick files whose extensions match the current one.",
      })
    }

    if (accepted.length > 0) {
      setSelected((prev) => [...prev, ...accepted])
      onFilesSelected?.(accepted)
    }
  }

  const removeFile = (index: number) => {
    setSelected((prev) => prev.filter((_, i) => i !== index))
  }

  const handleUploadClick = async () => {
    if (!dataType) {
      setRejection({
        title: "No data type selected",
        description:
          "Pick a data type from the dropdown above before uploading.",
        rejectedNames: [],
      })
      return
    }
    if (selected.length === 0) return

    const required = requiredFormFields(dataType)
    const missing = required.filter(
      (field) => !isFieldFilled(field, formValues, scope),
    )
    if (missing.length > 0) {
      setRejection({
        title: "Required fields are blank",
        description:
          `Fill in the following before uploading "${dataType}": ${missing.join(", ")}. ` +
          `Each scope field must either pick an existing entity or "+ Create new…" with a name.`,
        rejectedNames: [],
        remediation:
          "These fields control which database entities the files associate with. Without them, the files would land in storage but be invisible from the rest of the app.",
      })
      return
    }

    setIsUploading(true)
    try {
      // 1. Resolve any "+ Create new…" entity choices via search-or-create.
      //    On success the resolved names land in formValues so the path
      //    builder picks them up.
      const resolved = await resolveScopeForFields(required)

      // Build the merged form values: resolved entity names override any
      // mirrored copy from the parent.
      const merged: Record<string, string> = { ...formValues }
      for (const field of required) {
        const r = resolved[FORM_FIELD_TO_SCOPE_KEY[field]]
        if (r) merged[field] = r.name
      }

      const targetRootDir = buildTargetRootDir(dataType, merged, subDir)
      if (!targetRootDir) {
        setRejection({
          title: `Unknown data type: ${dataType}`,
          description:
            "The selected data type isn't configured for upload. Pick a different one, or report this — the data-types config may be out of sync with the dropdown.",
          rejectedNames: [],
        })
        return
      }

      const followUpJob = followUpForDataType(dataType)
      const tasks: UploadTask[] = selected.map((file) => ({
        file,
        objectPath: `${targetRootDir}/${file.name}`,
        followUpJob,
      }))

      setResolveStatus(null)
      // The experiment is required by the Files-page UI gate, so by the
      // time we get here `resolved.experiment` exists. Forward its id
      // so the chunked-upload finalize handler can write the
      // `experiment_files` pointer row that the Experiment.delete()
      // cascade reads from.
      const result = await run(tasks, {
        title:
          followUpJob?.kind === "extract_binary"
            ? `Uploading ${selected.length} .bin file(s) + extracting`
            : `Uploading ${selected.length} file(s)`,
        experimentId: resolved.experiment?.id,
      })
      onUploadComplete?.(result.uploaded.map((u) => u.objectPath))
      setSelected([])
    } catch (err) {
      // Surface the *server's* error verbatim and keep it on screen until
      // the user dismisses it.
      const message = err instanceof Error ? err.message : String(err)
      setRejection({
        title: resolveStatus
          ? `Failed while ${resolveStatus}`
          : "Upload failed",
        description: resolveStatus
          ? `The upload was blocked because the entity creation step failed. ` +
            `The error from the backend is shown below.`
          : `The upload was interrupted by an error. The first failing chunk's response is below; ` +
            `the partial upload is preserved on the server, so retrying the same files will resume from the failed chunk.`,
        rejectedNames: [message],
        remediation: resolveStatus
          ? "Try a different name (the entity may already exist with conflicting attributes), or check that the parent entity (experiment) is the one you intended."
          : "Common causes: backend container restarted, JWT expired (try refreshing the page to re-login), or a 5xx upstream from MinIO.",
      })
      showErrorToastWithCopy(message)
    } finally {
      setIsUploading(false)
      setResolveStatus(null)
    }
  }

  /**
   * Translate the per-form-field scope map into the EntityChoice map the
   * resolver expects, then run the create-or-get pipeline.
   */
  async function resolveScopeForFields(
    fields: string[],
  ): Promise<ResolvedScope> {
    if (!scope) return {}
    const choices: UploadScopeChoices = {}
    for (const field of fields) {
      const scopeKey = FORM_FIELD_TO_SCOPE_KEY[field]
      if (!scopeKey) continue
      const c = scope[field]
      if (c) choices[scopeKey] = c
    }
    if (Object.keys(choices).length === 0) return {}
    setResolveStatus("registering entities")
    return resolveScope(choices)
  }

  return (
    <div data-onboarding="files-upload-zone" className="space-y-6">
      {label && (
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
      )}
      <UploadZone
        onFilesAdded={addFiles}
        accept={acceptAttr}
        disabled={disabled}
        disabledReason={disabledReason}
      />

      {selected.length > 0 && (
        <div className="border-border bg-card rounded-lg border p-6">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex w-full items-center justify-between text-left"
            type="button"
          >
            <h3 className="text-foreground">
              Selected Files ({selected.length})
            </h3>
            {isExpanded ? (
              <ChevronUp className="text-muted-foreground h-5 w-5" />
            ) : (
              <ChevronDown className="text-muted-foreground h-5 w-5" />
            )}
          </button>

          {isExpanded && (
            <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
              {selected.map((file, index) => (
                <div
                  key={`${file.name}:${file.lastModified}:${index}`}
                  className="border-border bg-muted flex items-center justify-between rounded border p-2"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <File className="text-muted-foreground h-4 w-4 flex-shrink-0" />
                    <span className="text-foreground truncate">
                      {file.name}
                    </span>
                    <span className="text-muted-foreground text-xs flex-shrink-0">
                      {formatBytes(file.size)}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      removeFile(index)
                    }}
                    className="hover:bg-accent ml-1 flex-shrink-0 rounded p-1"
                    aria-label="Remove file"
                    type="button"
                  >
                    <X className="text-muted-foreground h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <Button
              variant="outline"
              onClick={handleUploadClick}
              disabled={isUploading}
              data-testid="upload-submit"
            >
              {isUploading
                ? resolveStatus
                  ? `Registering entities…`
                  : "Uploading…"
                : `Upload ${selected.length} file(s)`}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setSelected([])}
              disabled={isUploading}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={rejection !== null}
        onOpenChange={(open) => !open && setRejection(null)}
      >
        <DialogContent data-testid="upload-error-dialog">
          <DialogHeader>
            <DialogTitle>{rejection?.title}</DialogTitle>
            <DialogDescription>{rejection?.description}</DialogDescription>
          </DialogHeader>
          {rejection?.remediation && (
            <p className="text-sm text-muted-foreground">
              {rejection.remediation}
            </p>
          )}
          {rejection && rejection.rejectedNames.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded border bg-muted/40 p-2 text-xs font-mono">
              {rejection.rejectedNames.map((n, i) => (
                <div key={`${i}:${n}`} className="truncate">
                  {n}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button
              data-testid="upload-error-dismiss"
              onClick={() => setRejection(null)}
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
