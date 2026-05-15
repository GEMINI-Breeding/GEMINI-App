/**
 * GWAS job detail page. Polls the job until terminal, then renders:
 *  - Status card (badge, stage, progress, cancel button while running)
 *  - Error banner (when FAILED)
 *  - Summary stats grid (when COMPLETED)
 *  - Manhattan + QQ plots via AuthImage (when COMPLETED, non-BSLMM)
 *  - Top hits table
 *  - Artifact download links
 *  - Raw parameters block
 */
import { Link, useNavigate } from "@tanstack/react-router"
import { ArrowLeft, Download, Trash2, XCircle } from "lucide-react"

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
import {
  AuthImage,
  downloadAuthed,
} from "@/features/genotyping/components/AuthImage"
import { GwasRunsSidebar } from "@/features/genotyping/components/GwasRunsSidebar"
import { PcaPlot } from "@/features/genotyping/components/PcaPlot"
import {
  jobTraitNames,
  useDeleteGwasJob,
  useGwasJob,
  useTraitNameMap,
} from "@/features/genotyping/hooks/useGwas"
import {
  parseGwasResult,
  parseProgressDetail,
  s3UrlToDownload,
  statusVariant,
} from "@/features/genotyping/lib/gwasResult"
import useCustomToast from "@/hooks/useCustomToast"

export interface GwasJobDetailProps {
  studyId: string
  jobId: string
}

export function GwasJobDetail({ studyId, jobId }: GwasJobDetailProps) {
  const jobQuery = useGwasJob(jobId)
  const cancel = useCancelJob()
  const deleteJob = useDeleteGwasJob()
  const traitNameMap = useTraitNameMap()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const job = jobQuery.data

  async function handleDownload(url: string, filename: string) {
    try {
      await downloadAuthed(url, filename)
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : "Download failed",
      )
    }
  }

  if (jobQuery.isLoading) {
    return (
      <div className="container max-w-6xl px-4 py-6">
        <p className="text-muted-foreground animate-pulse">Loading…</p>
      </div>
    )
  }
  if (!job) {
    return (
      <div className="container max-w-6xl px-4 py-6">
        <p className="text-sm text-red-600" data-testid="gwas-job-error">
          {jobQuery.error?.message ?? "Job not found."}
        </p>
      </div>
    )
  }

  const result = parseGwasResult(job)
  const progressDetail = parseProgressDetail(job)
  const statusLower = String(job.status ?? "").toLowerCase()
  const canCancel = statusLower === "pending" || statusLower === "running"
  // Workers report `progress` in percent (0-100), matching the
  // convention in geo/odm/amiga/ml workers. We render it directly.
  const progressPct = Math.round(job.progress ?? 0)
  const stage = progressDetail?.stage as string | undefined

  const manhattanSrc = s3UrlToDownload(result?.artifacts?.manhattan)
  const qqSrc = s3UrlToDownload(result?.artifacts?.qq)
  const assocSrc = s3UrlToDownload(result?.artifacts?.assoc)
  const pcaSrc = s3UrlToDownload(result?.artifacts?.pca_eigenvec)
  const kinshipHeatmapSrc = s3UrlToDownload(
    result?.artifacts?.kinship_heatmap,
  )

  // Trait label for the page header. Pre-completion the only source is
  // job.parameters; post-completion `result.trait_ids` carries the
  // same set. jobTraitNames handles both shapes.
  const traitNames = jobTraitNames(job, traitNameMap.data)
  const traitLabel = traitNames.length > 0 ? traitNames.join(", ") : null

  return (
    <div className="container max-w-[1600px] space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <Link
          to="/genotyping/$studyId"
          params={{ studyId }}
          search={{ tab: "gwas" }}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to study
        </Link>
        <div className="flex items-center gap-2">
          {assocSrc && statusLower === "completed" && (
            <Button
              variant="default"
              size="sm"
              data-testid="gwas-download-sumstats"
              onClick={() =>
                handleDownload(assocSrc, `gwas-${jobId}-sumstats.assoc.txt`)
              }
            >
              <Download className="mr-2 h-4 w-4" /> Download sumstats
            </Button>
          )}
          {canCancel && (
            <Button
              variant="destructive"
              size="sm"
              data-testid="gwas-cancel"
              onClick={() => cancel.mutate(jobId)}
              disabled={cancel.isPending}
            >
              <XCircle className="mr-2 h-4 w-4" /> Cancel
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            data-testid="gwas-delete"
            disabled={deleteJob.isPending}
            onClick={async () => {
              const label = traitLabel ?? `Job ${jobId.slice(0, 8)}…`
              const ok = await confirm({
                title: "Delete GWAS run?",
                description: canCancel
                  ? `This will cancel the in-progress run for "${label}" and permanently delete its job record + all MinIO artifacts (Manhattan, QQ, kinship, sumstats, etc). This cannot be undone.`
                  : `This permanently deletes the run for "${label}" and all its MinIO artifacts. This cannot be undone.`,
                confirmLabel: canCancel ? "Cancel and delete" : "Delete",
                variant: "destructive",
                action: async () => {
                  if (canCancel) {
                    try {
                      await cancel.mutateAsync(jobId)
                    } catch {
                      // Worker may have raced ahead to terminal between
                      // the click and the cancel call; fall through.
                    }
                  }
                  await deleteJob.mutateAsync(jobId)
                },
              })
              if (ok) {
                showSuccessToast("GWAS run deleted")
                // Back to the study's GWAS tab — the row's already
                // gone from Recent Runs via the invalidate.
                navigate({
                  to: "/genotyping/$studyId",
                  params: { studyId },
                  search: { tab: "gwas" },
                })
              } else if (deleteJob.error) {
                showErrorToast(
                  deleteJob.error.message ?? "Failed to delete GWAS run",
                )
              }
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <GwasRunsSidebar studyId={studyId} currentJobId={jobId} />
        <div className="flex-1 space-y-4 min-w-0">
        <div>
          <h1 className="text-2xl font-semibold">
            GWAS — {result?.study_name ?? job.job_type}
          </h1>
          <p className="text-muted-foreground text-xs">
            {traitLabel ? `${traitLabel} · ` : ""}Job {jobId}
          </p>
        </div>

      {/* Status + progress */}
      <section
        data-testid="gwas-status-card"
        className="rounded-md border p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant(job.status)}>
              {job.status ?? "—"}
            </Badge>
            {/* Only show the in-flight stage label while the job is
                still running — once it terminates the badge already
                conveys outcome, and the last-seen stage ("upload")
                would read like the job is still working. */}
            {stage && (statusLower === "pending" || statusLower === "running") && (
              <span className="text-muted-foreground text-sm">· {stage}</span>
            )}
          </div>
          <span className="text-muted-foreground text-sm">{progressPct}%</span>
        </div>
        <div className="bg-muted h-2 w-full overflow-hidden rounded">
          <div
            className="bg-primary h-full transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {progressDetail && Object.keys(progressDetail).length > 1 && (
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
            {Object.entries(progressDetail).map(([k, v]) =>
              k === "stage" ? null : (
                <div key={k}>
                  <span className="text-muted-foreground">{k}:</span>{" "}
                  <span className="font-mono">
                    {typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </span>
                </div>
              ),
            )}
          </div>
        )}
      </section>

      {job.error_message && (
        <section
          className="border-destructive bg-destructive/10 rounded-md border p-4"
          data-testid="gwas-error"
        >
          <h3 className="text-destructive mb-1 text-sm font-semibold">Error</h3>
          <pre className="whitespace-pre-wrap text-xs">{job.error_message}</pre>
        </section>
      )}

      {statusLower === "completed" && result && (
        <>
          <section
            data-testid="gwas-result-summary"
            className="rounded-md border p-4"
          >
            <h3 className="text-muted-foreground mb-3 text-sm font-semibold uppercase tracking-wider">
              Summary
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <Stat label="Model" value={result.model ?? "—"} />
              <Stat label="Test" value={result.lmm_test ?? "—"} />
              <Stat
                label="Variants (in → QC)"
                value={`${result.n_variants_input ?? "?"} → ${result.n_variants_passed_qc ?? "?"}`}
              />
              <Stat
                label="Samples (in → QC)"
                value={`${result.n_samples_input ?? "?"} → ${result.n_samples_passed_qc ?? "?"}`}
              />
              <Stat label="PCs used" value={String(result.n_pcs_used ?? 0)} />
              <Stat
                label="Genomic inflation λ"
                value={result.genomic_inflation_lambda?.toFixed(3) ?? "—"}
              />
              <Stat
                label="Genome-wide hits (p<5e-8)"
                value={String(result.n_genome_wide_sig ?? 0)}
              />
              <Stat
                label="Suggestive (p<1e-5)"
                value={String(result.n_suggestive ?? 0)}
              />
            </div>
          </section>

          {(manhattanSrc || qqSrc) && (
            <section className="rounded-md border p-4">
              <h3 className="text-muted-foreground mb-3 text-sm font-semibold uppercase tracking-wider">
                Plots
              </h3>
              <div className="space-y-6">
                {manhattanSrc && (
                  <div>
                    <p className="text-muted-foreground mb-2 text-xs">
                      Manhattan{" "}
                      <span className="text-muted-foreground/70">
                        (click image to open full-size in a new tab)
                      </span>
                    </p>
                    {/* Fit the Manhattan PNG to the content column width.
                        overflow-x-auto stays as a safety net for very
                        narrow viewports; with the wider container the
                        plot typically renders without horizontal scroll. */}
                    <div className="overflow-x-auto rounded border bg-white">
                      <AuthImage
                        data-testid="gwas-manhattan-img"
                        src={manhattanSrc}
                        alt="Manhattan plot"
                        className="block h-auto w-full"
                        onImageClick={(url) => window.open(url, "_blank")}
                      />
                    </div>
                  </div>
                )}
                {qqSrc && (
                  <div>
                    <p className="text-muted-foreground mb-2 text-xs">
                      QQ{" "}
                      <span className="text-muted-foreground/70">
                        (click image to open full-size in a new tab)
                      </span>
                    </p>
                    {/* QQ stays compact — square plot, max 480 px. */}
                    <div className="rounded border bg-white">
                      <AuthImage
                        data-testid="gwas-qq-img"
                        src={qqSrc}
                        alt="QQ plot"
                        className="block max-w-[480px] w-full"
                        onImageClick={(url) => window.open(url, "_blank")}
                      />
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {pcaSrc && (
            <section
              className="rounded-md border p-4"
              data-testid="gwas-pca-section"
            >
              <h3 className="text-muted-foreground mb-3 text-sm font-semibold uppercase tracking-wider">
                Population structure (PCA)
              </h3>
              <p className="text-muted-foreground mb-3 text-xs">
                PC1 vs PC2 of the QC'd genotype matrix. Hover any point
                to see the accession name. Clusters indicate subpopulation
                structure — useful for sanity-checking the n_pcs
                covariates the model was given.
              </p>
              <PcaPlot src={pcaSrc} />
            </section>
          )}

          {kinshipHeatmapSrc && (
            <section
              className="rounded-md border p-4"
              data-testid="gwas-kinship-section"
            >
              <h3 className="text-muted-foreground mb-3 text-sm font-semibold uppercase tracking-wider">
                Kinship
              </h3>
              <p className="text-muted-foreground mb-3 text-xs">
                Centered relatedness matrix (GEMMA -gk 1), hierarchically
                clustered so related samples form visible blocks.
                Diagonal is each sample's relatedness with itself; the
                colour scale is symmetric around zero (red = related,
                blue = anti-related). Click the image to open full-size.
              </p>
              <div className="rounded border bg-white">
                <AuthImage
                  data-testid="gwas-kinship-img"
                  src={kinshipHeatmapSrc}
                  alt="Kinship heatmap"
                  className="block max-w-[700px] w-full"
                  onImageClick={(url) => window.open(url, "_blank")}
                />
              </div>
            </section>
          )}

          {result.top_hits && result.top_hits.length > 0 && (
            <section className="rounded-md border p-4">
              <h3 className="text-muted-foreground mb-3 text-sm font-semibold uppercase tracking-wider">
                Top hits
              </h3>
              <div className="overflow-x-auto">
                <Table data-testid="gwas-top-hits-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Variant</TableHead>
                      <TableHead>Chr</TableHead>
                      <TableHead>Pos</TableHead>
                      <TableHead>p ({result.p_column ?? "wald"})</TableHead>
                      <TableHead>β</TableHead>
                      <TableHead>SE</TableHead>
                      <TableHead>AF</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.top_hits.map((hit) => (
                      <TableRow key={hit.rs}>
                        <TableCell className="font-mono">{hit.rs}</TableCell>
                        <TableCell>{hit.chr ?? "—"}</TableCell>
                        <TableCell>{hit.pos ?? "—"}</TableCell>
                        <TableCell className="font-mono">
                          {hit.p.toExponential(2)}
                        </TableCell>
                        <TableCell>{hit.beta?.toFixed(3) ?? "—"}</TableCell>
                        <TableCell>{hit.se?.toFixed(3) ?? "—"}</TableCell>
                        <TableCell>{hit.af?.toFixed(3) ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}

          {result.artifacts && (
            <section className="rounded-md border p-4" data-testid="gwas-artifacts">
              <h3 className="text-muted-foreground mb-3 text-sm font-semibold uppercase tracking-wider">
                Artifacts
              </h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(result.artifacts).map(([name, url]) => {
                  const href = s3UrlToDownload(url)
                  if (!href) return null
                  // Filename derived from the s3:// path's last segment.
                  // Falls back to the artifact key (manhattan, qq, etc.).
                  const filename =
                    (typeof url === "string"
                      ? url.split("/").pop()
                      : null) || name
                  return (
                    <button
                      key={name}
                      type="button"
                      data-testid={`gwas-artifact-${name}`}
                      onClick={() => handleDownload(href, filename)}
                      className="hover:bg-muted inline-flex items-center gap-1 rounded border px-2 py-1 text-xs"
                    >
                      <Download className="h-3 w-3" />
                      {name}
                    </button>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}

      {job.parameters && (
        <section className="rounded-md border p-4">
          <h3 className="text-muted-foreground mb-2 text-sm font-semibold uppercase tracking-wider">
            Parameters
          </h3>
          <pre className="whitespace-pre-wrap font-mono text-xs">
            {JSON.stringify(job.parameters, null, 2)}
          </pre>
        </section>
      )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  )
}
