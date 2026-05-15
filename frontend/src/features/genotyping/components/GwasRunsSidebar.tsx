/**
 * Sidebar for the GWAS detail page. Lists every RUN_GWAS job in the
 * current study so the user can click between runs without going back
 * to the study page. Active run is highlighted; status badges show at-
 * a-glance state. Runs are sorted newest-first.
 */
import { Link } from "@tanstack/react-router"

import { Badge } from "@/components/ui/badge"
import { idAsString } from "@/features/admin/lib/ids"
import {
  jobTraitNames,
  useStudyGwasJobs,
  useTraitNameMap,
} from "@/features/genotyping/hooks/useGwas"
import { statusVariant } from "@/features/genotyping/lib/gwasResult"
import { cn } from "@/lib/utils"

export interface GwasRunsSidebarProps {
  studyId: string
  currentJobId: string
}

export function GwasRunsSidebar({
  studyId,
  currentJobId,
}: GwasRunsSidebarProps) {
  const jobs = useStudyGwasJobs(studyId)
  const traitNameMap = useTraitNameMap()
  const rows = (jobs.data ?? []).slice().sort((a, b) => {
    // newest-first; created_at can be null while a job is still being
    // initialised — push those to the bottom.
    const ta = a.created_at ? Date.parse(a.created_at) : 0
    const tb = b.created_at ? Date.parse(b.created_at) : 0
    return tb - ta
  })

  return (
    <aside
      data-testid="gwas-runs-sidebar"
      className="w-full shrink-0 space-y-2 md:w-64"
    >
      <h2 className="text-muted-foreground px-1 text-xs font-semibold uppercase tracking-wider">
        Runs in this study
      </h2>
      {rows.length === 0 ? (
        <p
          className="text-muted-foreground px-1 text-xs"
          data-testid="gwas-sidebar-empty"
        >
          {jobs.isLoading ? "Loading…" : "No runs yet."}
        </p>
      ) : (
        <ul className="space-y-1">
          {rows.map((job) => {
            const jobId = idAsString(job.id)
            const isActive = jobId === currentJobId
            const traitNames = jobTraitNames(job, traitNameMap.data)
            const traitLabel = describeTraits(job, traitNames)
            const status = job.status ?? "PENDING"
            return (
              <li key={jobId}>
                <Link
                  to="/genotyping/$studyId/gwas/$jobId"
                  params={{ studyId, jobId }}
                  data-testid={`gwas-sidebar-item-${jobId}`}
                  data-active={isActive ? "true" : "false"}
                  className={cn(
                    "block rounded-md border px-2.5 py-2 text-xs transition-colors",
                    isActive
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50 border-transparent",
                  )}
                >
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <span
                      className={cn(
                        "line-clamp-2 break-all font-medium",
                        isActive && "text-primary",
                      )}
                      title={traitNames.join(", ")}
                    >
                      {traitLabel}
                    </span>
                    <Badge
                      variant={statusVariant(status)}
                      className="shrink-0 text-[10px]"
                    >
                      {status}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground font-mono text-[10px]">
                    {jobId.slice(0, 8)}…
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}

/**
 * Compact label for a run row. For mvLMM-style multi-trait jobs we want
 * "mvLMM · 4 traits" rather than a comma-joined trait list, which is
 * unreadable in a narrow sidebar. Single-trait univariate runs just
 * show the trait name.
 */
function describeTraits(
  job: { parameters?: unknown },
  names: string[],
): string {
  const params = job.parameters as { model?: string } | null | undefined
  const model = params?.model ?? "lmm"
  if (names.length === 0) return "—"
  if (names.length === 1) return names[0]
  if (model === "mvlmm") return `mvLMM · ${names.length} traits`
  return `${names[0]} +${names.length - 1}`
}
