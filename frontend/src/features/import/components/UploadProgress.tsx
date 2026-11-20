/**
 * Visual progress display for multi-file uploads.
 *
 * Ported from `backend/gemini-ui/src/components/upload/upload-progress.tsx`
 * with `UploadState` redirected to our local generic shape (so callers
 * built on `useChunkedUpload` rather than gemini-ui's `useUpload` can
 * still drive this component).
 */
import { CheckCircle, Loader2, XCircle } from "lucide-react"

import { formatFileSize } from "@/features/import/lib/detection-engine"
import type { UploadState } from "@/features/import/lib/types"
import { cn } from "@/lib/utils"

interface UploadProgressProps {
  state: UploadState
  className?: string
}

export function UploadProgress({ state, className }: UploadProgressProps) {
  return (
    <div className={cn("space-y-3", className)} data-testid="upload-progress">
      <div className="space-y-1">
        <div className="flex justify-between text-sm">
          <span className="font-medium">
            {state.isUploading
              ? "Uploading…"
              : state.completedCount === state.files.length
                ? "Complete"
                : "Upload"}
          </span>
          <span className="text-muted-foreground">
            {state.completedCount}/{state.files.length} files (
            {Math.round(state.overallProgress)}%)
          </span>
        </div>
        <div className="bg-muted h-2 overflow-hidden rounded-full">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              state.errorCount > 0 ? "bg-destructive" : "bg-primary",
            )}
            style={{ width: `${state.overallProgress}%` }}
          />
        </div>
      </div>

      <div className="max-h-60 space-y-1 overflow-y-auto">
        {state.files.map((f) => (
          <div
            key={f.objectName}
            className="flex items-center gap-2 py-1 text-xs"
          >
            {f.status === "complete" && (
              <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-600" />
            )}
            {f.status === "error" && (
              <XCircle className="text-destructive h-3.5 w-3.5 shrink-0" />
            )}
            {f.status === "uploading" && (
              <Loader2 className="text-primary h-3.5 w-3.5 shrink-0 animate-spin" />
            )}
            {f.status === "pending" && (
              <div className="border-muted-foreground h-3.5 w-3.5 shrink-0 rounded-full border" />
            )}
            <span className="flex-1 truncate">{f.file.name}</span>
            <span className="text-muted-foreground shrink-0">
              {formatFileSize(f.file.size)}
            </span>
            {f.status === "uploading" && (
              <span className="text-primary shrink-0">
                {Math.round(f.progress)}%
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
