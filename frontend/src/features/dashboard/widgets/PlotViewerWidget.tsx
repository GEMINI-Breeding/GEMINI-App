/**
 * PlotViewerWidget — search plots within a TraitRecord and pin them
 * for side-by-side image comparison with trait values.
 *
 * Reuses the same image fetch pattern as QueryTab.
 */

import { useState, useMemo, useEffect } from "react"
import { Loader2, Pin, PinOff, Search, ImageOff, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { useTraitRecordGeojson, useImagePlotIds, applyFilters } from "../hooks/useTraitData"
import type { PlotViewerConfig } from "../types"

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? ""
  return base ? `${base}${path}` : path
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("access_token") || ""
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Fetches the plot image via fetch() with auth headers, then renders via blob URL.
 * This is necessary because <img src=...> cannot send Authorization headers.
 */
function PlotImage({ recordId, plotId }: { recordId: string; plotId: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    setBlobUrl(null)
    setErrored(false)
    let revoked = false
    let objectUrl: string | null = null

    fetch(
      apiUrl(`/api/v1/analyze/trait-records/${recordId}/plot-image/${encodeURIComponent(plotId)}`),
      { headers: authHeaders() }
    )
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`)
        return res.blob()
      })
      .then((blob) => {
        if (!revoked) {
          objectUrl = URL.createObjectURL(blob)
          setBlobUrl(objectUrl)
        }
      })
      .catch(() => { if (!revoked) setErrored(true) })

    return () => {
      revoked = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [recordId, plotId])

  if (errored) {
    return (
      <div className="flex items-center justify-center bg-muted rounded w-full aspect-video">
        <ImageOff className="w-5 h-5 text-muted-foreground" />
      </div>
    )
  }

  if (!blobUrl) {
    return (
      <div className="flex items-center justify-center bg-muted rounded w-full aspect-video">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="w-full aspect-video bg-muted rounded overflow-hidden">
      <img src={blobUrl} alt={plotId} className="w-full h-full object-contain" />
    </div>
  )
}

interface PlotViewerWidgetProps {
  config: PlotViewerConfig
  onUpdateConfig?: (patch: Partial<PlotViewerConfig>) => void
}

export function PlotViewerWidget({ config, onUpdateConfig }: PlotViewerWidgetProps) {
  const { traitRecordId, pinnedPlotIds, filters } = config
  const [search, setSearch] = useState("")

  const { data: geoData, isLoading } = useTraitRecordGeojson(traitRecordId)
  const { data: imagePlotIds } = useImagePlotIds(traitRecordId)

  const allPlots = useMemo(() => {
    if (!geoData) return []
    return applyFilters(geoData.geojson.features, filters).map((f) => ({
      plotId: String(f.properties?.plot_id ?? ""),
      accession: String(f.properties?.accession ?? ""),
      properties: f.properties ?? {},
      hasImage: (imagePlotIds ?? []).includes(String(f.properties?.plot_id ?? "")),
    }))
  }, [geoData, imagePlotIds, filters])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return allPlots
    return allPlots.filter(
      (p) => p.plotId.toLowerCase().includes(q) || p.accession.toLowerCase().includes(q)
    )
  }, [allPlots, search])

  const metricCols = geoData?.metric_columns.slice(0, 4) ?? []

  function togglePin(plotId: string) {
    if (!onUpdateConfig) return
    const next = pinnedPlotIds.includes(plotId)
      ? pinnedPlotIds.filter((id) => id !== plotId)
      : [...pinnedPlotIds, plotId]
    onUpdateConfig({ pinnedPlotIds: next })
  }

  function clearPinned() {
    onUpdateConfig?.({ pinnedPlotIds: [] })
  }

  if (!traitRecordId) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Configure this widget to select a data source.
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    )
  }

  const pinnedPlots = allPlots.filter((p) => pinnedPlotIds.includes(p.plotId))

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Search */}
      <div className="relative flex-shrink-0">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          placeholder="Search by plot ID or accession…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-7 h-7 text-xs"
        />
      </div>

      {/* Plot list */}
      <div className="overflow-auto border rounded-md max-h-48 flex-shrink-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs w-8"></TableHead>
              <TableHead className="text-xs">Plot ID</TableHead>
              <TableHead className="text-xs">Accession</TableHead>
              {metricCols.map((m) => (
                <TableHead key={m} className="text-xs">
                  {m.replace(/_/g, " ")}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(0, 50).map((p) => {
              const isPinned = pinnedPlotIds.includes(p.plotId)
              return (
                <TableRow key={p.plotId} className={isPinned ? "bg-primary/5" : ""}>
                  <TableCell className="py-1">
                    <button
                      onClick={() => togglePin(p.plotId)}
                      className={`p-0.5 rounded transition-colors ${
                        isPinned
                          ? "text-primary"
                          : "text-muted-foreground hover:text-primary"
                      }`}
                      title={isPinned ? "Unpin" : "Pin plot"}
                    >
                      {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
                    </button>
                  </TableCell>
                  <TableCell className="text-xs py-1 font-mono">{p.plotId}</TableCell>
                  <TableCell className="text-xs py-1">{p.accession || "—"}</TableCell>
                  {metricCols.map((m) => (
                    <TableCell key={m} className="text-xs py-1">
                      {typeof p.properties[m] === "number"
                        ? (p.properties[m] as number).toFixed(3)
                        : "—"}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pinned comparison */}
      {pinnedPlots.length > 0 && (
        <div className="flex-1 overflow-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">
              Pinned Plots{" "}
              <Badge variant="secondary" className="text-[10px]">
                {pinnedPlots.length}
              </Badge>
            </span>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearPinned}>
              <X className="w-3 h-3 mr-1" /> Clear
            </Button>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(pinnedPlots.length, 3)}, minmax(0, 1fr))` }}>
            {pinnedPlots.map((p) => (
              <div key={p.plotId} className="border rounded-lg p-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-medium truncate">{p.plotId}</span>
                  <button
                    onClick={() => togglePin(p.plotId)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                {p.hasImage ? (
                  <PlotImage recordId={traitRecordId} plotId={p.plotId} />
                ) : (
                  <div className="flex items-center justify-center bg-muted rounded aspect-video">
                    <ImageOff className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}
                {/* Trait values */}
                <div className="space-y-0.5">
                  {metricCols.map((m) => (
                    <div key={m} className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground truncate">{m.replace(/_/g, " ")}</span>
                      <span className="font-medium ml-2">
                        {typeof p.properties[m] === "number"
                          ? (p.properties[m] as number).toFixed(4)
                          : "—"}
                      </span>
                    </div>
                  ))}
                  {p.accession && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">Accession</span>
                      <span className="font-medium ml-2">{p.accession}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pinnedPlots.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-4">
          Pin plots above to compare them side-by-side.
        </p>
      )}
    </div>
  )
}
