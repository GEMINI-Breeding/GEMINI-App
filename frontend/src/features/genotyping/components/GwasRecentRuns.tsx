/**
 * Study-scoped recent RUN_GWAS jobs. Polls every 5s while the tab is
 * visible. Row click navigates to the nested job-detail route; the
 * explicit "View" link in the rightmost column makes that affordance
 * obvious for users who don't realise the row itself is clickable.
 *
 * Each row also exposes a Delete affordance which (a) cancels the job
 * first if it's still PENDING/RUNNING so the worker doesn't keep
 * grinding on a row the user wants gone, then (b) DELETEs the job —
 * which also sweeps the MinIO artifacts under gwas/{job_id}/ (see
 * backend jobs.py::_sweep_gwas_artifacts).
 */
import { Link, useNavigate } from "@tanstack/react-router"
import { ArrowRight, BarChart3, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
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
import { useCancelJob } from "@/features/process/hooks/useJobs"
import { idAsString } from "@/features/admin/lib/ids"
import {
  jobTraitNames,
  useDeleteGwasJob,
  useStudyGwasJobs,
  useTraitNameMap,
} from "@/features/genotyping/hooks/useGwas"
import { displayStage, statusVariant } from "@/features/genotyping/lib/gwasResult"
import useCustomToast from "@/hooks/useCustomToast"

export interface GwasRecentRunsProps {
  studyId: string
}

export function GwasRecentRuns({ studyId }: GwasRecentRunsProps) {
  const navigate = useNavigate()
  const jobs = useStudyGwasJobs(studyId)
  const traitNameMap = useTraitNameMap()
  const deleteJob = useDeleteGwasJob()
  const cancelJob = useCancelJob()
  const confirm = useConfirm()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const rows = jobs.data ?? []
  // Most-recent completed run, by created_at. The "View results" button
  // jumps the user straight into the detail/browser view for it; from
  // there the sidebar lets them click through every run in this study.
  // Hidden when nothing has completed yet — there's nothing to view.
  const mostRecentCompletedJobId = rows
    .filter((j) => String(j.status ?? "").toLowerCase() === "completed")
    .map((j) => ({ id: idAsString(j.id), createdAt: j.created_at ?? "" }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]?.id

  async function handleDelete(jobId: string, status: string, traitLabel: string) {
    const statusLower = status.toLowerCase()
    const isLive = statusLower === "pending" || statusLower === "running"
    const ok = await confirm({
      title: "Delete GWAS run?",
      description: isLive
        ? `This will cancel the in-progress run for "${traitLabel}" and permanently delete its job record + all MinIO artifacts (Manhattan, QQ, kinship, sumstats, etc). This cannot be undone.`
        : `This permanently deletes the run for "${traitLabel}" and all its MinIO artifacts (Manhattan, QQ, kinship, sumstats, etc). This cannot be undone.`,
      confirmLabel: isLive ? "Cancel and delete" : "Delete",
      variant: "destructive",
      action: async () => {
        // Cancel first if it's still live so the worker stops grinding;
        // the cancel sets job.status = CANCELLED, which the delete then
        // sweeps along with the artifacts. Both calls are best-effort
        // wrapped in their own try so a 404 on cancel (e.g. job
        // already finished between the click and the API call) doesn't
        // block the delete.
        if (isLive) {
          try {
            await cancelJob.mutateAsync(jobId)
          } catch {
            // Worker may have raced ahead to terminal; fall through.
          }
        }
        await deleteJob.mutateAsync(jobId)
      },
    })
    if (ok) {
      showSuccessToast(
        isLive ? "GWAS run cancelled and deleted" : "GWAS run deleted",
      )
    } else if (deleteJob.error || cancelJob.error) {
      // useConfirm closes the dialog with `false` when the action
      // throws; surface the actual error here.
      const err = deleteJob.error ?? cancelJob.error
      showErrorToast(err?.message ?? "Failed to delete GWAS run")
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Recent GWAS runs</h2>
        {mostRecentCompletedJobId && (
          <Link
            to="/genotyping/$studyId/gwas/$jobId"
            params={{ studyId, jobId: mostRecentCompletedJobId }}
            data-testid="gwas-view-results"
          >
            <Button size="sm" variant="default">
              <BarChart3 className="mr-2 h-4 w-4" />
              View results
            </Button>
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <p
          className="text-muted-foreground text-sm"
          data-testid="gwas-recent-empty"
        >
          {jobs.isLoading ? "Loading…" : "No runs yet."}
        </p>
      ) : (
        <div
          className="overflow-hidden rounded-md border"
          data-testid="gwas-recent-runs"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trait</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Job ID</TableHead>
                <TableHead className="w-[60px] text-right">View</TableHead>
                <TableHead className="w-[60px] text-right">Delete</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((job) => {
                const jobId = idAsString(job.id)
                const stage =
                  job.progress_detail && typeof job.progress_detail === "object"
                    ? String(
                        (job.progress_detail as Record<string, unknown>)
                          .stage ?? "",
                      )
                    : ""
                const status = job.status ?? "PENDING"
                const traitNames = jobTraitNames(job, traitNameMap.data)
                const traitLabel =
                  traitNames.length === 0
                    ? "—"
                    : traitNames.length === 1
                      ? traitNames[0]
                      : `${traitNames[0]} +${traitNames.length - 1}`
                return (
                  <TableRow
                    key={jobId}
                    data-testid={`gwas-recent-row-${jobId}`}
                    onClick={() =>
                      navigate({
                        to: "/genotyping/$studyId/gwas/$jobId",
                        params: { studyId, jobId },
                      })
                    }
                    className="hover:bg-muted/50 cursor-pointer"
                  >
                    <TableCell
                      className="font-medium"
                      title={traitNames.join(", ")}
                    >
                      {traitLabel}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(status)}>{status}</Badge>
                    </TableCell>
                    <TableCell>{Math.round(job.progress ?? 0)}%</TableCell>
                    <TableCell>{job.created_at ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {displayStage(status, stage)}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {jobId.slice(0, 8)}…
                    </TableCell>
                    <TableCell
                      className="text-right"
                      // Stop the row-click handler from double-firing when
                      // the user clicks the View link directly.
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Link
                        to="/genotyping/$studyId/gwas/$jobId"
                        params={{ studyId, jobId }}
                        data-testid={`gwas-recent-view-${jobId}`}
                        className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-xs font-medium"
                      >
                        View <ArrowRight className="h-3 w-3" />
                      </Link>
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive h-7 w-7"
                        data-testid={`gwas-recent-delete-${jobId}`}
                        aria-label="Delete GWAS run"
                        onClick={() => handleDelete(jobId, status, traitLabel)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
