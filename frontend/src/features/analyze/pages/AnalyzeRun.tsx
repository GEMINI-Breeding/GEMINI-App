import { useMemo, useState } from "react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft, Loader2, AlertCircle } from "lucide-react"
import { analyzeApi, type AnalyzableRun } from "../api"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TraitMap } from "../components/TraitMap"
import { RunSidebar } from "../components/RunSidebar"
import { TraitsTable } from "../components/TraitsTable"
import { TraitHistogram } from "../components/TraitHistogram"

// ── CSV export ─────────────────────────────────────────────────────────────────

function featuresToCsv(features: GeoJSON.Feature[]): string {
  if (features.length === 0) return ""
  const cols = [...new Set(features.flatMap((f) => Object.keys(f.properties ?? {})))]
  const header = cols.join(",")
  const lines = features.map((f) =>
    cols.map((c) => {
      const v = f.properties?.[c]
      return typeof v === "string" && v.includes(",") ? `"${v}"` : String(v ?? "")
    }).join(","),
  )
  return [header, ...lines].join("\n")
}

function downloadCsv(content: string, name: string) {
  const blob = new Blob([content], { type: "text/csv" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AnalyzeRun() {
  const navigate = useNavigate()
  const { runId } = useParams({ from: "/_layout/analyze/$runId" })

  const [selectedMetric, setSelectedMetric] = useState<string | null>(null)
  const [selectedAccession, setSelectedAccession] = useState("__all__")

  // ── Data fetching ────────────────────────────────────────────────────────────

  const { data: runList = [] } = useQuery({
    queryKey: ["analyze-runs"],
    queryFn: analyzeApi.listRuns,
    staleTime: 30_000,
  })

  const runMeta: AnalyzableRun | null = useMemo(
    () => runList.find((r) => r.run_id === runId) ?? null,
    [runList, runId],
  )

  const {
    data: traitsData,
    isLoading: traitsLoading,
    error: traitsError,
  } = useQuery({
    queryKey: ["analyze-traits", runId],
    queryFn: () => analyzeApi.getTraits(runId),
  })

  const { data: orthoInfo } = useQuery({
    queryKey: ["analyze-ortho", runId],
    queryFn: () => analyzeApi.getOrthoInfo(runId),
  })

  // ── Derived ──────────────────────────────────────────────────────────────────

  const geojson = traitsData?.geojson ?? null
  const metricColumns = traitsData?.metric_columns ?? []
  const effectiveMetric = selectedMetric ?? metricColumns[0] ?? null

  const accessions: string[] = useMemo(() => {
    if (!geojson) return []
    const set = new Set<string>()
    geojson.features.forEach((f) => {
      const a = f.properties?.accession
      if (a) set.add(String(a))
    })
    return [...set].sort()
  }, [geojson])

  const filteredIds: Set<string> | null = useMemo(() => {
    if (!geojson || selectedAccession === "__all__") return null
    return new Set(
      geojson.features
        .filter((f) => String(f.properties?.accession ?? "") === selectedAccession)
        .map((f) => String(f.properties?.plot_id ?? f.properties?.accession ?? "")),
    )
  }, [geojson, selectedAccession])

  const filteredFeatures = useMemo(() => {
    if (!geojson) return []
    if (filteredIds == null) return geojson.features
    return geojson.features.filter((f) =>
      filteredIds.has(String(f.properties?.plot_id ?? f.properties?.accession ?? "")),
    )
  }, [geojson, filteredIds])

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function handleDownloadAll() {
    if (!geojson) return
    downloadCsv(featuresToCsv(geojson.features), `traits_${runId}.csv`)
  }

  function handleDownloadFiltered() {
    downloadCsv(featuresToCsv(filteredFeatures), `traits_${runId}_filtered.csv`)
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 64px)" }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b flex-shrink-0">
        <Button variant="ghost" size="icon" onClick={() => navigate({ to: "/analyze" })}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold truncate">
            {runMeta?.pipeline_name ?? "Run"} — {runMeta?.date ?? runId}
          </h1>
          {runMeta && (
            <p className="text-xs text-muted-foreground">
              {[runMeta.experiment, runMeta.location, runMeta.population].filter(Boolean).join(" / ")} ·{" "}
              {runMeta.platform} · {runMeta.sensor}
            </p>
          )}
        </div>
      </div>

      {/* Body */}
      <Tabs defaultValue="map" className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-4 mt-3 self-start">
          <TabsTrigger value="map">Map</TabsTrigger>
          <TabsTrigger value="stats">Stats</TabsTrigger>
        </TabsList>

        {/* MAP TAB */}
        <TabsContent value="map" className="flex-1 flex min-h-0 mt-0 p-0 data-[state=inactive]:hidden">
          {traitsLoading ? (
            <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading traits…
            </div>
          ) : traitsError ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
              <AlertCircle className="w-8 h-8" />
              <p className="text-sm">Could not load trait data for this run.</p>
            </div>
          ) : (
            <>
              <div className="flex-1 relative">
                <TraitMap
                  geojson={geojson}
                  orthoInfo={orthoInfo ?? null}
                  selectedMetric={effectiveMetric}
                  filteredIds={filteredIds}
                />
              </div>
              {runMeta && (
                <RunSidebar
                  run={runMeta}
                  metricColumns={metricColumns}
                  selectedMetric={effectiveMetric}
                  onMetricChange={setSelectedMetric}
                  accessions={accessions}
                  selectedAccession={selectedAccession}
                  onAccessionChange={setSelectedAccession}
                  onDownloadAll={handleDownloadAll}
                  onDownloadFiltered={handleDownloadFiltered}
                  hasFilter={selectedAccession !== "__all__"}
                />
              )}
            </>
          )}
        </TabsContent>

        {/* STATS TAB */}
        <TabsContent value="stats" className="flex-1 overflow-auto p-4 mt-0">
          {traitsLoading ? (
            <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading traits…
            </div>
          ) : traitsError || !geojson ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2 text-muted-foreground">
              <AlertCircle className="w-8 h-8" />
              <p className="text-sm">No trait data available for this run.</p>
            </div>
          ) : (
            <div className="space-y-8 max-w-5xl">
              <section>
                <h2 className="text-sm font-semibold mb-3">Table</h2>
                <TraitsTable geojson={geojson} />
              </section>
              <section>
                <h2 className="text-sm font-semibold mb-3">Distribution</h2>
                <TraitHistogram
                  geojson={geojson}
                  metricColumns={metricColumns}
                  initialMetric={effectiveMetric}
                />
              </section>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
