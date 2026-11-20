/**
 * The ground pipeline's plot images, from one of three sources:
 *  - the stitched plots, each matched to its plot boundary (AssociationPanel);
 *  - the raw frames: each marked plot's own frames between its start and
 *    end, the ones that do not overlap kept for counting (GROUND_PLOT_FRAMES).
 *    No stitch needed. Plots are named from the drone boundaries they were
 *    marked from, else by their GPS inside the plot boundaries, else from a
 *    field design paired in marking order (for a pass with no GPS);
 *  - photos, one per plot (handheld, no GPS): each photo paired with a plot
 *    of the field design, by a column naming it or in file-name order, shown
 *    before anything is made (the same job, one frame per plot).
 */
import { useQuery } from "@tanstack/react-query"
import { Camera, Images, Layers, Loader2 } from "lucide-react"
import { useMemo, useState } from "react"

import { type FileMetadata, FilesService } from "@/client"
import { Button } from "@/components/ui/button"
import { DEFAULT_BUCKET } from "@/features/files/lib/download"
import { AssociationPanel } from "@/features/process/components/AssociationPanel"
import { PlotImageGrid } from "@/features/process/components/PlotImageGrid"
import { parseCSV } from "@/features/process/lib/csv"
import { readGroundFrames } from "@/features/process/lib/groundFrames"
import {
  type AerialScope,
  plotFramesPrefix,
} from "@/features/process/lib/paths"
import { type PhotoPair, pairPhotos } from "@/features/process/lib/photoPairing"
import { isLoggedIn } from "@/lib/auth"

type Source = "stitched" | "frames" | "photos"

const PHOTO_EXT = /\.(jpe?g|png|tiff?)$/i

/** The design value shown for a row: its plot and accession, when named. */
function rowLabel(row: Record<string, unknown>): string {
  const get = (...keys: string[]) => {
    const k = Object.keys(row).find((c) =>
      keys.includes(c.trim().toLowerCase()),
    )
    return k ? String(row[k] ?? "") : ""
  }
  const plot = get("plot", "plot_number", "plot_id", "plot number")
  const acc = get("accession", "genotype", "entry", "line", "variety")
  return [plot && `plot ${plot}`, acc].filter(Boolean).join(" · ") || "—"
}

function DesignPicker({
  design,
  onPick,
  label,
}: {
  design: { name: string; rows: Record<string, unknown>[] } | null
  onPick: (d: { name: string; rows: Record<string, unknown>[] } | null) => void
  label: string
}) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <label className="flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1">
        <input
          type="file"
          accept=".csv,.txt"
          className="hidden"
          data-testid="ground-design-file"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ""
            if (!f) return
            const { rows } = parseCSV(await f.text())
            onPick({ name: f.name, rows })
          }}
        />
        {design ? `Field design: ${design.name}` : label}
      </label>
      {design && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={() => onPick(null)}
        >
          Clear
        </Button>
      )}
    </span>
  )
}

export function GroundPlotImagesPanel({
  files,
  scope,
  batchLabel,
  photosPrefix,
  running,
  onRunStitched,
  onRunFrames,
  onRunPhotos,
}: {
  /** The run's processed files (for the stitched source). */
  files: FileMetadata[]
  scope: AerialScope | null
  batchLabel?: string | null
  /** The run's uploaded photos (Images/ of its upload). */
  photosPrefix: string | null
  running: boolean
  /** Match the stitched plots to their boundaries. */
  onRunStitched: () => void
  /** Make plot images from the raw frames, with a design paired in order. */
  onRunFrames: (design?: Record<string, unknown>[]) => void
  /** File each photo under its plot (photos with no GPS, one per plot). */
  onRunPhotos: (pairs: PhotoPair[]) => void
}) {
  const framesPrefix = scope ? plotFramesPrefix(scope, batchLabel) : ""
  const manifest = useQuery({
    queryKey: ["ground-frames", framesPrefix, running],
    queryFn: () => readGroundFrames(`${framesPrefix}manifest.json`),
    enabled: isLoggedIn() && Boolean(framesPrefix),
  })
  const [source, setSource] = useState<Source | null>(null)
  const src: Source = source ?? (manifest.data ? "frames" : "stitched")
  const images = useQuery<FileMetadata[]>({
    queryKey: ["files", "list", `${framesPrefix}straightened/`, running],
    queryFn: async () =>
      ((await FilesService.apiFilesListFilePathListFiles({
        filePath: `${DEFAULT_BUCKET}/${framesPrefix}straightened/`,
      })) as FileMetadata[] | null) ?? [],
    enabled: isLoggedIn() && src !== "stitched" && Boolean(manifest.data),
  })
  const photos = useQuery<string[]>({
    queryKey: ["files", "list", photosPrefix, "photos"],
    queryFn: async () =>
      (
        ((await FilesService.apiFilesListFilePathListFiles({
          filePath: `${DEFAULT_BUCKET}/${photosPrefix}`,
        })) as FileMetadata[] | null) ?? []
      )
        .map((f) => (f.object_name ?? "").split("/").pop() ?? "")
        .filter((n) => PHOTO_EXT.test(n)),
    enabled: isLoggedIn() && src === "photos" && Boolean(photosPrefix),
  })
  const [design, setDesign] = useState<{
    name: string
    rows: Record<string, unknown>[]
  } | null>(null)
  const pairing = useMemo(
    () => (design && photos.data ? pairPhotos(photos.data, design.rows) : null),
    [design, photos.data],
  )

  const plots = manifest.data?.plots.filter((p) => !p.error) ?? []
  const tiles = plots.reduce((n, p) => n + (p.tiles?.length ?? 0), 0)
  const namedBy = plots.reduce<Record<string, number>>((acc, p) => {
    const k = p.named_by ?? "?"
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {})

  const results = manifest.data && src !== "stitched" && (
    <>
      <p className="text-xs" data-testid="ground-frames-summary">
        {plots.length} plots
        {tiles > plots.length
          ? ` · ${tiles} frames without overlap (a model's counts add up over them)`
          : ""}{" "}
        · named by{" "}
        {Object.entries(namedBy)
          .map(([how, n]) => `${how} (${n})`)
          .join(", ")}
      </p>
      <PlotImageGrid
        files={images.data ?? []}
        prefix={`${framesPrefix}straightened/`}
        emptyText="Looking for the plot images…"
      />
    </>
  )

  return (
    <div className="space-y-3" data-testid="ground-plot-images">
      <div className="inline-flex flex-wrap rounded-md border bg-muted p-0.5 text-xs">
        {(
          [
            [
              "stitched",
              "Stitched plots",
              Layers,
              "Each plot's stitched image (AgRowStitch), matched to its plot boundary by GPS",
            ],
            [
              "frames",
              "Raw frames",
              Images,
              "Each marked plot's own frames between its start and end, no stitch: the frames that do not overlap are kept, so a model's counts on them add up without counting a plant twice",
            ],
            [
              "photos",
              "One photo per plot",
              Camera,
              "Handheld photos with no GPS, one per plot: each is paired with a plot of the field design",
            ],
          ] as const
        ).map(([key, label, Icon, hint]) => (
          <button
            key={key}
            type="button"
            title={hint}
            onClick={() => setSource(key)}
            data-testid={`ground-source-${key}`}
            className={`flex items-center gap-1.5 rounded px-2.5 py-0.5 ${src === key ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {src === "stitched" && (
        <div className="space-y-2">
          <Button
            size="sm"
            className="h-7"
            disabled={running}
            onClick={onRunStitched}
            data-testid="ground-stitched-run"
          >
            {running && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Match the stitched plots to their boundaries
          </Button>
          <AssociationPanel files={files} scope={scope} />
        </div>
      )}

      {src === "frames" && (
        <div className="space-y-3">
          <p className="text-muted-foreground text-xs">
            Each marked plot's frames, from its start to its end, without
            stitching. Plots are named from the drone plot boundaries they were
            marked from, else by their GPS inside this date's plot boundaries.
            With no GPS, add the field design: its rows are paired with the
            plots in the order they were marked.
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <DesignPicker
              design={design}
              onPick={setDesign}
              label="Field design (no GPS)…"
            />
            {design && (
              <span className="text-muted-foreground">
                {design.rows.length} plots, paired in marking order
              </span>
            )}
            <Button
              size="sm"
              className="h-7"
              disabled={running}
              onClick={() => onRunFrames(design?.rows)}
              data-testid="ground-frames-run"
            >
              {running && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Plot images from the raw frames
            </Button>
          </div>
          {results}
        </div>
      )}

      {src === "photos" && (
        <div className="space-y-3" data-testid="ground-photos">
          <p className="text-muted-foreground text-xs">
            For photos with no GPS, taken one per plot. Each photo is paired
            with a plot of the field design: by a column of the design naming
            its photo (image, photo, file…), else in file-name order, matched to
            the design's rows in order. Check the pairing before making the plot
            images: nothing in the photos can confirm it afterwards.
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <DesignPicker
              design={design}
              onPick={setDesign}
              label="Choose the field design (CSV)…"
            />
            <span className="text-muted-foreground">
              {photos.isLoading
                ? "Looking for the photos…"
                : `${photos.data?.length ?? 0} photos`}
            </span>
          </div>
          {pairing && (
            <div className="space-y-2 text-xs">
              <p>
                <span className="font-medium">
                  {pairing.pairs.length} pairs
                </span>{" "}
                · {pairing.rule}
              </p>
              {pairing.problems.length > 0 && (
                <ul className="list-disc pl-5 text-amber-700 dark:text-amber-300">
                  {pairing.problems.slice(0, 4).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              <div className="max-h-48 overflow-auto rounded border">
                <table className="w-full text-left">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-2 py-1 font-medium">Photo</th>
                      <th className="px-2 py-1 font-medium">Plot</th>
                    </tr>
                  </thead>
                  <tbody data-testid="ground-photo-pairs">
                    {pairing.pairs.map((p) => (
                      <tr key={p.photo} className="border-t">
                        <td className="px-2 py-0.5 font-mono">{p.photo}</td>
                        <td className="px-2 py-0.5">{rowLabel(p.row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                size="sm"
                className="h-7"
                disabled={running || pairing.pairs.length === 0}
                onClick={() => onRunPhotos(pairing.pairs)}
                data-testid="ground-photos-run"
              >
                {running && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                The pairing is right: make the plot images
              </Button>
            </div>
          )}
          {results}
        </div>
      )}
    </div>
  )
}
