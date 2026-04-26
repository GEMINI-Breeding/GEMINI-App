/**
 * ProcessingPipeline — overview page for the Phase-7 aerial pipeline.
 *
 * Replaces the 1063-line workspace-keyed pre-migration page. The new flow:
 * pick experiment / season / site / population in the sidebar, pick a date
 * + platform + sensor here, then jump into one of three step tools
 * (Orthomosaic → Plot boundaries → Split → Extract traits). Recent jobs for
 * the active scope land in a table at the bottom so the user can re-enter
 * an in-progress run.
 */
import { useEffect, useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
import { CheckCircle2, Circle, Cog, Image as ImageIcon, Loader2, ScissorsLineDashed, Sprout } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  AerialScopePicker,
  readStoredAerialFields,
  useAerialScopeContext,
  writeStoredAerialFields,
  type AerialScopeFields,
} from "@/features/process/components/AerialScopePicker"
import { useJobs } from "@/features/process/hooks/useJobs"

const STEPS: Array<{
  key: string
  title: string
  description: string
  to: string
  jobType: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  {
    key: "orthomosaic",
    title: "Orthomosaic",
    description: "Stitch raw drone images into a single georeferenced ortho.",
    to: "/process/orthomosaic",
    jobType: "RUN_ODM",
    icon: ImageIcon,
  },
  {
    key: "plot-boundaries",
    title: "Plot boundaries",
    description: "Draw or generate plot polygons; manage versioned snapshots.",
    to: "/process/plot-boundaries",
    jobType: "",
    icon: Cog,
  },
  {
    key: "split",
    title: "Split orthomosaic",
    description: "Cut the ortho into per-plot images using the active boundary.",
    to: "/process/split",
    jobType: "SPLIT_ORTHOMOSAIC",
    icon: ScissorsLineDashed,
  },
  {
    key: "extract-traits",
    title: "Extract traits",
    description: "Compute Vegetation_Fraction (and canopy height with a DEM) per plot.",
    to: "/process/extract-traits",
    jobType: "EXTRACT_TRAITS",
    icon: Sprout,
  },
]

export function ProcessingPipeline() {
  const ctx = useAerialScopeContext()
  const [fields, setFields] = useState<AerialScopeFields>(() =>
    readStoredAerialFields(),
  )
  useEffect(() => writeStoredAerialFields(fields), [fields])

  const { data: jobs = [] } = useJobs({
    experimentId: ctx.experimentId,
    refetchIntervalMs: 5_000,
  })

  // Bucket the latest job per JOB_TYPE for the step status badges.
  const latestByType = useMemo(() => {
    const map = new Map<string, (typeof jobs)[number]>()
    for (const j of jobs) {
      const cur = map.get(j.job_type)
      if (!cur) {
        map.set(j.job_type, j)
        continue
      }
      const aMs = j.created_at ? Date.parse(j.created_at) : 0
      const bMs = cur.created_at ? Date.parse(cur.created_at) : 0
      if (aMs > bMs) map.set(j.job_type, j)
    }
    return map
  }, [jobs])

  return (
    <div className="container max-w-5xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">Processing pipeline</h1>
        <p className="text-muted-foreground text-sm">
          Run the aerial pipeline against {ctx.experimentName || "the selected experiment"}.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Flight scope</CardTitle>
          <CardDescription>
            Pick the date, platform, and sensor for the data you want to process.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AerialScopePicker value={fields} onChange={setFields} />
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Steps</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {STEPS.map((step) => {
            const job = step.jobType ? latestByType.get(step.jobType) : undefined
            const status = job?.status ?? "—"
            const StepIcon = step.icon
            return (
              <Card key={step.key}>
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <StepIcon className="mt-0.5 h-5 w-5 text-muted-foreground" />
                    <div className="flex-1">
                      <CardTitle className="text-base">{step.title}</CardTitle>
                      <CardDescription className="text-xs">{step.description}</CardDescription>
                    </div>
                    <StepBadge status={status} />
                  </div>
                </CardHeader>
                <CardContent>
                  <Button asChild size="sm" variant="outline">
                    <Link to={step.to as never}>Open</Link>
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Recent jobs</h2>
        {jobs.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No jobs yet for this experiment.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left">Job type</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Created</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {jobs.slice(0, 25).map((j) => (
                  <tr key={String(j.id)} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{j.job_type}</td>
                    <td className="px-3 py-2">{j.status ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {j.created_at ? new Date(j.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button asChild size="sm" variant="ghost">
                        <Link
                          to="/process/jobs/$jobId"
                          params={{ jobId: String(j.id ?? "") }}
                        >
                          Details
                        </Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function StepBadge({ status }: { status: string }) {
  if (status === "COMPLETED") {
    return <CheckCircle2 className="h-5 w-5 text-green-600" aria-label="Completed" />
  }
  if (status === "RUNNING" || status === "PENDING") {
    return <Loader2 className="h-5 w-5 animate-spin text-blue-600" aria-label="Running" />
  }
  if (status === "FAILED") {
    return <Circle className="h-5 w-5 text-red-500" aria-label="Failed" />
  }
  return <Circle className="h-5 w-5 text-muted-foreground" aria-label="Not run" />
}
