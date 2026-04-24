import { useCallback } from "react"

/**
 * Phase-4 transition stub.
 *
 * The pre-migration `uploadFiles` accepted *absolute server-side paths* and
 * asked the Tauri-embedded FastAPI backend to copy them. GEMINIbase replaces
 * that with pure-HTTP chunked upload from the browser (see
 * `src/lib/chunkedUpload.ts`).
 *
 * Replacement scheduled: **Phase 6** (Files + Reference Data) — a new
 * `src/features/files/hooks/useChunkedUpload.ts` will replace this file's
 * entire surface. Every dropzone / upload-button that feeds this hook
 * switches from filesystem paths to browser `File` objects at that point.
 *
 * Until then, importing and rendering a page that calls `useFileUpload()`
 * is fine — the throw only fires when the user actually triggers an upload.
 */
interface UploadParams {
  filePaths: string[]
  dataType: string
  targetRootDir: string
  reupload?: boolean
  formValues?: Record<string, string>
  onComplete?: (destPaths: string[]) => void
  onDockerError?: (message: string) => void
}

export function useFileUpload() {
  const uploadFiles = useCallback((_params: UploadParams) => {
    throw new Error(
      "[useFileUpload] The legacy server-side path upload was removed in the " +
        "GEMINIbase migration. Call sites need to use browser File objects and " +
        "`uploadFileChunked` from src/lib/chunkedUpload.ts instead. Scheduled " +
        "for rewrite in Phase 6.",
    )
  }, [])

  return { uploadFiles }
}
