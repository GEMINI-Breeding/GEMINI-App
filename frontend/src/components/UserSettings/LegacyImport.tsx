/**
 * Settings → Data & services → Import from the previous GEMI app.
 *
 * Shows the dry run (GET /api/legacy_import/plan): what the previous
 * desktop app's data becomes here, and what can't be imported and why.
 * Import queues the IMPORT_LEGACY job and follows it. The previous app's
 * data is mounted read-only for this: it is never changed or deleted (D1),
 * and re-running an import only adds what's missing.
 *
 * Superusers only (the import creates experiments for the whole install,
 * and its endpoints are superuser-only). Renders nothing when there's no
 * previous install to import.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { authHeaders } from "@/components/Common/PlotImage"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { apiUrl } from "@/features/files/lib/download"
import useAuth from "@/hooks/useAuth"
import { isManagedStack, stackStatus } from "@/lib/stack"

interface Skipped {
  path: string | null
  data_type: string
  reason: string
}

/** Tiers 2–3: the old app's workspaces, runs and results. */
interface Processing {
  workspaces: number
  pipelines: number
  runs: number
  ortho_versions: number
  boundary_versions: number
  trait_records?: number
  trait_datasets?: number
  plot_markings: number
  stitches: number
  reference_datasets: number
  archive_files: number
  archive_bytes?: number
  notes?: string[]
}

const PLURAL: Record<string, string> = {
  "set of plot traits": "sets of plot traits",
}

/** "2 runs · 1 orthomosaic version · …", leaving out zeros. */
function describeProcessing(p: Processing): string {
  const parts: [number | undefined, string][] = [
    [p.workspaces, "workspace"],
    [p.pipelines, "pipeline"],
    [p.runs, "run"],
    [p.ortho_versions, "orthomosaic version"],
    [p.boundary_versions, "plot boundary version"],
    [p.trait_records ?? p.trait_datasets, "set of plot traits"],
    [p.plot_markings, "plot marking version"],
    [p.stitches, "stitch"],
    [p.reference_datasets, "reference dataset"],
  ]
  return parts
    .filter(([n]) => (n ?? 0) > 0)
    .map(
      ([n, what]) =>
        `${n} ${n === 1 ? what : (PLURAL[what] ?? `${what}${what.endsWith("h") ? "es" : "s"}`)}`,
    )
    .join(" · ")
}

interface LegacyPlan {
  available: boolean
  processing?: Processing
  uploads?: number
  files?: number
  bytes?: number
  experiments?: string[]
  seasons?: string[]
  skipped?: Skipped[]
  already_imported?: number
}

interface ImportResult {
  processing?: Processing
  imported: { path: string; copied: number; already_there: number }[]
  failed: { path: string; error: string }[]
  skipped: Skipped[]
  thermal_uploads: string[]
  cancelled: boolean
}

interface Job {
  id: string
  status: string
  progress: number
  progress_detail?: { stage?: string } | null
  result?: ImportResult | null
  error_message?: string | null
}

async function call<T>(path: string, method = "GET"): Promise<T> {
  const res = await fetch(apiUrl(path), { method, headers: authHeaders() })
  const body = await res.json().catch(() => ({}))
  if (!res.ok)
    throw new Error(
      (body as { error_description?: string; error?: string })
        .error_description ||
        (body as { error?: string }).error ||
        `HTTP ${res.status}`,
    )
  return body as T
}

const gb = (b: number) =>
  b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(1)} MB`
const DONE = new Set(["COMPLETED", "FAILED", "CANCELLED"])

export function LegacyImport() {
  const { user } = useAuth()
  return user?.is_superuser ? <LegacyImportForSuperuser /> : null
}

function LegacyImportForSuperuser() {
  const qc = useQueryClient()
  // Free space where the stack keeps its data: known in the desktop app.
  const stack = useQuery({
    queryKey: ["stack", "status"],
    queryFn: stackStatus,
    enabled: isManagedStack(),
  })
  const freeBytes = stack.data?.free_bytes
  const plan = useQuery({
    queryKey: ["legacy-import", "plan"],
    queryFn: () => call<LegacyPlan>("/api/legacy_import/plan"),
    retry: false,
  })
  const [jobId, setJobId] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  // Pick up an import that's still running (e.g. after leaving the page).
  useEffect(() => {
    void (async () => {
      for (const status of ["RUNNING", "PENDING"]) {
        const jobs = await call<Job[]>(
          `/api/jobs/all?status=${status}&job_type=IMPORT_LEGACY`,
        ).catch(() => [])
        if (jobs[0]) return setJobId(String(jobs[0].id))
      }
    })()
  }, [])

  const job = useQuery({
    queryKey: ["legacy-import", "job", jobId],
    queryFn: () => call<Job>(`/api/jobs/${jobId}`),
    enabled: Boolean(jobId),
    refetchInterval: (q) =>
      q.state.data && DONE.has(q.state.data.status) ? false : 1500,
  })
  const finished = job.data && DONE.has(job.data.status)
  useEffect(() => {
    if (finished) {
      void qc.invalidateQueries({ queryKey: ["legacy-import", "plan"] })
      void qc.invalidateQueries({ queryKey: ["experiments"] })
    }
  }, [finished, qc])

  const p = plan.data
  if (!p?.available) return null
  // Uploads, plus the old Processed/ and Intermediate/ files: those are
  // copied twice (converted into runs, and kept as they were in the archive).
  const needed = (p.bytes ?? 0) + 2 * (p.processing?.archive_bytes ?? 0)
  const tooBig = freeBytes != null && needed > freeBytes
  const running = Boolean(jobId) && !finished
  const all = (p.uploads ?? 0) > 0 && p.already_imported === p.uploads

  const start = async () => {
    setStartError(null)
    try {
      const r = await call<{ job_id: string }>(
        "/api/legacy_import/start",
        "POST",
      )
      setJobId(r.job_id)
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <section
      className="mt-8 flex max-w-2xl flex-col gap-3"
      data-testid="legacy-import"
    >
      <h2 className="text-lg font-medium">Data from the previous GEMI app</h2>
      <p className="text-muted-foreground text-sm">
        Your uploads from the previous version of GEMI can be copied in here.
        The previous app's data is only read: it is never changed or deleted, so
        it stays there as a backup.
      </p>

      <dl
        className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm"
        data-testid="legacy-import-plan"
      >
        <dt className="text-muted-foreground">Uploads</dt>
        <dd>
          {p.uploads} ({p.files} files, {gb(p.bytes ?? 0)})
          {p.already_imported
            ? ` · ${p.already_imported} already imported`
            : ""}
        </dd>
        <dt className="text-muted-foreground">Experiments</dt>
        <dd>{p.experiments?.join(", ") || "—"}</dd>
        <dt className="text-muted-foreground">Seasons</dt>
        <dd>{p.seasons?.join(", ") || "—"}</dd>
        {p.processing && describeProcessing(p.processing) && (
          <>
            <dt className="text-muted-foreground">Processing</dt>
            <dd>{describeProcessing(p.processing)}</dd>
          </>
        )}
        {(p.processing?.archive_files ?? 0) > 0 && (
          <>
            <dt className="text-muted-foreground">Other files</dt>
            <dd>
              {p.processing?.archive_files} (
              {gb(p.processing?.archive_bytes ?? 0)}), kept as they were under
              Imported/GEMI
            </dd>
          </>
        )}
      </dl>
      {p.processing?.notes?.map((n) => (
        <p key={n} className="text-muted-foreground text-xs">
          {n}
        </p>
      ))}

      {(p.skipped?.length ?? 0) > 0 && (
        <div className="text-sm" data-testid="legacy-import-skipped">
          <p className="text-muted-foreground">Can't be imported:</p>
          <ul className="ml-4 list-disc">
            {p.skipped?.map((s) => (
              <li key={`${s.path}-${s.reason}`}>
                <span className="font-mono text-xs">
                  {s.path ?? s.data_type}
                </span>
                : {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tooBig && (
        <p className="text-destructive text-sm">
          Not enough free space: this needs {gb(needed)} and the data folder's
          drive has {gb(freeBytes ?? 0)}. Move GEMI's data to a larger drive
          (above) first.
        </p>
      )}

      {!running && (
        <Button
          className="w-fit"
          disabled={tooBig || all}
          onClick={() => void start()}
          data-testid="legacy-import-start"
        >
          {all
            ? "Everything is imported"
            : p.already_imported
              ? "Import the rest"
              : "Import"}
        </Button>
      )}
      {startError && <p className="text-destructive text-sm">{startError}</p>}

      {running && (
        <div className="space-y-1" data-testid="legacy-import-progress">
          <Progress value={job.data?.progress ?? 0} />
          <p className="text-muted-foreground text-xs">
            {job.data?.progress_detail?.stage ?? "Starting…"}
          </p>
        </div>
      )}

      {finished && job.data && (
        <ImportOutcome job={job.data} onDismiss={() => setJobId(null)} />
      )}
    </section>
  )
}

function ImportOutcome({
  job,
  onDismiss,
}: {
  job: Job
  onDismiss: () => void
}) {
  const r = job.result
  if (job.status === "FAILED" || !r)
    return (
      <div className="text-sm" data-testid="legacy-import-result">
        <p className="text-destructive">
          The import failed: {job.error_message ?? "unknown error"}. Nothing in
          the previous app's data was changed; try again once it's fixed.
        </p>
        <Button variant="outline" className="mt-2" onClick={onDismiss}>
          OK
        </Button>
      </div>
    )
  const copied = r.imported.reduce((n, u) => n + u.copied, 0)
  return (
    <div className="space-y-2 text-sm" data-testid="legacy-import-result">
      <p>
        Imported {r.imported.length} upload
        {r.imported.length === 1 ? "" : "s"} ({copied} file
        {copied === 1 ? "" : "s"} copied)
        {r.cancelled ? " before it was cancelled" : ""}. Find them under Files →
        Manage Data.
      </p>
      {r.processing && describeProcessing(r.processing) && (
        <p data-testid="legacy-import-processing">
          Also imported: {describeProcessing(r.processing)}. The workspaces and
          runs are under Process.
        </p>
      )}
      {r.failed.length > 0 && (
        <div>
          <p className="text-destructive">Couldn't import:</p>
          <ul className="ml-4 list-disc">
            {r.failed.map((f) => (
              <li key={f.path}>
                <span className="font-mono text-xs">{f.path}</span>: {f.error}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Importing again retries these and skips what's already here.
          </p>
        </div>
      )}
      {r.thermal_uploads.length > 0 && (
        <p className="text-muted-foreground">
          Thermal images were copied as they are; run thermal extraction on them
          from a new run to get temperatures.
        </p>
      )}
      <Button variant="outline" onClick={onDismiss}>
        OK
      </Button>
    </div>
  )
}
