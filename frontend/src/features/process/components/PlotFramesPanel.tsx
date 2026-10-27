/**
 * PlotFramesPanel — the plot images from the raw frames (SPLIT_ORTHOMOSAIC
 * source="frames"): each plot's best frames, placed with the camera positions
 * of the ODM run its boundaries were drawn on. Shows the straightened view or
 * the best frame's crop per plot, and downloads any of them named by plot and
 * accession (full frames are taken from the raw upload, not copied).
 */
import { useQuery } from "@tanstack/react-query"
import { Download } from "lucide-react"
import { useMemo, useState } from "react"

import type { FileMetadata } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  downloadViaBrowser,
  downloadZip,
  readJson,
} from "@/features/files/lib/download"
import {
  type FramesDownload,
  framesDownload,
  type PlotFramesManifest,
  partlySeen,
  unseenPlots,
} from "@/features/process/lib/plotFrames"
import useCustomToast from "@/hooks/useCustomToast"
import { PlotImageGrid } from "./PlotImageGrid"

const DOWNLOADS: { value: FramesDownload; label: string }[] = [
  { value: "straightened", label: "Straightened view (one per plot)" },
  { value: "crops-best", label: "Crop of the best frame" },
  { value: "crops-all", label: "Crops of the top frames" },
  { value: "frames-best", label: "Full best frame" },
  { value: "frames-all", label: "Full top frames" },
]

export function PlotFramesPanel({ prefix }: { prefix: string }) {
  const { showErrorToast } = useCustomToast()
  const manifest = useQuery({
    queryKey: ["plot-frames", prefix],
    queryFn: () => readJson<PlotFramesManifest>(`${prefix}manifest.json`),
    retry: false,
    staleTime: 30_000,
  })
  const [show, setShow] = useState<"straightened" | "crop">("straightened")
  const [which, setWhich] = useState<FramesDownload>("crops-all")
  const [zipping, setZipping] = useState(false)
  const m = manifest.data
  const tiles = useMemo<FileMetadata[]>(
    () =>
      (m?.plots ?? [])
        .map((p) =>
          show === "straightened" ? p.straightened : p.frames[0]?.crop,
        )
        .filter((x): x is string => Boolean(x))
        .map((object_name) => ({ object_name }) as FileMetadata),
    [m, show],
  )
  if (!m) return null
  const unseen = unseenPlots(m)
  const partial = partlySeen(m)
  const tail = prefix.split("/").filter(Boolean).slice(-4, -1).join("-")

  const download = async () => {
    setZipping(true)
    try {
      await downloadZip({
        entries: framesDownload(m, which),
        filename: `plot-frames-${which}-${tail}.zip`,
      })
    } catch (e) {
      showErrorToast(e instanceof Error ? e.message : "Download failed")
    } finally {
      setZipping(false)
    }
  }

  return (
    <div className="space-y-3" data-testid="plot-frames">
      <p className="text-sm">
        <span className="font-medium">From the raw frames:</span>{" "}
        {m.plots.length - unseen.length} plots, up to {m.frames_per_plot} frames
        each, placed with the camera positions of the orthomosaic the boundaries
        were drawn on (ground height from {m.ground.join(" and ") || "—"}).
      </p>
      {(unseen.length > 0 || partial.length > 0) && (
        <p className="text-xs text-amber-600" data-testid="plot-frames-gaps">
          {unseen.length > 0 &&
            `No frame shows plot${unseen.length > 1 ? "s" : ""} ${unseen.slice(0, 12).join(", ")}${unseen.length > 12 ? "…" : ""}. `}
          {partial.length > 0 &&
            `The best frame shows only part of plot${partial.length > 1 ? "s" : ""} ${partial.slice(0, 12).join(", ")}${partial.length > 12 ? "…" : ""}.`}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={which}
          onValueChange={(v) => setWhich(v as FramesDownload)}
        >
          <SelectTrigger className="w-64" data-testid="plot-frames-which">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DOWNLOADS.map((d) => (
              <SelectItem key={d.value} value={d.value}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          disabled={zipping}
          onClick={download}
          data-testid="plot-frames-download"
        >
          <Download className="mr-1.5 h-3.5 w-3.5" />
          {zipping ? "Preparing…" : "Download (.zip)"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            downloadViaBrowser(`${prefix}manifest.csv`).catch((e) =>
              showErrorToast(
                e instanceof Error ? e.message : "Download failed",
              ),
            )
          }
        >
          Manifest (.csv)
        </Button>
      </div>
      <div className="flex gap-1 text-xs">
        {(["straightened", "crop"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setShow(s)}
            className={`rounded px-2 py-0.5 ${show === s ? "bg-muted font-medium" : "text-muted-foreground"}`}
          >
            {s === "straightened" ? "Straightened" : "Best frame"}
          </button>
        ))}
      </div>
      <PlotImageGrid files={tiles} prefix={prefix} />
    </div>
  )
}
