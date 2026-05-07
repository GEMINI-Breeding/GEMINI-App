/**
 * Phase 9d' replacement: a thin wrapper over the new streamed
 * ``ingest-pgen`` endpoint.
 *
 * Old shape (Phase 9d): client parsed the xlsx with SheetJS, walked
 * 32k variant rows in JavaScript, batched 5k variants at a time, fired
 * 16+ POSTs sequentially, accumulated insert counts. ~20 minutes for
 * the user's 35 MB tpj13827 file.
 *
 * New shape (this file): single multipart POST of the original upload.
 * The server runs ``plink2 --vcf … --make-pgen`` + ``bcftools sort``
 * and writes PGEN+BCF+stats to MinIO. Wall-clock for the same file is
 * ~46 s — and most of that is the upload itself; server-side work is
 * <30 s. The UI here is just an upload progress bar with a phase
 * indicator that flips to "Encoding" once the bytes have landed.
 */

import { useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { GenotypingStudiesService } from "@/client"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { idAsString } from "@/features/admin/lib/ids"
import type { GenomicMatrixShape } from "@/features/import/lib/detection-engine"
import type {
  FileWithPath,
  GenomicWizardState,
  ImportMetadata,
  UploadResults,
} from "@/features/import/lib/types"

interface StepIngestGenomicProps {
  file: FileWithPath
  /** Detection-engine shape. Kept on the props for API compatibility
   *  with the old component but no longer used here — server-side
   *  PGEN encoding handles all of this. */
  shape: GenomicMatrixShape
  metadata: ImportMetadata
  genomic: GenomicWizardState
  onBusyChange?: (busy: boolean) => void
  onDone: (results: UploadResults) => void
  onBack: () => void
}

type Phase =
  | { kind: "idle" }
  | { kind: "creating_study" }
  | { kind: "uploading"; loaded: number; total: number }
  | { kind: "encoding" }
  | { kind: "done" }
  | { kind: "error"; message: string }

// Backend `request_max_body_size` is 2 GiB; leave headroom for multipart
// boundary overhead + the metadata fields. Anything above this will be
// rejected by Litestar before it even reaches the route handler.
const MAX_UPLOAD_BYTES = 1.5 * 1024 * 1024 * 1024
// Soft warning threshold — files this large are valid but slow enough
// (mostly the upload itself) that we surface a "this will take a while"
// hint so the user doesn't abandon before plink2 finishes.
const SOFT_WARN_BYTES = 200 * 1024 * 1024

interface IngestSummary {
  variantsInserted: number
  recordsInserted: number
  samplesInserted: number
  errors: string[]
  studyId: string | null
}

function isBusy(phase: Phase): boolean {
  return (
    phase.kind === "creating_study" ||
    phase.kind === "uploading" ||
    phase.kind === "encoding"
  )
}

export function StepIngestGenomic({
  file,
  metadata,
  genomic,
  onBusyChange,
  onDone,
  onBack,
}: StepIngestGenomicProps) {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<Phase>({ kind: "idle" })
  const [summary, setSummary] = useState<IngestSummary>({
    variantsInserted: 0,
    recordsInserted: 0,
    samplesInserted: 0,
    errors: [],
    studyId: null,
  })
  const startedRef = useRef(false)

  useEffect(() => {
    onBusyChange?.(isBusy(phase))
  }, [phase, onBusyChange])

  const run = useCallback(async (): Promise<void> => {
    try {
      if (file.size > MAX_UPLOAD_BYTES) {
        setPhase({
          kind: "error",
          message:
            `File is ${formatBytes(file.size)}, larger than the ` +
            `${formatBytes(MAX_UPLOAD_BYTES)} ingest ceiling. Split the ` +
            `dataset by chromosome (PLINK2 \`--chr ...\`) and import each ` +
            `chunk separately, or convert to PGEN locally and upload the ` +
            `\`.pgen\` directly.`,
        })
        return
      }

      // 1. Resolve / create the study. The server's ingest endpoint
      //    requires the study to exist first; we keep that detail in
      //    the wizard rather than the endpoint so a back-button doesn't
      //    leave an orphan study row.
      let studyId = genomic.studyId
      setPhase({ kind: "creating_study" })
      if (genomic.createNewStudy) {
        const created =
          await GenotypingStudiesService.apiGenotypingStudiesCreateStudy({
            requestBody: {
              study_name: genomic.studyName,
              experiment_name: metadata.experimentName || null,
            },
          })
        studyId = idAsString(created.id)
      }
      if (!studyId) {
        throw new Error("No study id available after creation step.")
      }

      // 2. POST the file. Use a hand-rolled XHR so we get progress
      //    callbacks; the SDK uses fetch under the hood and fetch's
      //    upload progress isn't supported across browsers reliably.
      setPhase({ kind: "uploading", loaded: 0, total: file.size })
      const result = await uploadWithProgress(
        studyId,
        file as File,
        genomic.sampleResolution?.canonicalByHeader ?? {},
        genomic.sampleResolution?.skippedHeaders ?? [],
        genomic.sampleResolution?.createdAccessions ?? [],
        // Optional: forward the population (and the experiment that
        // owns it) so the backend can group every wizard-created
        // accession under a Population row, mirroring the trait
        // wizard's behavior. Omitted fields → backend skips the link.
        metadata.experimentName || null,
        genomic.populationName,
        (loaded, total) => {
          setPhase({ kind: "uploading", loaded, total })
        },
        () => {
          setPhase({ kind: "encoding" })
        },
      )

      const summaryNext: IngestSummary = {
        variantsInserted: result.variants_inserted ?? 0,
        recordsInserted: result.records_inserted ?? 0,
        samplesInserted: result.samples_inserted ?? 0,
        errors: result.errors ?? [],
        studyId,
      }
      setSummary(summaryNext)
      setPhase({ kind: "done" })
      // Sample-resolve and ingest may have created accessions and a
      // genotyping study tied to this experiment. Invalidate the
      // dropdowns the Files-page Upload form + the Manage tab read
      // so they pick up the new rows without a hard reload.
      for (const key of [
        "experiments",
        "accessions",
        "lines",
        "populations",
        "genotyping_studies",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
      onDone({
        createdEntities: [
          { type: "study", name: genomic.studyName, id: studyId },
        ],
        uploadedFiles: 1,
        failedFiles: summaryNext.errors.length > 0 ? 1 : 0,
        experimentId: metadata.experimentId,
        studyId,
      })
    } catch (err) {
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : "Genomic ingest failed",
      })
    }
  }, [file, genomic, metadata, onDone, queryClient])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void run()
  }, [run])

  return (
    <div className="space-y-4" data-testid="step-ingest-genomic">
      <div className="rounded-lg border p-4">
        <h3 className="font-medium">Ingesting {file.name}</h3>
        <p className="text-muted-foreground text-sm">
          Study <code>{genomic.studyName}</code>
          {metadata.experimentName && (
            <>
              {" "}
              · Experiment <code>{metadata.experimentName}</code>
            </>
          )}
        </p>
      </div>

      {file.size > SOFT_WARN_BYTES && file.size <= MAX_UPLOAD_BYTES && (
        <div
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm"
          data-testid="ingest-large-file-warning"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            Large file ({formatBytes(file.size)}). Upload may take a few
            minutes; PGEN encoding starts as soon as the bytes land.
          </span>
        </div>
      )}

      {phase.kind === "creating_study" && (
        <div
          className="text-muted-foreground flex items-center gap-2 text-sm"
          data-testid="ingest-phase-create-study"
        >
          <Loader2 className="h-4 w-4 animate-spin" /> Creating study…
        </div>
      )}

      {phase.kind === "uploading" && (
        <div className="space-y-2" data-testid="ingest-phase-upload">
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Uploading{" "}
            {formatBytes(phase.loaded)} / {formatBytes(phase.total)} (
            {phase.total > 0
              ? Math.round((phase.loaded / phase.total) * 100)
              : 0}
            %)
          </div>
          <Progress
            value={
              phase.total > 0
                ? Math.min(100, (phase.loaded / phase.total) * 100)
                : 0
            }
          />
        </div>
      )}

      {phase.kind === "encoding" && (
        <div
          className="text-muted-foreground flex items-center gap-2 text-sm"
          data-testid="ingest-phase-encoding"
        >
          <Loader2 className="h-4 w-4 animate-spin" /> Server is encoding PGEN +
          indexing BCF + computing stats. This typically takes tens of seconds.
        </div>
      )}

      {phase.kind === "done" && (
        <div
          className="space-y-1 rounded-lg border p-4"
          data-testid="ingest-phase-done"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-green-600">
            <CheckCircle2 className="h-4 w-4" /> Ingest complete
          </div>
          <div className="text-muted-foreground text-sm">
            {summary.variantsInserted.toLocaleString()} variant
            {summary.variantsInserted === 1 ? "" : "s"} ·{" "}
            {summary.recordsInserted.toLocaleString()} record
            {summary.recordsInserted === 1 ? "" : "s"} ·{" "}
            {summary.samplesInserted.toLocaleString()} sample
            {summary.samplesInserted === 1 ? "" : "s"}.
          </div>
          {summary.errors.length > 0 && (
            <details className="text-sm">
              <summary className="text-destructive cursor-pointer">
                {summary.errors.length} warning
                {summary.errors.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                {summary.errors.slice(0, 20).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {phase.kind === "error" && (
        <div
          className="text-destructive rounded-lg border border-red-300 p-4"
          data-testid="ingest-phase-error"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle className="h-4 w-4" /> Ingest failed
          </div>
          <div className="text-sm">{phase.message}</div>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={isBusy(phase)}>
          Back
        </Button>
      </div>
    </div>
  )
}

/** Hand-rolled multipart upload with progress events. The SDK's fetch
 *  client doesn't expose upload progress reliably; XHR does. */
function uploadWithProgress(
  studyId: string,
  file: File,
  canonicalMap: Record<string, string>,
  skippedHeaders: string[],
  createdAccessions: string[],
  experimentName: string | null,
  populationName: string | null,
  onProgress: (loaded: number, total: number) => void,
  onUploadComplete: () => void,
): Promise<{
  variants_inserted: number
  records_inserted: number
  samples_inserted?: number
  errors?: string[]
}> {
  return new Promise((resolve, reject) => {
    const fd = new FormData()
    fd.append("file", file)
    fd.append("sample_canonical_map_json", JSON.stringify(canonicalMap))
    fd.append("skipped_headers_json", JSON.stringify(skippedHeaders))
    fd.append("created_accessions_json", JSON.stringify(createdAccessions))
    if (experimentName) fd.append("experiment_name", experimentName)
    if (populationName) fd.append("population_name", populationName)

    const xhr = new XMLHttpRequest()
    xhr.open("POST", `/api/genotyping_studies/id/${studyId}/ingest-pgen`, true)
    // Pull the bearer token from localStorage the same way our SDK
    // does; lib/auth.ts mirrors this token under both keys.
    const token =
      localStorage.getItem("gemini.auth.token") ||
      localStorage.getItem("access_token")
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total)
    }
    xhr.upload.onload = () => {
      // Bytes are on the server; switch the UI to "encoding" while we
      // wait for the JSON response.
      onUploadComplete()
    }
    xhr.onerror = () => reject(new Error("Network error during upload"))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText))
        } catch (err) {
          reject(
            new Error(
              `Could not parse server response: ${
                err instanceof Error ? err.message : String(err)
              }`,
            ),
          )
        }
      } else {
        let detail = xhr.responseText
        try {
          const parsed = JSON.parse(xhr.responseText)
          detail = parsed.error ?? parsed.detail ?? xhr.responseText
        } catch {
          // Non-JSON error body; fall through to raw text.
        }
        reject(new Error(`Server returned ${xhr.status}: ${detail}`))
      }
    }
    xhr.send(fd)
  })
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}
