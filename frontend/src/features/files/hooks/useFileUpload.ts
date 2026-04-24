import { useCallback } from "react"

/**
 * Phase 4 transition stub.
 *
 * The pre-migration `uploadFiles` accepted *absolute server-side paths* and
 * asked the Tauri-embedded FastAPI backend to copy them. GEMINIbase replaces
 * that with pure-HTTP chunked upload from the browser (see
 * `src/lib/chunkedUpload.ts`). The call-site rewrite is Phase 5 work because
 * every dropzone / upload-button that feeds this hook needs to switch from
 * filesystem paths to browser `File` objects.
 *
 * Until that rewrite lands, importing and rendering a page that calls
 * `useFileUpload()` is fine — the throw only fires when the user actually
 * triggers an upload.
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
        "for rewrite in Phase 5.",
    )
  }, [])

  return { uploadFiles }
}
