/**
 * JobDetail — generic viewer for any GEMINIbase job.
 *
 * Replaces RunDetail.tsx (5356 LOC kitchen sink). Per-step result rendering
 * lives on each step's own page; this page is intentionally generic so it
 * works for RUN_ODM, SPLIT_ORTHOMOSAIC, EXTRACT_TRAITS, EXTRACT_BINARY, etc.
 */
import { useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { ChevronLeft, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useCancelJob, useJob } from "@/features/process/hooks/useJobs"
import { subscribe, type JobProgressEvent } from "@/lib/wsManager"

export function JobDetail({ jobId }: { jobId: string }) {
  const { data: job, isLoading } = useJob(jobId)
  const cancel = useCancelJob()
  const [liveProgress, setLiveProgress] = useState<JobProgressEvent | null>(null)

  useEffect(() => {
    const unsub = subscribe(jobId, (evt) => setLiveProgress(evt))
    return unsub
  }, [jobId])

  const status = liveProgress?.status ?? job?.status ?? "—"
  const progress = liveProgress?.progress ?? job?.progress ?? 0
  const stage =
    (liveProgress?.progress_detail as { stage?: string } | null | undefined)?.stage ??
    null

  return (
    <div className="container max-w-3xl space-y-4 px-4 py-6">
      <Button asChild variant="ghost" size="sm">
        <Link to="/process">
          <ChevronLeft className="mr-1 h-4 w-4" /> Back to pipeline
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            Job {jobId.slice(0, 8)}…
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Type">{job?.job_type ?? "—"}</Row>
          <Row label="Status">{status}</Row>
          <Row label="Progress">
            <div className="flex items-center gap-2">
              <div className="h-2 w-40 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs">{progress}%</span>
            </div>
          </Row>
          {stage && <Row label="Stage">{stage}</Row>}
          {job?.error_message && (
            <Row label="Error">
              <pre className="whitespace-pre-wrap text-xs text-red-600">
                {job.error_message}
              </pre>
            </Row>
          )}
          {job?.result && (
            <Row label="Result">
              <pre className="bg-muted max-h-60 overflow-auto rounded p-2 text-xs">
                {JSON.stringify(job.result, null, 2)}
              </pre>
            </Row>
          )}
          {job?.parameters && (
            <Row label="Parameters">
              <pre className="bg-muted max-h-60 overflow-auto rounded p-2 text-xs">
                {JSON.stringify(job.parameters, null, 2)}
              </pre>
            </Row>
          )}
          {job && status !== "COMPLETED" && status !== "FAILED" && status !== "CANCELLED" && (
            <div className="pt-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(jobId)}
              >
                Cancel job
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span>{children}</span>
    </div>
  )
}
