/**
 * Canopy − air temperature as a trait: the plots' canopy temperature against
 * a weather station's air temperature at each flight's time. Shown in the
 * trait-extraction step and in Analyze → Weather; weather data can be
 * uploaded from here when there is none yet.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { CloudSun, Loader2, Upload } from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import {
  type DatasetOutput,
  DatasetsService,
  type TraitOutput,
  TraitsService,
} from "@/client"
import { Button } from "@/components/ui/button"
import { idAsString } from "@/features/admin/lib/ids"
import { fetchTraitRecords } from "@/features/analyze/lib/traitRecords"
import { uploadFileChunked } from "@/lib/chunkedUpload"
import { stationsKey, useStations } from "../hooks/useStations"
import {
  airCol,
  canopyAir,
  type StationChoice,
  type ThermalRecord,
} from "../lib/canopyAir"
import { SOURCE, saveCanopyAir } from "../lib/saveCanopyAir"
import { WeatherUploadDialog } from "./WeatherUploadDialog"

const THERMAL_TRAIT = "Temp_veg_avg_C"

const f1 = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : v.toFixed(1)
const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`

export function CanopyAirCard({
  scope,
  date,
  plotValues,
}: {
  scope: {
    experiment?: string
    year?: string
    site?: string
    population?: string
  }
  /** The run's flight date, marked in the list (every date is saved). */
  date?: string
  /** plot_id → field-design values, to match plots to a station's treatment. */
  plotValues?: Map<string, string[]>
}) {
  const qc = useQueryClient()
  const stations = useStations(scope)
  const ready = Boolean(scope.experiment && scope.year && scope.site)

  const thermal = useQuery({
    queryKey: [
      "canopy-air-thermal",
      scope.experiment,
      scope.year,
      scope.site,
      scope.population,
    ],
    enabled: ready,
    queryFn: async (): Promise<ThermalRecord[]> => {
      const found = ((await TraitsService.apiTraitsGetTraits({
        traitName: THERMAL_TRAIT,
        experimentName: scope.experiment,
      }).catch(() => [])) ?? []) as TraitOutput[]
      const t = found.find((x) => x.trait_name === THERMAL_TRAIT)
      if (!t?.id) return []
      return (await fetchTraitRecords(idAsString(t.id), {
        experimentName: scope.experiment,
        seasonName: scope.year,
        siteName: scope.site,
        populationName: scope.population,
      })) as ThermalRecord[]
    },
  })

  // Flights already saved (to show new dates as not yet included).
  const saved = useQuery({
    queryKey: [
      "datasets",
      "canopy-air",
      scope.experiment,
      scope.year,
      scope.site,
      scope.population,
    ],
    enabled: ready,
    queryFn: async () => {
      const list = ((await DatasetsService.apiDatasetsGetDatasets({
        experimentName: scope.experiment,
      })) ?? []) as DatasetOutput[]
      return new Set(
        list
          .map((d) => d.dataset_name ?? "")
          .filter((n) =>
            n.startsWith(
              `${SOURCE} · ${scope.experiment} · ${scope.year}/${scope.site}/${scope.population ?? ""}`,
            ),
          )
          .map((n) => n.split(" · ")[3]),
      )
    },
  })

  const [choice, setChoice] = useState<StationChoice>("mean")
  const [half, setHalf] = useState(10)
  const [relative, setRelative] = useState(true)
  const [busy, setBusy] = useState(false)

  const withAir = useMemo(
    () => (stations.data ?? []).filter((s) => airCol(s)),
    [stations.data],
  )
  const result = useMemo(
    () =>
      canopyAir(thermal.data ?? [], withAir, {
        choice,
        halfWindow: half,
        plotValues,
      }),
    [thermal.data, withAir, choice, half, plotValues],
  )
  const matched = result.rows.filter((r) => r.matched).length

  // Upload from here: originals to Raw/…/Weather, then map the columns.
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[] | null>(null)
  const [uploading, setUploading] = useState(false)
  const onFiles = async (list: FileList | null) => {
    if (!list?.length || !ready) return
    const picked = [...list]
    setUploading(true)
    try {
      for (const f of picked) {
        const path = `Raw/${scope.year}/${scope.experiment}/${scope.site}/Weather/${f.name}`
        await uploadFileChunked({
          file: f,
          fileIdentifier: `${path}-${f.size}-${f.lastModified}`,
          objectName: path,
        })
      }
      setFiles(picked)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed")
    } finally {
      setUploading(false)
      if (input.current) input.current.value = ""
    }
  }

  const save = async () => {
    if (!ready) return
    setBusy(true)
    try {
      const { records, flights } = await saveCanopyAir(
        {
          experiment: scope.experiment as string,
          year: scope.year as string,
          site: scope.site as string,
        },
        result.rows,
        { relative, halfWindow: half },
      )
      toast.success(
        `Saved canopy − air temperature for ${flights} flight${flights === 1 ? "" : "s"} (${records.toLocaleString()} values). It is in Analyze as a trait.`,
      )
      for (const key of [
        ["datasets"],
        ["analyze"],
        ["trait-records"],
        ["traits"],
        ["scope-traits"],
      ])
        qc.invalidateQueries({ queryKey: key })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the trait")
    } finally {
      setBusy(false)
    }
  }

  if (!ready) return null
  const hasThermal = (thermal.data?.length ?? 0) > 0
  if (thermal.isSuccess && !hasThermal && date) return null

  const unsaved = result.flights.filter((f) => !saved.data?.has(f.date)).length

  return (
    <div
      className="space-y-2 rounded-md border p-3"
      data-testid="canopy-air-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CloudSun className="size-4" />
        <p className="text-sm font-medium">Canopy − air temperature</p>
        <p className="text-muted-foreground text-xs">
          each plot's canopy temperature minus the station's air temperature at
          its flight time · below zero: cooler than the air (transpiring)
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept=".dat,.csv,.txt"
          className="hidden"
          onChange={(e) => void onFiles(e.target.files)}
        />
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-7"
          disabled={uploading}
          onClick={() => input.current?.click()}
          data-testid="canopy-air-upload"
        >
          {uploading ? (
            <Loader2 className="mr-1 size-3.5 animate-spin" />
          ) : (
            <Upload className="mr-1 size-3.5" />
          )}
          {withAir.length ? "Add a station" : "Upload weather data"}
        </Button>
      </div>

      {(stations.isLoading || thermal.isLoading) && (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin" /> Reading the weather and
          canopy temperature…
        </p>
      )}
      {stations.isSuccess && !withAir.length && (
        <p
          className="text-muted-foreground text-xs"
          data-testid="canopy-air-no-weather"
        >
          No weather station with air temperature for {scope.site} {scope.year}{" "}
          yet. Upload the logger's .dat (TOA5) or .csv files; you pick what each
          column is next.
        </p>
      )}
      {thermal.isSuccess && !hasThermal && (
        <p className="text-muted-foreground text-xs">
          No canopy temperature here yet: it comes from a thermal orthomosaic in
          trait extraction, or the thermal plot images.
        </p>
      )}

      {withAir.length > 0 && hasThermal && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              Station
              <select
                className="bg-background h-7 rounded border px-1.5"
                value={String(choice)}
                onChange={(e) =>
                  setChoice(
                    e.target.value === "mean" ? "mean" : Number(e.target.value),
                  )
                }
                data-testid="canopy-air-station"
              >
                {withAir.length > 1 && (
                  <option value="mean">Mean of all stations</option>
                )}
                {withAir.map((s, i) => (
                  <option key={s.meta.station} value={i}>
                    {s.meta.station}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              Air temperature over
              <select
                className="bg-background h-7 rounded border px-1.5"
                value={half}
                onChange={(e) => setHalf(Number(e.target.value))}
              >
                {[5, 10, 15, 30].map((m) => (
                  <option key={m} value={m}>
                    ± {m} min of the flight
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={relative}
                onChange={(e) => setRelative(e.target.checked)}
              />
              Also vs the field median (compares lines across dates)
            </label>
          </div>
          {withAir.some((s) => s.meta.treatment) && (
            <p className="text-muted-foreground text-xs">
              {matched
                ? `${matched} of ${result.rows.length} plot readings matched a station by treatment; the rest use the choice above.`
                : "No plot or thermal run names a station's treatment, so every plot uses the choice above."}
            </p>
          )}

          <div className="max-h-56 overflow-auto rounded border">
            <table className="w-full text-xs tabular-nums">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="px-2 py-1 text-left">Date</th>
                  <th className="px-2 py-1 text-left">Flown</th>
                  <th className="px-2 py-1 text-right">Plots</th>
                  <th className="px-2 py-1 text-right">Air °C</th>
                  <th className="px-2 py-1 text-right">VPD kPa</th>
                  <th className="px-2 py-1 text-right">Mean CTD °C</th>
                  <th className="px-2 py-1 text-left">Saved</th>
                </tr>
              </thead>
              <tbody>
                {result.flights.map((f) => (
                  <tr
                    key={f.dataset}
                    className={`border-t ${f.date === date ? "bg-muted/40 font-medium" : ""}`}
                  >
                    <td className="whitespace-nowrap px-2 py-1 font-mono">
                      {f.date}
                    </td>
                    <td className="px-2 py-1">{f.time}</td>
                    <td className="px-2 py-1 text-right">{f.plots}</td>
                    <td className="px-2 py-1 text-right">{f1(f.air)}</td>
                    <td className="px-2 py-1 text-right">{f1(f.vpd)}</td>
                    <td
                      className={`px-2 py-1 text-right ${f.ctd < 0 ? "text-blue-600" : "text-red-600"}`}
                    >
                      {signed(f.ctd)}
                    </td>
                    <td className="text-muted-foreground px-2 py-1">
                      {saved.data?.has(f.date) ? "yes" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.missing > 0 && (
            <p className="text-muted-foreground text-xs">
              {result.missing} reading{result.missing === 1 ? "" : "s"} left
              out: no air temperature near their flight time (outside the
              station's dates, or a gap).
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => void save()}
              disabled={busy || !result.rows.length}
              data-testid="canopy-air-save"
            >
              {busy && <Loader2 className="mr-1 size-3.5 animate-spin" />}
              {saved.data?.size ? "Save again" : "Save as a trait"}
            </Button>
            <span className="text-muted-foreground text-xs">
              {unsaved
                ? `${unsaved} flight${unsaved === 1 ? "" : "s"} not saved yet · `
                : ""}
              every date here; saving again replaces the earlier values
            </span>
          </div>
        </>
      )}

      {files && (
        <WeatherUploadDialog
          open
          files={files}
          scope={{
            experiment: scope.experiment,
            season: scope.year,
            location: scope.site,
          }}
          onClose={() => {
            setFiles(null)
            qc.invalidateQueries({ queryKey: stationsKey(scope) })
          }}
        />
      )}
    </div>
  )
}
