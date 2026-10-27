/**
 * PlotFramesPanel — the plot images from the raw frames (SPLIT_ORTHOMOSAIC
 * source="frames"): each plot's best frames, placed with the camera positions
 * of the ODM run its boundaries were drawn on. Shows the straightened view or
 * the best frame's crop per plot, and downloads any of them named by plot and
 * accession (full frames are taken from the raw upload, not copied).
 *
 * The flight's other cameras (a thermal camera beside the RGB one), uploaded
 * for the same date as their own sensor, come out of the same step: matched
 * to the RGB frames by capture time, lined up with them, and cut per plot. A
 * thermal camera also gives each plot's canopy temperature (the trait
 * Temp_veg_avg_C, in Analyze).
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
  ALL_SENSORS,
  type CompanionSection,
  canopyTemperatures,
  companionSensors,
  type FramesDownload,
  framesDownload,
  type PlotFramesManifest,
  partlySeen,
  unseenPlots,
} from "@/features/process/lib/plotFrames"
import useCustomToast from "@/hooks/useCustomToast"
import { PlotImageGrid } from "./PlotImageGrid"

/** What a download holds, beside "the images shown": for the camera shown. */
type DownloadChoice =
  | "shown"
  | "crops-all"
  | "frames-best"
  | "frames-all"
  | "shown-all"

const MORE_DOWNLOADS: { value: DownloadChoice; label: string }[] = [
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
  // One choice of camera and of view: it sets the images shown, and what "these
  // images" downloads.
  const [show, setShow] = useState<"straightened" | "crop">("straightened")
  const [choice, setChoice] = useState<DownloadChoice>("shown")
  const [zipping, setZipping] = useState(false)
  const m = manifest.data
  const own = m?.sensor ?? "RGB"
  const others = m ? companionSensors(m) : []
  const [sensor, setSensor] = useState<string>("")
  const viewing = sensor && others.includes(sensor) ? sensor : own
  const tiles = useMemo<FileMetadata[]>(
    () =>
      (m?.plots ?? [])
        .map((p) => {
          if (viewing === own)
            return show === "straightened" ? p.straightened : p.frames[0]?.crop
          const v = p.companions?.[viewing]
          return show === "straightened"
            ? v?.straightened_preview
            : v?.frames[0]?.crop_preview
        })
        .filter((x): x is string => Boolean(x))
        .map((object_name) => ({ object_name }) as FileMetadata),
    [m, show, viewing, own],
  )
  if (!m) return null
  const unseen = unseenPlots(m)
  const partial = partlySeen(m)
  const tail = prefix.split("/").filter(Boolean).slice(-4, -1).join("-")

  const shownSet: FramesDownload =
    show === "straightened" ? "straightened" : "crops-best"
  const download = async () => {
    setZipping(true)
    try {
      const which: FramesDownload =
        choice === "shown" || choice === "shown-all" ? shownSet : choice
      const cams = choice === "shown-all" ? ALL_SENSORS : viewing
      await downloadZip({
        entries: framesDownload(m, which, cams),
        filename: `plot-frames-${cams === ALL_SENSORS ? "all" : cams}-${which}-${tail}.zip`,
      })
    } catch (e) {
      showErrorToast(e instanceof Error ? e.message : "Download failed")
    } finally {
      setZipping(false)
    }
  }
  const seg = (on: boolean) =>
    `rounded px-2.5 py-1 ${on ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`

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
      {Object.entries(m.companions ?? {}).map(([name, sec]) => (
        <CompanionSummary key={name} name={name} sec={sec} />
      ))}
      {!m.companions && (
        <p className="text-xs text-muted-foreground">
          Other cameras of this flight (a thermal camera beside the RGB one)
          come out of this step too: upload their frames for the same date as
          their own sensor (e.g. Thermal), then pick the frames again.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {others.length > 0 && (
          <div
            className="inline-flex rounded-md border bg-muted p-0.5 text-xs"
            data-testid="plot-frames-camera"
          >
            {[own, ...others].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSensor(s)}
                data-testid={`plot-frames-view-${s}`}
                className={seg(viewing === s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div className="inline-flex rounded-md border bg-muted p-0.5 text-xs">
          {(["straightened", "crop"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setShow(s)}
              className={seg(show === s)}
            >
              {s === "straightened" ? "Straightened" : "Best frame"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={choice}
            onValueChange={(v) => setChoice(v as DownloadChoice)}
          >
            <SelectTrigger className="h-8 w-56" data-testid="plot-frames-which">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="shown">These images</SelectItem>
              {MORE_DOWNLOADS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                  {others.length > 0 ? ` (${viewing})` : ""}
                </SelectItem>
              ))}
              {others.length > 0 && (
                <SelectItem value="shown-all">
                  These images, every camera
                </SelectItem>
              )}
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
      </div>
      {viewing !== own && m.companions?.[viewing]?.preview_window && (
        <p className="text-xs text-muted-foreground">
          Coloured on one scale for every plot:{" "}
          {m.companions[viewing].preview_window?.[0]} °C (dark) to{" "}
          {m.companions[viewing].preview_window?.[1]} °C (bright). The .tif
          files in the downloads hold the temperatures.
        </p>
      )}
      <PlotImageGrid files={tiles} prefix={prefix} download={false} />
      {viewing !== own && (
        <CanopyTable m={m} sensor={viewing} prefix={prefix} />
      )}
    </div>
  )
}

/** How another camera's frames were matched and lined up, in a sentence or two. */
function CompanionSummary({
  name,
  sec,
}: {
  name: string
  sec: CompanionSection
}) {
  if (sec.error)
    return (
      <p
        className="text-xs text-amber-600"
        data-testid={`plot-frames-companion-${name}`}
      >
        {name}: {sec.frames} frames uploaded for this date, but no plot images
        from them — {sec.error}
      </p>
    )
  const a = sec.alignment
  return (
    <p
      className="text-xs text-muted-foreground"
      data-testid={`plot-frames-companion-${name}`}
    >
      <span className="font-medium text-foreground">{name}:</span> {sec.matched}{" "}
      of {sec.of_rgb_frames} frames matched by capture time (at most{" "}
      {sec.max_seconds_apart} s apart)
      {a &&
        `, lined up at ${a.k.toFixed(2)} RGB pixels per ${name.toLowerCase()} pixel (${a.pairs_used} of ${a.pairs_tried} test pairs agree${sec.frames_aligned_on_their_own ? `; ${sec.frames_aligned_on_their_own} frames fine-tuned on their own` : ""})`}
      ; {sec.plots_seen} plots.
      {sec.canopy_temperature_plots != null &&
        ` Canopy temperature for ${sec.canopy_temperature_plots} plots, saved as the trait Temp_veg_avg_C (Analyze).`}
      {sec.values === "image (no temperatures)" &&
        " These frames hold no temperatures (8-bit images), so no canopy temperature: upload the radiometric or converted frames (°C) for that."}
      {sec.trait_error && (
        <span className="text-amber-600">
          {" "}
          Not saved as a trait: {sec.trait_error}
        </span>
      )}
    </p>
  )
}

/** Each plot's canopy temperature, and the table as a file. */
function CanopyTable({
  m,
  sensor,
  prefix,
}: {
  m: PlotFramesManifest
  sensor: string
  prefix: string
}) {
  const { showErrorToast } = useCustomToast()
  const rows = canopyTemperatures(m, sensor)
  if (rows.length === 0) return null
  const vals = rows.map((r) => r.c.canopy_mean_c as number)
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  return (
    <div className="space-y-1.5" data-testid="plot-frames-canopy">
      <div className="flex items-center justify-between">
        <p className="text-sm">
          <span className="font-medium">Canopy temperature</span> — mean{" "}
          {mean.toFixed(1)} °C over {rows.length} plots (
          {Math.min(...vals).toFixed(1)} to {Math.max(...vals).toFixed(1)} °C)
        </p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            downloadViaBrowser(
              `${m.companions?.[sensor]?.prefix ?? `${prefix}${sensor}/`}plots.csv`,
            ).catch((e) =>
              showErrorToast(
                e instanceof Error ? e.message : "Download failed",
              ),
            )
          }
        >
          Table (.csv)
        </Button>
      </div>
      <div className="max-h-64 overflow-auto rounded border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted text-left">
            <tr>
              <th className="px-2 py-1">Plot</th>
              <th className="px-2 py-1">Accession</th>
              <th className="px-2 py-1 text-right">Canopy °C</th>
              <th className="px-2 py-1 text-right">Median</th>
              <th className="px-2 py-1 text-right">Soil °C</th>
              <th className="px-2 py-1 text-right">Plant share</th>
              <th
                className="px-2 py-1 text-right"
                title="Share of the plot the thermal frames cover, and from how many frames its view is pieced together"
              >
                Cover
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.plot)} className="border-t">
                <td className="px-2 py-0.5">{r.plot}</td>
                <td className="px-2 py-0.5">{r.accession}</td>
                <td className="px-2 py-0.5 text-right">
                  {r.c.canopy_mean_c?.toFixed(1)}
                </td>
                <td className="px-2 py-0.5 text-right">
                  {r.c.canopy_median_c?.toFixed(1)}
                </td>
                <td className="px-2 py-0.5 text-right">
                  {r.c.soil_mean_c?.toFixed(1) ?? "—"}
                </td>
                <td className="px-2 py-0.5 text-right">
                  {Math.round(r.c.plant_share * 100)}%
                </td>
                <td className="px-2 py-0.5 text-right">
                  {r.cover != null ? `${Math.round(r.cover * 100)}%` : "—"}
                  {r.pieced ? ` (${r.pieced})` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
