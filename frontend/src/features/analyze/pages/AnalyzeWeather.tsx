/**
 * Weather beside the plots' thermal readings: for each flight date with a
 * canopy-temperature trait, the station's air temperature (and humidity,
 * light) over a time-of-day window, and canopy − air temperature per plot
 * (CTD: lower = cooler canopy, transpiring more).
 *
 * Stations come from Files → Upload → Weather Data (Processed/…/Weather/).
 * Times are the logger's clock; pick the window your flights were in.
 */
import { useQuery } from "@tanstack/react-query"
import { Download, Loader2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import type { TraitOutput } from "@/client"
import { Button } from "@/components/ui/button"
import { idAsString } from "@/features/admin/lib/ids"
import {
  ProcessScopeSelectors,
  useAerialScopeContext,
} from "@/features/process/components/AerialScopePicker"
import { CanopyAirCard } from "@/features/weather/components/CanopyAirCard"
import { useStations } from "@/features/weather/hooks/useStations"
import { airCol, meanAround, wallClock } from "@/features/weather/lib/canopyAir"
import { windowMean } from "@/features/weather/lib/weather"
import { chartTooltip } from "@/lib/chartTheme"
import { traitLabel } from "@/lib/traitName"
import { usePlotPolygons } from "../hooks/usePlotPolygons"
import { useScopeTraits } from "../hooks/useScopeTraits"
import { fetchTraitRecords } from "../lib/traitRecords"

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea"]

const fmt = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? "—" : v.toFixed(d)

export function AnalyzeWeather({ traits }: { traits: TraitOutput[] }) {
  const ctx = useAerialScopeContext()
  const scope = {
    year: ctx.seasonName ?? undefined,
    experiment: ctx.experimentName ?? undefined,
    site: ctx.siteName ?? undefined,
  }
  const stations = useStations(scope)
  const scopeTraits = useScopeTraits(ctx)

  // Thermal traits measured here (canopy temperature first).
  const thermal = useMemo(
    () =>
      traits
        .filter((t) => t.trait_name && scopeTraits.dates.has(t.trait_name))
        .filter((t) => /temp|thermal/i.test(t.trait_name ?? ""))
        .filter((t) => !/^ctd/i.test(t.trait_name ?? ""))
        .sort(
          (a, b) =>
            (a.trait_name === "Temp_veg_avg_C" ? -1 : 0) -
            (b.trait_name === "Temp_veg_avg_C" ? -1 : 0),
        ),
    [traits, scopeTraits.dates],
  )
  const [traitId, setTraitId] = useState("")
  useEffect(() => {
    if (!thermal.some((t) => idAsString(t.id) === traitId))
      setTraitId(thermal[0] ? idAsString(thermal[0].id) : "")
  }, [thermal, traitId])
  const trait = thermal.find((t) => idAsString(t.id) === traitId)

  // Air temperature at each flight's own time (from the thermal readings'
  // timestamps), or over a fixed time-of-day window.
  const [mode, setMode] = useState<"flight" | "window">("flight")
  const HALF = 10
  const [from, setFrom] = useState("11:00")
  const [to, setTo] = useState("14:00")
  const [stationIdx, setStationIdx] = useState(0)

  const records = useQuery({
    queryKey: [
      "weather-thermal",
      traitId,
      ctx.experimentName,
      ctx.seasonName,
      ctx.siteName,
      ctx.populationName,
    ],
    enabled: Boolean(traitId),
    queryFn: () =>
      fetchTraitRecords(traitId, {
        experimentName: ctx.experimentName,
        seasonName: ctx.seasonName,
        siteName: ctx.siteName,
        populationName: ctx.populationName,
      }),
  })

  const plots = usePlotPolygons({
    experimentId: ctx.experimentId,
    seasonId: ctx.seasonId,
    siteId: ctx.siteId,
  })
  const accessionOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of plots.data?.features ?? []) {
      const p = f.properties ?? {}
      if (p.plot_id) m.set(String(p.plot_id), String(p.accession_name ?? ""))
    }
    return m
  }, [plots.data])

  // Each plot's field-design values, to match plots to a station's treatment.
  const plotValues = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const f of plots.data?.features ?? []) {
      const p = (f.properties ?? {}) as Record<string, unknown>
      if (!p.plot_id) continue
      m.set(
        String(p.plot_id),
        Object.values(p).filter((v): v is string => typeof v === "string"),
      )
    }
    return m
  }, [plots.data])

  const st = stations.data ?? []
  const station = st[stationIdx] ?? st[0]

  // Per flight date: canopy mean, each station's air temperature and CTD.
  const byDate = useMemo(() => {
    const groups = new Map<string, { vals: number[]; times: string[] }>()
    for (const r of records.data ?? []) {
      const d = String(r.collection_date ?? r.timestamp ?? "").slice(0, 10)
      const v = Number(r.trait_value)
      if (!d || !Number.isFinite(v)) continue
      const g = groups.get(d) ?? { vals: [], times: [] }
      g.vals.push(v)
      const t = r.timestamp ? wallClock(String(r.timestamp)) : null
      if (t?.startsWith(d)) g.times.push(t)
      groups.set(d, g)
    }
    return [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, { vals, times }]) => {
        const canopy = vals.reduce((a, b) => a + b, 0) / vals.length
        times.sort()
        // The flight's time: the middle of its readings' timestamps.
        const flown = times.length ? times[times.length >> 1] : null
        const useFlight = mode === "flight" && flown != null
        const value = (s: (typeof st)[number], col: string) =>
          useFlight
            ? meanAround(s.rows, col, flown as string, HALF)
            : windowMean(s.rows, col, date, from, to).mean
        const air = st.map((s) => {
          const col = airCol(s)
          return col ? value(s, col) : null
        })
        const rh = station?.columns.includes("rh") ? value(station, "rh") : null
        const par = station?.columns.includes("par")
          ? value(station, "par")
          : null
        const a = air[stationIdx] ?? air[0] ?? null
        return {
          date,
          flown: flown?.slice(11, 16) ?? null,
          n: vals.length,
          canopy,
          air,
          rh,
          par,
          ctd: a == null ? null : canopy - a,
        }
      })
  }, [records.data, st, station, stationIdx, from, to, mode])

  const covered = byDate.filter((d) => d.air.some((a) => a != null))
  const [day, setDay] = useState("")
  const shownDay =
    day && covered.some((d) => d.date === day) ? day : (covered[0]?.date ?? "")
  // What the chart shades: the flight's ± window (on its 10-minute ticks) or
  // the fixed window.
  const shownFlight = byDate.find((d) => d.date === shownDay)?.flown
  const shade = useMemo(() => {
    if (mode !== "flight" || !shownFlight) return { x1: from, x2: to }
    const m =
      Number(shownFlight.slice(0, 2)) * 60 + Number(shownFlight.slice(3))
    const hm = (v: number) =>
      `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`
    return {
      x1: hm(Math.floor((m - HALF) / 10) * 10),
      x2: hm(Math.ceil((m + HALF) / 10) * 10),
    }
  }, [mode, shownFlight, from, to])
  const dayCurve = useMemo(() => {
    if (!shownDay) return []
    const m = new Map<string, Record<string, number | string | null>>()
    st.forEach((s, i) => {
      const col = airCol(s)
      if (!col) return
      for (const r of s.rows) {
        if (!r.time.startsWith(shownDay)) continue
        const hm = r.time.slice(11, 16)
        const minute = Number(hm.slice(3))
        if (minute % 10) continue // every 10 minutes is plenty to draw
        const row = m.get(hm) ?? { time: hm }
        row[`s${i}`] = r.values[col]
        m.set(hm, row)
      }
    })
    return [...m.values()].sort((a, b) =>
      String(a.time).localeCompare(String(b.time)),
    )
  }, [st, shownDay])

  const downloadPlots = () => {
    const lines = ["date,plot_id,accession,canopy_c,air_c,ctd_c,station,window"]
    for (const r of records.data ?? []) {
      const d = String(r.collection_date ?? "").slice(0, 10)
      const row = byDate.find((x) => x.date === d)
      const air = row?.air[stationIdx] ?? null
      const v = Number(r.trait_value)
      lines.push(
        [
          d,
          r.plot_id ?? "",
          accessionOf.get(String(r.plot_id)) ?? "",
          v,
          air ?? "",
          air == null ? "" : (v - air).toFixed(3),
          `"${station?.meta.station ?? ""}"`,
          mode === "flight" && row?.flown
            ? `${row.flown} ±${HALF} min`
            : `${from}-${to}`,
        ].join(","),
      )
    }
    const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/csv" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `canopy-air-${ctx.experimentName ?? "experiment"}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <div className="flex flex-col gap-3" data-testid="analyze-weather">
      <ProcessScopeSelectors allowAllPopulations onlyWithData />

      {stations.isLoading ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" /> Reading weather stations…
        </p>
      ) : st.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="weather-none">
          No weather data for this experiment, season and site yet. Upload it
          under Files → Upload → Weather Data (Campbell .dat or CSV).
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 text-xs">
            <label className="space-y-1">
              <span className="text-muted-foreground block">Thermal trait</span>
              <select
                className="bg-background h-8 rounded border px-2"
                value={traitId}
                onChange={(e) => setTraitId(e.target.value)}
              >
                {thermal.length === 0 && (
                  <option value="">none measured here</option>
                )}
                {thermal.map((t) => (
                  <option key={idAsString(t.id)} value={idAsString(t.id)}>
                    {traitLabel(t.trait_name)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground block">
                Station for these plots
              </span>
              <select
                className="bg-background h-8 rounded border px-2"
                value={stationIdx}
                onChange={(e) => setStationIdx(Number(e.target.value))}
              >
                {st.map((s, i) => (
                  <option key={s.meta.station} value={i}>
                    {s.meta.station}
                    {s.meta.treatment &&
                    !s.meta.station
                      .toLowerCase()
                      .includes(s.meta.treatment.toLowerCase())
                      ? ` (${s.meta.treatment})`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-muted-foreground block">
                Air temperature (logger clock)
              </span>
              <span className="flex items-center gap-1">
                <select
                  className="bg-background h-8 rounded border px-2"
                  value={mode}
                  onChange={(e) =>
                    setMode(e.target.value as "flight" | "window")
                  }
                  data-testid="weather-mode"
                >
                  <option value="flight">
                    At each flight's time ± {HALF} min
                  </option>
                  <option value="window">Over a fixed window</option>
                </select>
                {mode === "window" && (
                  <>
                    <input
                      type="time"
                      className="bg-background h-8 rounded border px-1"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                    –
                    <input
                      type="time"
                      className="bg-background h-8 rounded border px-1"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </>
                )}
              </span>
            </label>
            <span className="text-muted-foreground max-w-md">
              {st
                .map(
                  (s) =>
                    `${s.meta.station}: ${s.meta.first.slice(0, 10)} → ${s.meta.last.slice(0, 10)}`,
                )
                .join(" · ")}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-8"
              onClick={downloadPlots}
              disabled={!byDate.length}
            >
              <Download className="mr-1 size-3.5" /> Per-plot CSV
            </Button>
          </div>

          <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="max-h-[min(55svh,32rem)] overflow-auto rounded-md border">
              <table
                className="w-full text-xs tabular-nums"
                data-testid="weather-dates"
              >
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Date</th>
                    <th className="px-2 py-1.5 text-right">Plots</th>
                    <th className="px-2 py-1.5 text-right">Canopy °C</th>
                    {st.map((s, i) => (
                      <th
                        key={s.meta.station}
                        className="px-2 py-1.5 text-right"
                        style={{ color: COLORS[i % COLORS.length] }}
                      >
                        Air °C · {s.meta.treatment || s.meta.station}
                      </th>
                    ))}
                    <th
                      className="px-2 py-1.5 text-right"
                      title="Canopy − air, with the chosen station"
                    >
                      CTD °C
                    </th>
                    <th className="px-2 py-1.5 text-right">RH %</th>
                    <th className="px-2 py-1.5 text-right">PAR</th>
                  </tr>
                </thead>
                <tbody>
                  {records.isLoading && (
                    <tr>
                      <td
                        colSpan={7}
                        className="text-muted-foreground px-2 py-3"
                      >
                        Loading thermal readings…
                      </td>
                    </tr>
                  )}
                  {byDate.map((d) => (
                    <tr
                      key={d.date}
                      className={`cursor-pointer border-t hover:bg-muted/40 ${d.date === shownDay ? "bg-muted/40" : ""} ${d.air.every((a) => a == null) ? "text-muted-foreground" : ""}`}
                      onClick={() => setDay(d.date)}
                    >
                      <td className="whitespace-nowrap px-2 py-1 font-mono">
                        {d.date}
                        {d.flown && (
                          <span className="text-muted-foreground ml-1.5">
                            {d.flown}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right">{d.n}</td>
                      <td className="px-2 py-1 text-right">{fmt(d.canopy)}</td>
                      {d.air.map((a, i) => (
                        <td key={i} className="px-2 py-1 text-right">
                          {fmt(a)}
                        </td>
                      ))}
                      <td
                        className={`px-2 py-1 text-right font-medium ${d.ctd != null && d.ctd < 0 ? "text-blue-600" : d.ctd != null ? "text-red-600" : ""}`}
                      >
                        {d.ctd == null
                          ? "no weather"
                          : `${d.ctd > 0 ? "+" : ""}${fmt(d.ctd)}`}
                      </td>
                      <td className="px-2 py-1 text-right">{fmt(d.rh, 0)}</td>
                      <td className="px-2 py-1 text-right">{fmt(d.par, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="rounded-md border p-2">
              <p className="mb-1 text-xs">
                Air temperature on{" "}
                <span className="font-medium">{shownDay || "—"}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · shaded: the flight window · click a date to switch
                </span>
              </p>
              {dayCurve.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart
                    data={dayCurve}
                    margin={{ top: 5, right: 10, bottom: 5, left: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--border)"
                    />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 10 }}
                      interval={11}
                    />
                    <YAxis tick={{ fontSize: 10 }} unit="°" width={36} />
                    <Tooltip {...chartTooltip} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceArea
                      x1={shade.x1}
                      x2={shade.x2}
                      fill="var(--primary)"
                      fillOpacity={0.08}
                    />
                    {st.map((s, i) => (
                      <Line
                        key={s.meta.station}
                        dataKey={`s${i}`}
                        name={s.meta.treatment || s.meta.station}
                        stroke={COLORS[i % COLORS.length]}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-muted-foreground py-8 text-center text-xs">
                  No thermal date falls within the weather data.
                </p>
              )}
            </div>
          </div>

          <p className="text-muted-foreground text-xs">
            CTD = canopy − air temperature: below zero the canopy is cooler than
            the air (transpiring); near or above zero suggests stress.{" "}
            {trait ? traitLabel(trait.trait_name) : "The trait"} is the plot
            plot mean from the thermal data; air temperature is the station's
            mean{" "}
            {mode === "flight"
              ? `within ${HALF} minutes of each flight (the time beside each date)`
              : `over ${from}–${to}`}
            .
          </p>
          <CanopyAirCard
            scope={{
              experiment: ctx.experimentName ?? undefined,
              year: ctx.seasonName ?? undefined,
              site: ctx.siteName ?? undefined,
              population: ctx.populationName ?? undefined,
            }}
            plotValues={plotValues}
          />
        </>
      )}
    </div>
  )
}
