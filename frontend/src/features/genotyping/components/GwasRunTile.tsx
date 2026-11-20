/**
 * One GWAS run as a tile: its Manhattan plot (a small server-made
 * thumbnail), the trait and environment it tested, and what it found.
 * Runs still going show their stage; failed ones say so. Clicking opens
 * the run's full results.
 */
import { useNavigate } from "@tanstack/react-router"
import { BarChart3, Loader2, TriangleAlert } from "lucide-react"

import type { JobOutput } from "@/client"
import { idAsString } from "@/features/admin/lib/ids"
import {
  AuthImage,
  thumbnailSrc,
} from "@/features/genotyping/components/AuthImage"
import {
  jobTraitNames,
  useExperimentScopeNames,
} from "@/features/genotyping/hooks/useGwas"
import {
  parseGwasResult,
  parseProgressDetail,
  passingMarkers,
  s3ObjectKey,
} from "@/features/genotyping/lib/gwasResult"

export function runEnvironment(
  job: JobOutput,
  names:
    | { seasons: Map<string, string>; sites: Map<string, string> }
    | undefined,
): string {
  const p = (job.parameters ?? {}) as { season_id?: unknown; site_id?: unknown }
  const site = p.site_id != null ? names?.sites.get(String(p.site_id)) : null
  const season =
    p.season_id != null ? names?.seasons.get(String(p.season_id)) : null
  if (!site && !season) return "All sites and seasons"
  return [site, season].filter(Boolean).join(" · ")
}

export function GwasManhattanThumb({
  job,
  size = 600,
  className = "h-32",
}: {
  job: JobOutput
  size?: number
  className?: string
}) {
  const status = String(job.status ?? "").toLowerCase()
  const key = s3ObjectKey(parseGwasResult(job)?.artifacts?.manhattan)
  if (status === "completed" && key)
    return (
      <div className={`${className} w-full overflow-hidden bg-white`}>
        <AuthImage
          src={thumbnailSrc(key, size)}
          alt="Manhattan plot"
          className="h-full w-full rounded-none border-0 object-contain"
          lazy
        />
      </div>
    )
  const stage = parseProgressDetail(job)?.stage
  return (
    <div
      className={`${className} bg-muted text-muted-foreground flex w-full flex-col items-center justify-center gap-1 text-xs`}
    >
      {status === "failed" || status === "cancelled" ? (
        <>
          <TriangleAlert className="h-5 w-5 text-red-500" />
          {status === "failed" ? "Failed" : "Cancelled"}
        </>
      ) : status === "running" || status === "pending" ? (
        <>
          <Loader2 className="h-5 w-5 animate-spin" />
          {status === "pending"
            ? "Waiting for a worker"
            : `${typeof stage === "string" ? stage : "Running"} · ${Math.round(job.progress ?? 0)}%`}
        </>
      ) : (
        <BarChart3 className="h-6 w-6 opacity-40" />
      )}
    </div>
  )
}

export function GwasRunTile({
  job,
  studyId,
  traitNames,
}: {
  job: JobOutput
  studyId: string
  traitNames: Map<string, string> | undefined
}) {
  const navigate = useNavigate()
  const result = parseGwasResult(job)
  const expId = (job.parameters as { experiment_id?: unknown } | null)
    ?.experiment_id
  const scope = useExperimentScopeNames(expId != null ? String(expId) : null)
  const traits = jobTraitNames(job, traitNames)
  const passing = passingMarkers(result)
  const done = String(job.status ?? "").toLowerCase() === "completed"
  const top = result?.top_hits?.[0]
  const lambda = result?.genomic_inflation_lambda
  const lines = result?.n_samples_with_phenotype

  return (
    <button
      type="button"
      data-testid="gwas-run-tile"
      onClick={() =>
        navigate({
          to: "/genotyping/$studyId/gwas/$jobId",
          params: { studyId, jobId: idAsString(job.id) },
        })
      }
      className="bg-card hover:border-primary/60 flex flex-col overflow-hidden rounded-lg border text-left transition-all hover:shadow-md"
    >
      <GwasManhattanThumb job={job} />
      <div className="flex flex-1 flex-col gap-1 border-t p-3">
        <div className="flex items-center gap-1.5">
          <p
            className="min-w-0 truncate text-sm font-medium"
            title={traits.join(", ")}
          >
            {traits.join(", ") || "GWAS"}
          </p>
          {(job.parameters as { source?: unknown } | null)?.source ===
            "tassel" && (
            <span
              className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800 dark:bg-sky-900/40 dark:text-sky-300"
              title="Computed in TASSEL and imported"
            >
              TASSEL
            </span>
          )}
        </div>
        <p className="text-muted-foreground truncate text-xs">
          {runEnvironment(job, scope.data)}
        </p>
        {done && (
          <div className="flex flex-wrap gap-1 pt-1 text-[11px]">
            <span
              className={`rounded px-1.5 py-0.5 font-medium ${
                passing
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {passing
                ? passing === 1
                  ? "1 marker passes"
                  : `${passing} markers pass`
                : "No marker passes"}
            </span>
            {lines != null && (
              <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5">
                {lines} lines
              </span>
            )}
            {lambda != null && (
              <span
                className="bg-muted text-muted-foreground rounded px-1.5 py-0.5"
                title="Genomic inflation: near 1 means the p-values are well calibrated"
              >
                λ {lambda.toFixed(2)}
              </span>
            )}
          </div>
        )}
        {done && top && passing ? (
          <p className="text-muted-foreground truncate text-[11px]">
            Strongest: chr {top.chr ?? "?"}
            {top.pos != null ? ` · ${(top.pos / 1e6).toFixed(2)} Mb` : ""} · p ={" "}
            {top.p.toExponential(1)}
          </p>
        ) : null}
      </div>
    </button>
  )
}
