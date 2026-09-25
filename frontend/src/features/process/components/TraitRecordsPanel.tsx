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
import { type Query, useQueries } from "@tanstack/react-query"
import { Download, Loader2, Trash2 } from "lucide-react"
import { useState } from "react"

import { type JobOutput, JobsService } from "@/client"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm-dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { apiUrl } from "@/features/files/lib/download"
import {
  useDeleteRunResults,
  useExperimentDatasetNames,
} from "@/features/process/lib/runResults"
import type { Run } from "@/features/process/lib/runStore"
import useCustomToast from "@/hooks/useCustomToast"

function downloadAuthed(filePath: string, suggestedName: string) {
  const token = localStorage.getItem("gemini.auth.token") ?? ""
  const url = apiUrl(`/api/files/download/${filePath}`)
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
  // Newest first: jobIds is appended-in-order in runStore, so reverse for
  // the panel.
  const jobIds = [...(run.steps.trait_extraction?.jobIds ?? [])].reverse()
  const experiment = run.uploadScope?.experiment
  const deleteRunResults = useDeleteRunResults()
  const confirm = useConfirm()
  const { showSuccessToast, showErrorToastWithCopy } = useCustomToast()
  const [deleting, setDeleting] = useState<string | null>(null)

  const onDelete = async (jobId: string, datasetName: string) => {
    if (!experiment) return
    const ok = await confirm({
      title: "Delete this run's trait values?",
      description: (
        <span>
          Removes the per-plot values this extraction wrote, so Analyze no
          longer uses them. The traits GeoJSON file stays and can be downloaded.{" "}
          <strong>This cannot be undone.</strong>
        </span>
      ),
      confirmLabel: "Delete values",
      variant: "destructive",
    })
    if (!ok) return
    setDeleting(jobId)
    try {
      await deleteRunResults(experiment, datasetName)
      showSuccessToast("Trait values deleted")
    } catch (e) {
      showErrorToastWithCopy(e instanceof Error ? e.message : "Delete failed")
    } finally {
      setDeleting(null)
    }
  }

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
      // Without this, the initial PENDING/RUNNING fetch sits in cache and the
      // status cell shows "PENDING" long after the worker has finished — the
      // WS terminal event updates runStore but doesn't invalidate this query.
      // Poll until the job reaches a terminal state, then stop.
      refetchInterval: (q: Query<JobOutput | null, Error>) => {
        const s = q.state.data?.status
        return s === "PENDING" || s === "RUNNING" ? 3_000 : false
      },
    })),
  })

  const datasetNames = useExperimentDatasetNames(
    experiment,
    jobIds.filter((_, i) => queries[i]?.data?.status === "COMPLETED"),
  )

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
            <TableHead>In Analyze</TableHead>
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
            const datasetName = (
              job?.result as { dataset_name?: string } | null
            )?.dataset_name
            // Live = its dataset still exists; a later run replaces it.
            const live =
              datasetName !== undefined &&
              datasetNames.data?.has(datasetName) === true
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
                <TableCell
                  className="text-xs"
                  data-testid={`trait-record-live-${jobId.slice(0, 8)}`}
                >
                  {job?.status !== "COMPLETED" || !datasetName
                    ? "—"
                    : datasetNames.isLoading
                      ? "…"
                      : live
                        ? "Yes"
                        : "No — replaced or deleted"}
                </TableCell>
                <TableCell className="text-right">
                  {live && datasetName && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete this run's trait values"
                      className="h-7 w-7"
                      disabled={deleting === jobId}
                      data-testid={`trait-record-delete-${jobId.slice(0, 8)}`}
                      onClick={() => onDelete(jobId, datasetName)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
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
