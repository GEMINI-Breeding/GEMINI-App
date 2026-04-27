/**
 * Browser-native file dropzone for Phase 6.
 *
 * Two paths in:
 *   - Click → hidden <input type="file" multiple webkitdirectory={false}>.
 *     Returns flat File[] for any selection.
 *   - Drop → walks `dataTransfer.items[].webkitGetAsEntry()` so dropping a
 *     *folder* expands into its contained files. Without that walk, browsers
 *     surface the folder as a single 0-byte File entry whose name is the
 *     folder, which the parent component then rejects as "wrong file type"
 *     (the previous misleading failure mode the user hit on
 *     `Subset Drone Data/`).
 */
import { useRef, useState } from "react"
import { Upload, Image } from "lucide-react"

interface UploadZoneProps {
  onFilesAdded?: (files: File[]) => void
  /** Hint for the native file picker. Examples: "image/*", ".csv,.xlsx" */
  accept?: string
}

interface FileSystemDirectoryEntryLike {
  isDirectory: true
  isFile: false
  name: string
  createReader(): { readEntries(cb: (entries: FileSystemEntryLike[]) => void, err?: (e: unknown) => void): void }
}
interface FileSystemFileEntryLike {
  isDirectory: false
  isFile: true
  name: string
  fullPath: string
  file(cb: (f: File) => void, err?: (e: unknown) => void): void
}
type FileSystemEntryLike = FileSystemDirectoryEntryLike | FileSystemFileEntryLike

async function readAllEntries(
  reader: ReturnType<FileSystemDirectoryEntryLike["createReader"]>,
): Promise<FileSystemEntryLike[]> {
  // readEntries returns at most ~100 entries per call; loop until empty.
  const out: FileSystemEntryLike[] = []
  while (true) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    )
    if (batch.length === 0) break
    out.push(...batch)
  }
  return out
}

async function entryToFiles(entry: FileSystemEntryLike): Promise<File[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      entry.file(resolve, reject),
    )
    return [file]
  }
  // Directory: read all children, recurse. Run in parallel for speed —
  // a typical drone-image folder has hundreds of JPGs.
  const children = await readAllEntries(entry.createReader())
  const nested = await Promise.all(children.map(entryToFiles))
  return nested.flat()
}

/**
 * Extract a flat File[] from a DataTransfer, walking any dropped directories.
 * Falls back to dataTransfer.files when items[] / webkitGetAsEntry isn't
 * available (older browsers, some test environments).
 */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items ?? [])
  const hasGetEntry = items.some(
    (it) => typeof (it as DataTransferItem & { webkitGetAsEntry?: unknown }).webkitGetAsEntry === "function",
  )
  if (!hasGetEntry) {
    return Array.from(dt.files)
  }

  const results = await Promise.all(
    items.map(async (item) => {
      if (item.kind !== "file") return [] as File[]
      const entry = (item as DataTransferItem & {
        webkitGetAsEntry?: () => FileSystemEntryLike | null
      }).webkitGetAsEntry?.()
      if (!entry) {
        const f = item.getAsFile()
        return f ? [f] : []
      }
      return entryToFiles(entry)
    }),
  )
  return results.flat()
}

export function UploadZone({ onFilesAdded, accept }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isExpanding, setIsExpanding] = useState(false)
  const dragCountRef = useRef(0)

  const handleClick = () => {
    inputRef.current?.click()
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) onFilesAdded?.(files)
    // Reset so picking the same file twice still triggers onChange.
    e.target.value = ""
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragCountRef.current++
    setIsDragOver(true)
  }
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault() // required to allow drop
  }
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragCountRef.current--
    if (dragCountRef.current <= 0) {
      dragCountRef.current = 0
      setIsDragOver(false)
    }
  }
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    dragCountRef.current = 0
    setIsDragOver(false)
    // Snapshot the DataTransfer before any await — React pools synthetic
    // events and `e.dataTransfer` becomes inaccessible after the first
    // microtask in older React versions.
    const dt = e.dataTransfer
    setIsExpanding(true)
    try {
      const files = await filesFromDataTransfer(dt)
      if (files.length > 0) onFilesAdded?.(files)
    } finally {
      setIsExpanding(false)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="mb-4 flex items-center gap-2">
        <Image className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-foreground">Upload</h2>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        onChange={handleInputChange}
        className="hidden"
        data-testid="upload-input"
      />

      <div
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleClick()
        }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        data-testid="upload-dropzone"
        className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          isDragOver
            ? "border-primary bg-primary/10"
            : "border-border hover:border-muted-foreground hover:bg-muted"
        }`}
      >
        <Upload className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <p className="mb-1 text-foreground">
          {isExpanding
            ? "Reading folder…"
            : isDragOver
              ? "Drop files or folders here"
              : "Click to browse, or drag & drop files or folders"}
        </p>
        <p className="text-muted-foreground">
          Folders are walked recursively; subfolders included.
        </p>
      </div>
    </div>
  )
}
