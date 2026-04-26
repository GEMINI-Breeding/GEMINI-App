/**
 * TrainModelTool — placeholder page.
 *
 * The TRAIN_MODEL job type is registered on the worker but the worker
 * currently raises NotImplementedError (`backend/gemini/workers/ml/worker.py`
 * line ~70). Submitting one is intentionally surfaced rather than hidden:
 * researchers asking for it should know there's a gap, not silently sit on
 * a broken queue.
 *
 * The "Submit anyway" button is here for testing the failure path — the
 * job goes to FAILED with an explicit message; useful for verifying the
 * worker pipeline is up before any real implementation lands.
 */
import { Link } from "@tanstack/react-router"
import { AlertTriangle, ChevronLeft } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useProcess } from "@/contexts/ProcessContext"
import { useExperimentScope } from "@/contexts/ExperimentContext"
import { useSubmitJob } from "@/features/process/hooks/useJobs"
import useCustomToast from "@/hooks/useCustomToast"

export function TrainModelTool() {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { experimentId } = useExperimentScope()
  const { addProcess } = useProcess()
  const submit = useSubmitJob()
  const [submitted, setSubmitted] = useState<string | null>(null)

  async function handleSubmit() {
    try {
      const job = await submit.mutateAsync({
        jobType: "TRAIN_MODEL",
        parameters: { note: "frontend smoke test" },
        experimentId: experimentId,
      })
      const jobId = String(job.id ?? "")
      setSubmitted(jobId)
      addProcess({
        type: "processing",
        status: "running",
        title: `TRAIN_MODEL job ${jobId.slice(0, 8)}`,
        items: [],
        runId: jobId,
        link: `/process/jobs/${jobId}`,
      })
      showSuccessToast("Job submitted. The worker will mark it FAILED.")
    } catch (err) {
      showErrorToast((err as Error).message)
    }
  }

  return (
    <div className="container max-w-3xl space-y-4 px-4 py-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/models">
            <ChevronLeft className="mr-1 h-4 w-4" /> Models
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Train new model
          </CardTitle>
          <CardDescription>
            Training is not yet implemented in this deployment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            The <code className="rounded bg-muted px-1.5 py-0.5">TRAIN_MODEL</code> job type is registered
            on the ML worker but raises <code>NotImplementedError</code> — training requires GPU
            scheduling and a framework that we have not yet provisioned. To run model training today,
            train externally (e.g. Roboflow, Ultralytics) and register the resulting model on the{" "}
            <Link to="/models" className="underline">Models</Link> page.
          </p>
          <div className="rounded border bg-muted/30 p-3">
            <p className="font-medium mb-1">Submit a smoke-test job</p>
            <p className="text-muted-foreground text-xs mb-3">
              Submits a TRAIN_MODEL job that will reach the worker and be marked
              FAILED. Useful only for checking worker plumbing.
            </p>
            <Button
              variant="outline"
              size="sm"
              data-testid="train-submit-smoke"
              onClick={handleSubmit}
              disabled={submit.isPending}
            >
              {submit.isPending ? "Submitting…" : "Submit smoke-test job"}
            </Button>
            {submitted && (
              <p className="text-xs text-muted-foreground mt-2">
                Submitted job <code>{submitted.slice(0, 8)}</code> — see Process panel for status.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
