/**
 * StitchResultsPanel — the stitching step's output: each AgRowStitch_v{N}
 * version's per-plot mosaics, which plots failed and why (from the
 * worker's stitch_manifest.json), and downloads.
 */
import { useQuery } from "@tanstack/react-query"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  RotateCcw,
} from "lucide-react"
import { useMemo, useState } from "react"

import type { FileMetadata } from "@/client"
import { authHeaders } from "@/components/Common/PlotImage"
import { Button } from "@/components/ui/button"
import { ImageLightbox } from "@/features/files/components/ImageLightbox"
import {
  apiUrl,
  DEFAULT_BUCKET,
  downloadViaBrowser,
  downloadZip,
} from "@/features/files/lib/download"
import {
  AuthImage,
  thumbnailSrc,
} from "@/features/genotyping/components/AuthImage"
import { stitchVersions } from "@/features/process/lib/groundTrack"
import type { AerialScope } from "@/features/process/lib/paths"
import {
  adviseRestitch,
  STITCH_DEFAULTS,
  type StitchKnob,
} from "@/features/process/lib/stitchAdvice"

/** Stitched plots shown at once; the rest page through. */
const PER_PAGE = 12

interface Manifest {
  plot_count?: number
  succeeded_plots?: string[]
  failed_plots?: Record<string, string>
  /** The settings this version was stitched with. */
  config?: Record<string, unknown>
}

export function StitchResultsPanel({
  files,
  scope,
  onRestitch,
  restitching = false,
}: {
  files: FileMetadata[]
  scope: AerialScope | null
  /** Re-stitch these plots with these setting overrides (a new version). */
  onRestitch?: (plotIds: number[], settings: Record<string, number>) => void
  restitching?: boolean
}) {
  const versions = useMemo(
    () => (scope ? stitchVersions(files, scope) : []),
    [files, scope],
  )
  const [picked, setPicked] = useState<number | null>(null)
  // Collapsed by default: a field's worth of mosaics is a long scroll, and
  // the summary, failures and re-stitch above are what a finished step needs.
  const [showPlots, setShowPlots] = useState(false)
  const [page, setPage] = useState(0)
  const [viewing, setViewing] = useState<number | null>(null)
  const v = versions.find((x) => x.version === picked) ?? versions[0]

  const manifest = useQuery<Manifest | null>({
    queryKey: ["stitch-manifest", v?.manifest],
    queryFn: async () => {
      const res = await fetch(
        apiUrl(`/api/files/download/${DEFAULT_BUCKET}/${v?.manifest}`),
        { headers: authHeaders() },
      )
      return res.ok ? ((await res.json()) as Manifest) : null
    },
    enabled: Boolean(v?.manifest),
    staleTime: Number.POSITIVE_INFINITY,
  })

  if (!v) return null
  const pages = Math.ceil(v.plotImages.length / PER_PAGE)
  const shownPlots = v.plotImages.slice(page * PER_PAGE, (page + 1) * PER_PAGE)
  const failed = Object.entries(manifest.data?.failed_plots ?? {})

  return (
    <div className="space-y-2" data-testid="stitch-results">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {versions.length > 1 ? (
          <select
            aria-label="Stitch version"
            className="border-input bg-background rounded border px-1.5 py-1"
            value={v.version}
            onChange={(e) => setPicked(Number(e.target.value))}
          >
            {versions.map((x) => (
              <option key={x.version} value={x.version}>
                Stitch v{x.version}
              </option>
            ))}
          </select>
        ) : (
          <span className="font-medium">Stitch v{v.version}</span>
        )}
        <span className="text-muted-foreground" data-testid="stitch-summary">
          {v.plotImages.length} plot mosaic
          {v.plotImages.length === 1 ? "" : "s"}
          {manifest.data?.plot_count != null &&
            ` of ${manifest.data.plot_count} marked`}
          {v.combinedMosaic ? " · georeferenced" : ""}
        </span>
        <div className="ml-auto flex gap-1">
          {v.combinedMosaic && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() =>
                void downloadViaBrowser(v.combinedMosaic as string)
              }
            >
              <Download className="mr-1 h-3 w-3" /> Combined mosaic
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() =>
              void downloadZip({
                prefix: v.prefix,
                filename: `AgRowStitch_v${v.version}`,
              })
            }
          >
            <Download className="mr-1 h-3 w-3" /> All (ZIP)
          </Button>
        </div>
      </div>

      {failed.length > 0 && (
        <div
          className="rounded border border-amber-400/60 bg-amber-500/10 px-2 py-1.5 text-amber-800 text-xs dark:text-amber-300"
          data-testid="stitch-failed"
        >
          {failed.map(([id, why]) => (
            <p key={id}>
              <strong>Plot {id} failed:</strong> {why.split("\n")[0]}
            </p>
          ))}
          {onRestitch && (
            <RestitchBox
              key={`${v.version}:${failed.map(([id]) => id).join(",")}`}
              failed={failed}
              config={manifest.data?.config ?? {}}
              version={v.version}
              busy={restitching}
              onRestitch={onRestitch}
            />
          )}
        </div>
      )}

      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() => setShowPlots((x) => !x)}
        aria-expanded={showPlots}
        data-testid="stitch-toggle-plots"
      >
        {showPlots ? (
          <ChevronDown className="mr-1 h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="mr-1 h-3.5 w-3.5" />
        )}
        {showPlots
          ? "Hide stitched plots"
          : `Show ${v.plotImages.length} stitched plot${v.plotImages.length === 1 ? "" : "s"}`}
      </Button>
      {showPlots && (
        <div className="space-y-2">
          {pages > 1 && (
            <div className="flex items-center gap-2 text-xs">
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-7 p-0"
                disabled={page === 0}
                onClick={() => setPage((n) => n - 1)}
                aria-label="Previous plots"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-muted-foreground">
                Plots {page * PER_PAGE + 1}–
                {Math.min((page + 1) * PER_PAGE, v.plotImages.length)} of{" "}
                {v.plotImages.length}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 w-7 p-0"
                disabled={page >= pages - 1}
                onClick={() => setPage((n) => n + 1)}
                aria-label="Next plots"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {shownPlots.map((p) => (
              <figure
                key={p.path}
                className="space-y-1"
                data-testid="stitch-plot"
              >
                {/* A small server-made preview; the full mosaic opens in the
                    viewer on click. */}
                <AuthImage
                  src={thumbnailSrc(p.path, 800)}
                  alt={`Stitched plot ${p.plotId}`}
                  className="max-h-40 w-full rounded border bg-black object-contain"
                  onImageClick={() =>
                    setViewing(v.plotImages.findIndex((x) => x.path === p.path))
                  }
                  lazy
                />
                <figcaption className="text-muted-foreground text-xs">
                  Plot {p.plotId}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
      <ImageLightbox
        images={v.plotImages.map((p) => p.path)}
        index={viewing}
        onIndex={(i) => {
          setViewing(i)
          setPage(Math.floor(i / PER_PAGE))
        }}
        onClose={() => setViewing(null)}
        caption={(name) => {
          const p = v.plotImages.find((x) => x.path === name)
          return p ? `Stitch v${v.version} · plot ${p.plotId}` : null
        }}
      />
    </div>
  )
}

const KNOB_LABEL: Record<StitchKnob, string> = {
  forward_limit: "Forward limit",
  min_inliers: "Minimum inliers",
  max_reprojection_error: "Max reprojection error",
  batch_size: "Batch size",
}

/**
 * Re-stitch only the plots that failed, with a suggested settings change
 * (lib/stitchAdvice) the person can adjust. Writes a new version holding
 * just these plots; the earlier version keeps the rest.
 */
function RestitchBox({
  failed,
  config,
  version,
  busy,
  onRestitch,
}: {
  failed: [string, string][]
  config: Record<string, unknown>
  version: number
  busy: boolean
  onRestitch: (plotIds: number[], settings: Record<string, number>) => void
}) {
  const advice = adviseRestitch(
    failed.map(([, why]) => why),
    config,
  )
  const used = (k: StitchKnob) =>
    typeof config[k] === "number" ? (config[k] as number) : STITCH_DEFAULTS[k]
  const [values, setValues] = useState<Record<StitchKnob, number>>(() => ({
    forward_limit: advice.settings.forward_limit ?? used("forward_limit"),
    min_inliers: advice.settings.min_inliers ?? used("min_inliers"),
    max_reprojection_error:
      advice.settings.max_reprojection_error ?? used("max_reprojection_error"),
    batch_size: advice.settings.batch_size ?? used("batch_size"),
  }))
  const ids = failed.map(([id]) => Number(id)).filter((n) => Number.isFinite(n))
  const changed = (Object.keys(values) as StitchKnob[]).filter(
    (k) => values[k] !== used(k),
  )
  return (
    <div
      className="mt-2 space-y-2 border-amber-400/40 border-t pt-2 text-foreground"
      data-testid="stitch-restitch"
    >
      <p>
        <strong>Likely cause:</strong> {advice.cause}
      </p>
      <p>
        <strong>Suggested:</strong> {advice.advice}
        {advice.thenTry.length > 0 && (
          <span className="text-muted-foreground">
            {" "}
            If that does not fix it: {advice.thenTry.join("; ")}.
          </span>
        )}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        {(Object.keys(values) as StitchKnob[]).map((k) => (
          <label key={k} className="flex flex-col gap-0.5">
            <span className="text-muted-foreground">
              {KNOB_LABEL[k]}{" "}
              <span className="opacity-70">
                (v{version}: {used(k)})
              </span>
            </span>
            <input
              type="number"
              step={k === "max_reprojection_error" ? 0.5 : 1}
              min={k === "max_reprojection_error" ? 0.1 : 1}
              value={values[k]}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [k]: Number(e.target.value) }))
              }
              className={`h-7 w-24 rounded border bg-background px-2 ${
                values[k] !== used(k) ? "border-primary" : ""
              }`}
              data-testid={`restitch-${k}`}
            />
          </label>
        ))}
        <Button
          size="sm"
          className="h-7"
          disabled={busy || ids.length === 0}
          onClick={() =>
            onRestitch(
              ids,
              Object.fromEntries(changed.map((k) => [k, values[k]])),
            )
          }
          data-testid="restitch-submit"
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          {busy
            ? "Starting…"
            : `Re-stitch ${ids.length} failed plot${ids.length === 1 ? "" : "s"}`}
        </Button>
      </div>
      <p className="text-muted-foreground">
        Makes a new version with only{" "}
        {ids.length === 1 ? "this plot" : "these plots"}
        {changed.length
          ? `, changing ${changed.map((k) => KNOB_LABEL[k].toLowerCase()).join(", ")}`
          : " with the same settings"}
        . v{version} keeps every other plot.
      </p>
    </div>
  )
}
