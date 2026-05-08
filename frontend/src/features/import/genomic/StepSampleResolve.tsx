/**
 * Phase 9d step 2: resolve the file's sample column headers to canonical
 * accession names. The matrix path can read its sample headers directly
 * from `detection.genomicShape`; HapMap and VCF files are read at this
 * step via the `genomicHeaders` lib (we kept detection cheap by leaving
 * those formats' `sampleHeaders` empty in the seeded DetectionResult).
 *
 * After resolution the user picks how to handle unresolved headers
 * (skip them entirely, or auto-create accessions for them). The
 * resulting `SampleResolution` is consumed by 9d.3's StepIngestGenomic.
 */
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { ResolveResultOutput } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  readHapmapSampleHeaders,
  readMatrixSampleHeaders,
  readVcfSampleHeaders,
} from "@/features/genotyping/lib/genomicHeaders"
import type { DetectionResult } from "@/features/import/lib/detection-engine"
import {
  isResolved,
  resolveGermplasmNames,
} from "@/features/import/lib/germplasmResolve"
import type {
  FileWithPath,
  GenomicWizardState,
  SampleResolution,
} from "@/features/import/lib/types"

interface StepSampleResolveProps {
  detection: DetectionResult
  file: FileWithPath
  genomic: GenomicWizardState
  experimentId: string | null
  initial: SampleResolution | null
  onNext: (resolution: SampleResolution) => void
  onBack: () => void
}

type UnresolvedAction = "skip_all" | "create_all" | null

type ResolutionState =
  | { phase: "reading-headers" }
  | { phase: "resolving"; resolved: number; total: number }
  | { phase: "error"; message: string }
  | {
      phase: "ready"
      sampleHeaders: string[]
      results: ResolveResultOutput[]
      unresolvedHeaders: string[]
    }

async function readHeadersForFormat(
  detection: DetectionResult,
  file: FileWithPath,
): Promise<string[]> {
  const shape = detection.genomicShape
  if (shape && shape.sampleHeaders.length > 0) return shape.sampleHeaders
  const format = shape?.format ?? "matrix"
  if (format === "hapmap") return readHapmapSampleHeaders(file as File)
  if (format === "vcf") return readVcfSampleHeaders(file as File)
  return readMatrixSampleHeaders(file as File)
}

export function StepSampleResolve({
  detection,
  file,
  genomic,
  experimentId,
  initial,
  onNext,
  onBack,
}: StepSampleResolveProps) {
  const [state, setState] = useState<ResolutionState>({
    phase: "reading-headers",
  })
  // Default to auto-create so the recommended action is preselected and
  // the user can't accidentally drop genotype calls by hitting Continue
  // without picking a side.
  const [userChoice, setUserChoice] = useState<UnresolvedAction>(() => {
    if (!initial) return "create_all"
    if (initial.skippedHeaders.length > 0) return "skip_all"
    if (initial.createdAccessions.length > 0) return "create_all"
    return "create_all"
  })

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        const headers = await readHeadersForFormat(detection, file)
        if (cancelled) return
        if (headers.length === 0) {
          setState({
            phase: "error",
            message: "No sample columns detected in the file.",
          })
          return
        }
        setState({ phase: "resolving", resolved: 0, total: headers.length })
        const results = await resolveGermplasmNames(headers, {
          experimentId,
          onProgress: (resolved, total) => {
            if (cancelled) return
            setState({ phase: "resolving", resolved, total })
          },
        })
        if (cancelled) return
        const unresolvedHeaders = results
          .filter((r) => !isResolved(r))
          .map((r) => r.input_name)
        setState({
          phase: "ready",
          sampleHeaders: headers,
          results,
          unresolvedHeaders,
        })
      } catch (err) {
        if (!cancelled) {
          setState({
            phase: "error",
            message:
              err instanceof Error ? err.message : "Sample resolution failed",
          })
        }
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [detection, file, experimentId])

  const previewRows = useMemo(() => {
    if (state.phase !== "ready") return []
    return state.results.slice(0, 25)
  }, [state])

  const canContinue =
    state.phase === "ready" &&
    state.results.length > 0 &&
    (state.unresolvedHeaders.length === 0 || userChoice !== null)

  const handleContinue = () => {
    if (state.phase !== "ready" || !canContinue) return
    const canonicalByHeader: Record<string, string> = {}
    const skippedHeaders: string[] = []
    const createdAccessions = new Set<string>()
    for (const r of state.results) {
      if (isResolved(r) && r.canonical_name) {
        canonicalByHeader[r.input_name] = r.canonical_name
        continue
      }
      if (userChoice === "skip_all") {
        skippedHeaders.push(r.input_name)
      } else if (userChoice === "create_all") {
        canonicalByHeader[r.input_name] = r.input_name
        createdAccessions.add(r.input_name)
      }
    }
    onNext({
      canonicalByHeader,
      skippedHeaders,
      createdAccessions: Array.from(createdAccessions),
    })
  }

  return (
    <div className="space-y-6" data-testid="step-sample-resolve">
      <div
        className="space-y-2 rounded-lg border p-4"
        data-testid="sample-resolve-summary"
      >
        <h3 className="font-medium">Sample Resolution</h3>
        <p className="text-muted-foreground text-sm">
          Matching the sample columns in <code>{file.name}</code> against
          existing accessions
          {genomic.studyName && (
            <>
              {" "}
              for study <code>{genomic.studyName}</code>
            </>
          )}
          .
        </p>
        {state.phase === "reading-headers" ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading sample headers…
          </div>
        ) : state.phase === "resolving" ? (
          <div className="space-y-2" data-testid="sample-resolve-progress">
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Matching{" "}
              {state.resolved} of {state.total} sample names…
            </div>
            <Progress
              value={
                state.total > 0
                  ? Math.min(100, (state.resolved / state.total) * 100)
                  : 0
              }
            />
          </div>
        ) : state.phase === "error" ? (
          <div className="text-destructive flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4" /> {state.message}
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span>
              <strong>
                {state.results.length - state.unresolvedHeaders.length}
              </strong>{" "}
              of {state.results.length} resolved automatically
            </span>
            {state.unresolvedHeaders.length > 0 && (
              <Badge variant="outline">
                {state.unresolvedHeaders.length} unresolved
              </Badge>
            )}
          </div>
        )}
      </div>

      {state.phase === "ready" && state.unresolvedHeaders.length > 0 && (
        <div
          className="space-y-3 rounded-lg border p-4"
          data-testid="unresolved-action"
        >
          <h4 className="font-medium">
            How should we handle the {state.unresolvedHeaders.length} unresolved
            sample headers?
          </h4>
          <p className="text-muted-foreground text-sm">
            Skip drops their genotype calls from the import. Auto-create
            registers each as a new accession before ingest.
          </p>
          <div className="flex gap-2">
            <Button
              variant={userChoice === "create_all" ? "default" : "outline"}
              onClick={() => setUserChoice("create_all")}
              data-testid="unresolved-create-all"
            >
              Auto-create accessions for all
            </Button>
            <Button
              variant={userChoice === "skip_all" ? "default" : "outline"}
              onClick={() => setUserChoice("skip_all")}
              data-testid="unresolved-skip-all"
            >
              Skip all {state.unresolvedHeaders.length}
            </Button>
          </div>
          <details className="text-sm">
            <summary className="text-muted-foreground cursor-pointer">
              Show unresolved sample names
            </summary>
            <div className="mt-2 flex max-h-48 flex-wrap gap-1 overflow-y-auto">
              {state.unresolvedHeaders.map((name) => (
                <Badge key={name} variant="secondary" className="text-xs">
                  {name}
                </Badge>
              ))}
            </div>
          </details>
        </div>
      )}

      {state.phase === "ready" && state.results.length > 0 && (
        <div
          className="overflow-hidden rounded-md border"
          data-testid="sample-resolve-preview"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sample header</TableHead>
                <TableHead>Match</TableHead>
                <TableHead>Canonical name</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.map((r) => (
                <TableRow key={r.input_name}>
                  <TableCell className="font-mono text-xs">
                    {r.input_name}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={isResolved(r) ? "secondary" : "outline"}
                      className="text-xs"
                    >
                      {r.match_kind}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.canonical_name ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {state.results.length > previewRows.length && (
            <div className="text-muted-foreground border-t p-2 text-center text-xs">
              Showing first {previewRows.length} of {state.results.length}{" "}
              samples
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          onClick={handleContinue}
          disabled={!canContinue}
          data-testid="sample-resolve-continue"
        >
          Continue
        </Button>
      </div>
    </div>
  )
}
