/**
 * Dialog: upload a CSV/TSV genotype matrix into a study.
 *
 * UX flow:
 *   1. User picks a file via the browser's file input.
 *   2. The parser (`parseGenotypeMatrix`) runs client-side and the dialog
 *      surfaces a header preview (sample count + variant count + meta
 *      columns + parser warnings).
 *   3. User clicks "Ingest"; the mutation POSTs the parsed batch.
 *   4. On success the dialog flips to a result view (variants_inserted /
 *      records_inserted / errors[]); user clicks "Close" or "Upload another."
 *
 * Strict-E2E: every step here is reachable via DOM testids, the parser is
 * synchronous (no race), and the mutation hits the real backend.
 */
import { useRef, useState } from "react"
import { toast } from "sonner"

import type {
  GenotypeMatrixBatchInput,
  GenotypeMatrixBatchResult,
} from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useIngestGenotypeMatrix } from "@/features/genotyping/hooks/useGenotypeRecords"
import {
  GenotypeMatrixParseError,
  type GenotypeMatrixParseResult,
  parseGenotypeMatrix,
} from "@/features/genotyping/lib/genotypeMatrix"

export type IngestMatrixDialogProps = {
  studyId: string
  open: boolean
  onClose: () => void
}

type Stage =
  | { kind: "empty" }
  | { kind: "parsed"; result: GenotypeMatrixParseResult; fileName: string }
  | { kind: "result"; data: GenotypeMatrixBatchResult; fileName: string }

export function IngestMatrixDialog({
  studyId,
  open,
  onClose,
}: IngestMatrixDialogProps) {
  const [stage, setStage] = useState<Stage>({ kind: "empty" })
  const [parseError, setParseError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Pull the batch shape out of `parsed` so the submit handler can consume
  // it after a re-render without re-parsing.
  const parsedBatch: GenotypeMatrixBatchInput | null =
    stage.kind === "parsed" ? stage.result.batch : null

  const ingest = useIngestGenotypeMatrix(studyId)

  function reset() {
    setStage({ kind: "empty" })
    setParseError(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function handleFile(file: File) {
    setParseError(null)
    try {
      const text = await file.text()
      const result = parseGenotypeMatrix(text)
      setStage({ kind: "parsed", result, fileName: file.name })
    } catch (e) {
      const msg =
        e instanceof GenotypeMatrixParseError
          ? e.message
          : `Failed to read file: ${(e as Error).message}`
      setParseError(msg)
      setStage({ kind: "empty" })
    }
  }

  function handleSubmit() {
    if (!parsedBatch || stage.kind !== "parsed") return
    ingest.mutate(parsedBatch, {
      onSuccess: (data) => {
        setStage({ kind: "result", data, fileName: stage.fileName })
        toast.success(
          `Ingested ${data.records_inserted} records (${data.variants_inserted} new variants)`,
        )
      },
      onError: (err: Error) => toast.error(err.message),
    })
  }

  function handleClose() {
    reset()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload genotype matrix</DialogTitle>
          <DialogDescription>
            CSV or TSV with columns{" "}
            <code>
              variant_name, chromosome, position, alleles, design_sequence
            </code>{" "}
            followed by one column per sample (header = accession name).
          </DialogDescription>
        </DialogHeader>

        {stage.kind === "empty" && (
          <div className="space-y-3" data-testid="ingest-matrix-empty">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
              data-testid="ingest-matrix-file"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0]
                if (f) void handleFile(f)
              }}
              className="block w-full text-sm"
            />
            {parseError && (
              <p
                className="text-sm text-red-600"
                data-testid="ingest-matrix-parse-error"
              >
                {parseError}
              </p>
            )}
          </div>
        )}

        {stage.kind === "parsed" && (
          <div className="space-y-3" data-testid="ingest-matrix-preview">
            <div className="bg-muted rounded-md p-3 text-sm">
              <p>
                <strong>{stage.fileName}</strong>
              </p>
              <p className="text-muted-foreground mt-1">
                {stage.result.variantCount} variant
                {stage.result.variantCount === 1 ? "" : "s"}
                {" · "}
                {stage.result.sampleHeaders.length} sample
                {stage.result.sampleHeaders.length === 1 ? "" : "s"}
                {" · "}
                meta cols: {stage.result.metaHeaders.join(", ") || "(none)"}
              </p>
              <p className="text-muted-foreground mt-1 truncate">
                Samples: {stage.result.sampleHeaders.slice(0, 6).join(", ")}
                {stage.result.sampleHeaders.length > 6 ? ", …" : ""}
              </p>
            </div>
            {stage.result.warnings.length > 0 && (
              <ul className="text-xs text-amber-600">
                {stage.result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {stage.kind === "result" && (
          <div className="space-y-3" data-testid="ingest-matrix-result">
            <div className="rounded-md border p-3 text-sm">
              <p>
                <strong>{stage.fileName}</strong>
              </p>
              <ul className="text-muted-foreground mt-1">
                <li>Variants inserted: {stage.data.variants_inserted}</li>
                <li>Records inserted: {stage.data.records_inserted}</li>
              </ul>
              {stage.data.errors && stage.data.errors.length > 0 && (
                <details
                  className="mt-2"
                  data-testid="ingest-matrix-result-errors"
                >
                  <summary className="cursor-pointer text-amber-700">
                    {stage.data.errors.length} ingest warning
                    {stage.data.errors.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="mt-1 list-disc pl-5 text-xs text-amber-700">
                    {stage.data.errors.map((err, i) => (
                      <li key={`${i}-${err}`}>{err}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {stage.kind === "result" ? (
            <>
              <Button variant="outline" onClick={reset}>
                Upload another
              </Button>
              <Button onClick={handleClose}>Close</Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={ingest.isPending}
              >
                Cancel
              </Button>
              <Button
                disabled={stage.kind !== "parsed" || ingest.isPending}
                onClick={handleSubmit}
                data-testid="ingest-matrix-submit"
              >
                {ingest.isPending ? "Ingesting…" : "Ingest"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
