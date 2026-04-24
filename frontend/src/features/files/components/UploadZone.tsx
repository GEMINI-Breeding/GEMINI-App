/**
 * Browser-native file dropzone for Phase 6.
 *
 * The pre-migration zone handed the caller absolute server-side paths
 * (via Tauri's native drag-drop event) so the backend could copy files
 * directly off disk. GEMINIbase uploads happen through HTTP chunks, so
 * callers now need `File` objects — any path-only input is useless.
 *
 * Still click-to-browse *and* drop-to-browse:
 *   - Click fires a hidden <input type="file"> which works in both
 *     browser and Tauri webviews.
 *   - Drop reads `dataTransfer.files`.
 */
import { useRef, useState } from "react"
import { Upload, Image } from "lucide-react"

interface UploadZoneProps {
  onFilesAdded?: (files: File[]) => void
  /** Hint for the native file picker. Examples: "image/*", ".csv,.xlsx" */
  accept?: string
}

export function UploadZone({ onFilesAdded, accept }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
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
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragCountRef.current = 0
    setIsDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) onFilesAdded?.(files)
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
          {isDragOver
            ? "Drop files here"
            : "Click to browse or drag & drop files"}
        </p>
        <p className="text-muted-foreground">Supports multiple files</p>
      </div>
    </div>
  )
}
