import { ChevronDown, ChevronUp, File, X } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { dataTypes } from "@/config/dataTypes"
import {
  useUploadQueue,
  type UploadTask,
} from "@/features/files/hooks/useUploadQueue"
import { isExtensionAllowed } from "@/features/files/utils/extensions"
import useCustomToast from "@/hooks/useCustomToast"
import { UploadZone } from "./UploadZone"

interface UploadListProps {
  dataType: string | null
  formValues: Record<string, string>
  onFilesSelected?: (files: File[]) => void
  /** Fired with the MinIO object paths of the successfully uploaded files. */
  onUploadComplete?: (destPaths: string[]) => void
  /** Optional label shown above the upload zone. */
  label?: string
  /** Optional sub-path appended to the target directory (e.g. "DEM"). */
  subDir?: string
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
  if (values["date"]) values["year"] = values["date"].split("-")[0]
  let root = cfg.directory
    .map((field) => values[field.toLowerCase()] || field)
    .join("/")
  if (subDir) root += `/${subDir}`
  return root
}

function followUpForDataType(
  dataType: string,
): UploadTask["followUpJob"] {
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

export function UploadList({
  dataType,
  formValues,
  onFilesSelected,
  onUploadComplete,
  label,
  subDir,
}: UploadListProps) {
  const [selected, setSelected] = useState<File[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const { showErrorToast } = useCustomToast()
  const { run } = useUploadQueue()

  const acceptAttr = useMemo(() => {
    if (!dataType) return undefined
    const cfg = dataTypes[dataType as keyof typeof dataTypes]
    return cfg?.fileType && cfg.fileType !== "*" ? cfg.fileType : undefined
  }, [dataType])

  const addFiles = (files: File[]) => {
    if (dataType) {
      const cfg = dataTypes[dataType as keyof typeof dataTypes]
      if (cfg?.fileType) {
        const accepted: File[] = []
        const rejected: File[] = []
        for (const f of files) {
          if (isExtensionAllowed(f.name, cfg.fileType)) accepted.push(f)
          else rejected.push(f)
        }
        if (rejected.length > 0) {
          const names = rejected.map((f) => f.name).join(", ")
          showErrorToast(`Wrong file type for "${dataType}": ${names}`)
        }
        if (accepted.length === 0) return
        setSelected((prev) => [...prev, ...accepted])
        onFilesSelected?.(accepted)
        return
      }
    }
    setSelected((prev) => [...prev, ...files])
    onFilesSelected?.(files)
  }

  const removeFile = (index: number) => {
    setSelected((prev) => prev.filter((_, i) => i !== index))
  }

  const handleUploadClick = async () => {
    if (!dataType || selected.length === 0) return
    const targetRootDir = buildTargetRootDir(dataType, formValues, subDir)
    if (!targetRootDir) {
      showErrorToast(`Unknown data type: ${dataType}`)
      return
    }

    const followUpJob = followUpForDataType(dataType)
    const tasks: UploadTask[] = selected.map((file) => ({
      file,
      objectPath: `${targetRootDir}/${file.name}`,
      followUpJob,
    }))

    setIsUploading(true)
    try {
      const result = await run(tasks, {
        title:
          followUpJob?.kind === "extract_binary"
            ? `Uploading ${selected.length} .bin file(s) + extracting`
            : `Uploading ${selected.length} file(s)`,
      })
      onUploadComplete?.(result.uploaded.map((u) => u.objectPath))
      setSelected([])
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err))
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div data-onboarding="files-upload-zone" className="space-y-6">
      {label && (
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
      )}
      <UploadZone onFilesAdded={addFiles} accept={acceptAttr} />

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
                ? "Uploading…"
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
    </div>
  )
}
