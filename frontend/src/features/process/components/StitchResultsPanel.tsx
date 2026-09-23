/**
 * StitchResultsPanel — the stitching step's output: each AgRowStitch_v{N}
 * version's per-plot mosaics, which plots failed and why (from the
 * worker's stitch_manifest.json), and downloads.
 */
import { useQuery } from "@tanstack/react-query"
import { Download } from "lucide-react"
import { useMemo, useState } from "react"

import type { FileMetadata } from "@/client"
import { authHeaders } from "@/components/Common/PlotImage"
import { Button } from "@/components/ui/button"
import {
  apiUrl,
  DEFAULT_BUCKET,
  downloadViaBrowser,
  downloadZip,
} from "@/features/files/lib/download"
import { AuthImage } from "@/features/genotyping/components/AuthImage"
import { stitchVersions } from "@/features/process/lib/groundTrack"
import type { AerialScope } from "@/features/process/lib/paths"

interface Manifest {
  plot_count?: number
  succeeded_plots?: string[]
  failed_plots?: Record<string, string>
}

export function StitchResultsPanel({
  files,
  scope,
}: {
  files: FileMetadata[]
  scope: AerialScope | null
}) {
  const versions = useMemo(
    () => (scope ? stitchVersions(files, scope) : []),
    [files, scope],
  )
  const [picked, setPicked] = useState<number | null>(null)
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
          className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-800 text-xs"
          data-testid="stitch-failed"
        >
          {failed.map(([id, why]) => (
            <p key={id}>
              <strong>Plot {id} failed:</strong> {why.split("\n")[0]}
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {v.plotImages.map((p) => (
          <figure key={p.path} className="space-y-1" data-testid="stitch-plot">
            <AuthImage
              src={`/api/files/download/${DEFAULT_BUCKET}/${p.path}`}
              alt={`Stitched plot ${p.plotId}`}
              className="max-h-40 w-full rounded border bg-black object-contain"
              onImageClick={(url) => window.open(url, "_blank")}
            />
            <figcaption className="text-muted-foreground text-xs">
              Plot {p.plotId}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  )
}
