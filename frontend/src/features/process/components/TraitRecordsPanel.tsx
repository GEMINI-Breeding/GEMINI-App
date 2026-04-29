/**
 * TraitRecordsPanel — list past EXTRACT_TRAITS jobs for a Run.
 *
 * Main read `analyzeApi.listTraitRecordsByRun` for a richly-joined record
 * with version numbers, plot counts, and per-plot image links. GEMINIbase
 * doesn't have a trait-record table — the only durable handle is the
 * EXTRACT_TRAITS job with its `result.output_traits_geojson_path`. So
 * this slim panel just enumerates the jobs that ran for this step,
 * showing status / created / output file / download link.
 *
 * R5 may extend this with deeper integration (per-plot image previews,
 * trait-record naming) once analyzeApi has a GEMINIbase-backed equivalent.
 */
import { useQueries } from "@tanstack/react-query"
import { Download, Loader2 } from "lucide-react"

import { JobsService, type JobOutput } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Run } from "@/features/process/lib/runStore"

function downloadAuthed(filePath: string, suggestedName: string) {
  const token = localStorage.getItem("gemini.auth.token") ?? ""
  const url = `/api/files/download/${filePath}`
  void (async () => {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`Download failed: ${res.status}`)
    const blob = await res.blob()
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = objUrl
    a.download = suggestedName
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(objUrl)
  })()
}

export function TraitRecordsPanel({ run }: { run: Run }) {
  const jobIds = run.steps.trait_extraction?.jobIds ?? []

  // Pull each job's current state. Cheap because the WS subscription in
  // RunDetail already keeps the running ones live; this is for completed
  // / historic entries that don't have an active socket.
  const queries = useQueries({
    queries: jobIds.map((jobId) => ({
      queryKey: ["jobs", jobId],
      queryFn: async (): Promise<JobOutput | null> => {
        try {
          return (await JobsService.apiJobsJobIdGetJob({ jobId })) as JobOutput
        } catch {
          return null
        }
      },
      staleTime: 30_000,
    })),
  })

  if (jobIds.length === 0) {
    return (
      <p className="text-muted-foreground rounded border bg-muted/30 p-2 text-xs">
        No trait extractions have been run for this Run yet.
      </p>
    )
  }

  return (
    <div className="mt-2 rounded-lg border" data-testid="trait-records-panel">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Job</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Output</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobIds.map((jobId, idx) => {
            const q = queries[idx]
            const job = q.data ?? null
            const status = job?.status ?? (q.isLoading ? "…" : "?")
            const createdAt = job?.created_at
              ? new Date(job.created_at).toLocaleString()
              : "—"
            const outputPath = (
              job?.result as { output_traits_geojson_path?: string } | null
            )?.output_traits_geojson_path
            const filename = outputPath?.split("/").pop() ?? "traits.geojson"
            return (
              <TableRow
                key={jobId}
                data-testid={`trait-record-row-${jobId.slice(0, 8)}`}
              >
                <TableCell className="font-mono text-xs">
                  {jobId.slice(0, 8)}
                </TableCell>
                <TableCell>
                  {q.isLoading ? (
                    <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <span className="text-xs">{status}</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {createdAt}
                </TableCell>
                <TableCell className="text-muted-foreground break-all text-xs">
                  {outputPath ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  {outputPath ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Download ${filename}`}
                      className="h-7 w-7"
                      onClick={() =>
                        downloadAuthed(`gemini/${outputPath}`, filename)
                      }
                    >
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
