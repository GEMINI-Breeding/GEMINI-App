import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bookmark, ExternalLink, Search, Sparkles, Trophy } from "lucide-react"
import { useState } from "react"
import { type AgmlDatasetPublic, AgmlService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useCustomToast from "@/hooks/useCustomToast"

const ML_TASK_OPTIONS = [
  { value: "image_classification", label: "Classification" },
  { value: "object_detection", label: "Detection" },
  { value: "semantic_segmentation", label: "Segmentation" },
  { value: "image_regression", label: "Regression" },
]

interface DatasetsDashboardProps {
  initialMlTask?: string
}

function formatLocation(location: AgmlDatasetPublic["location"]): string {
  if (!location) return "—"
  const parts = [location.country, location.continent].filter(Boolean)
  return parts.length ? parts.join(", ") : "—"
}

function DatasetCard({
  dataset,
  onOpen,
}: {
  dataset: AgmlDatasetPublic
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left rounded-lg border p-3 transition-colors hover:border-primary/50 hover:bg-primary/5"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium truncate">{dataset.name}</p>
        {dataset.selected && (
          <Bookmark className="h-3.5 w-3.5 shrink-0 fill-primary text-primary" />
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {dataset.ml_task && (
          <Badge variant="outline" className="text-[10px]">
            {dataset.ml_task}
          </Badge>
        )}
        {dataset.ag_task && (
          <Badge variant="secondary" className="text-[10px]">
            {dataset.ag_task}
          </Badge>
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {formatLocation(dataset.location)}
        {dataset.n_images != null && ` · ${dataset.n_images.toLocaleString()} images`}
      </p>
    </button>
  )
}

function DatasetDetailDialog({
  name,
  onClose,
}: {
  name: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const { data: dataset, isLoading } = useQuery({
    queryKey: ["agml-dataset", name],
    queryFn: () => AgmlService.getDataset({ name }),
  })
  const { data: similar } = useQuery({
    queryKey: ["agml-similar", name],
    queryFn: () => AgmlService.getSimilarDatasets({ name, limit: 5 }),
  })
  const { data: benchmarks } = useQuery({
    queryKey: ["agml-benchmarks", name],
    queryFn: () => AgmlService.getDatasetBenchmarks({ name }) as Promise<{
      dataset: string
      results: { model: string | null; metrics: Record<string, number> | null }[]
    }>,
  })

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["agml-datasets"] })
    queryClient.invalidateQueries({ queryKey: ["agml-selected"] })
    queryClient.invalidateQueries({ queryKey: ["agml-dataset", name] })
    queryClient.invalidateQueries({ queryKey: ["agml-similar"] })
  }

  const selectMutation = useMutation({
    mutationFn: () =>
      AgmlService.selectDataset({ requestBody: { dataset_name: name } }),
    onSuccess: () => {
      invalidateAll()
      showSuccessToast(`"${name}" added to selected datasets`)
    },
    onError: () => showErrorToast("Failed to select dataset"),
  })

  const unselectMutation = useMutation({
    mutationFn: () => AgmlService.unselectDataset({ name }),
    onSuccess: () => {
      invalidateAll()
      showSuccessToast(`"${name}" removed from selected datasets`)
    },
    onError: () => showErrorToast("Failed to remove dataset"),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="break-all">{name}</DialogTitle>
          {dataset?.docs_url && (
            <DialogDescription>
              <a
                href={dataset.docs_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs underline hover:text-foreground"
              >
                Source docs <ExternalLink className="h-3 w-3" />
              </a>
            </DialogDescription>
          )}
        </DialogHeader>

        {isLoading || !dataset ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Task</p>
                <p>{dataset.ml_task ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ag task</p>
                <p>{dataset.ag_task ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Location</p>
                <p>{formatLocation(dataset.location)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground"># Images</p>
                <p>{dataset.n_images?.toLocaleString() ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Sensor</p>
                <p>{dataset.sensor_modality ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Platform</p>
                <p>{dataset.platform ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Real / synthetic</p>
                <p>{dataset.real_synthetic ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Annotation format</p>
                <p>{dataset.annotation_format ?? "—"}</p>
              </div>
            </div>

            <Button
              size="sm"
              variant={dataset.selected ? "outline" : "default"}
              disabled={selectMutation.isPending || unselectMutation.isPending}
              onClick={() =>
                dataset.selected ? unselectMutation.mutate() : selectMutation.mutate()
              }
            >
              <Bookmark className="mr-1.5 h-3.5 w-3.5" />
              {dataset.selected ? "Remove from selected" : "Select for training"}
            </Button>

            {benchmarks && benchmarks.results.length > 0 && (
              <div className="border-t pt-3">
                <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <Trophy className="h-3 w-3" /> Prior model results
                </p>
                <div className="space-y-1">
                  {benchmarks.results.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded border px-2 py-1 text-xs"
                    >
                      <span>{r.model ?? "(baseline)"}</span>
                      <span className="font-mono text-muted-foreground">
                        {r.metrics
                          ? Object.entries(r.metrics)
                              .map(([k, v]) => `${k}: ${typeof v === "number" ? v.toFixed(3) : v}`)
                              .join(" · ")
                          : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {similar && similar.candidates.length > 0 && (
              <div className="border-t pt-3">
                <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <Sparkles className="h-3 w-3" /> Similar datasets
                </p>
                <div className="space-y-1">
                  {similar.candidates.map((c) => (
                    <div
                      key={c.name}
                      className="flex items-center justify-between rounded border px-2 py-1 text-xs"
                    >
                      <span>{c.name}</span>
                      <span className="text-muted-foreground">
                        {c.n_images != null ? `${c.n_images.toLocaleString()} images` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function BrowseTab({
  initialMlTask,
  onOpen,
}: {
  initialMlTask?: string
  onOpen: (name: string) => void
}) {
  const [mlTask, setMlTask] = useState(initialMlTask ?? "")
  const [search, setSearch] = useState("")

  const { data: datasets, isLoading } = useQuery({
    queryKey: ["agml-datasets", mlTask, search],
    queryFn: () =>
      AgmlService.listDatasets({
        mlTask: mlTask || undefined,
        search: search || undefined,
      }),
  })

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search dataset names…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={mlTask || "all"} onValueChange={(v) => setMlTask(v === "all" ? "" : v)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Task" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tasks</SelectItem>
            {ML_TASK_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : !datasets || datasets.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No datasets match these filters.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {datasets.length.toLocaleString()} dataset{datasets.length !== 1 && "s"}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 max-h-[60vh] overflow-y-auto pr-1">
            {datasets.slice(0, 300).map((d) => (
              <DatasetCard key={d.name} dataset={d} onOpen={() => onOpen(d.name)} />
            ))}
          </div>
          {datasets.length > 300 && (
            <p className="text-xs text-muted-foreground">
              Showing the first 300 of {datasets.length.toLocaleString()} — narrow your
              search or task filter to see more specific results.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function SelectedTab({ onOpen }: { onOpen: (name: string) => void }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const { data: selected, isLoading } = useQuery({
    queryKey: ["agml-selected"],
    queryFn: () => AgmlService.listSelected(),
  })

  const unselectMutation = useMutation({
    mutationFn: (name: string) => AgmlService.unselectDataset({ name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agml-selected"] })
      queryClient.invalidateQueries({ queryKey: ["agml-datasets"] })
      showSuccessToast("Removed from selected datasets")
    },
    onError: () => showErrorToast("Failed to remove dataset"),
  })

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (!selected || selected.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        No datasets selected yet. Browse the catalog and mark datasets you're
        considering for future training.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {selected.map((row) => (
        <div
          key={row.dataset_name}
          className="flex items-center justify-between rounded-md border p-3"
        >
          <button
            type="button"
            className="text-left"
            onClick={() => onOpen(row.dataset_name)}
          >
            <p className="text-sm font-medium">{row.dataset_name}</p>
            {row.dataset_metadata?.ml_task && (
              <p className="text-xs text-muted-foreground">
                {row.dataset_metadata.ml_task}
                {row.dataset_metadata.n_images != null &&
                  ` · ${row.dataset_metadata.n_images.toLocaleString()} images`}
              </p>
            )}
            {row.notes && <p className="text-xs text-muted-foreground italic">{row.notes}</p>}
          </button>
          <Button
            size="sm"
            variant="ghost"
            disabled={unselectMutation.isPending}
            onClick={() => unselectMutation.mutate(row.dataset_name)}
          >
            Remove
          </Button>
        </div>
      ))}
    </div>
  )
}

function LeaderboardTab() {
  const { data: leaderboard, isLoading } = useQuery({
    queryKey: ["agml-leaderboard"],
    queryFn: () => AgmlService.getLeaderboard(),
  })

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }

  const models = leaderboard?.models ?? []

  if (models.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Leaderboard coming soon — AgML doesn't yet publish a live benchmark
        feed.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Source: {leaderboard?.source ?? "unknown"}
      </p>
      <div className="max-h-[60vh] overflow-y-auto space-y-1 pr-1">
        {models.map((entry: any, i: number) => (
          <div
            key={i}
            className="flex items-center justify-between rounded border px-3 py-2 text-xs"
          >
            <div>
              <span className="font-medium">{entry.dataset}</span>
              {entry.model && (
                <span className="text-muted-foreground"> · {entry.model}</span>
              )}
            </div>
            <span className="font-mono text-muted-foreground">
              {entry.metrics
                ? Object.entries(entry.metrics as Record<string, number>)
                    .slice(0, 2)
                    .map(([k, v]) => `${k}: ${typeof v === "number" ? v.toFixed(3) : v}`)
                    .join(" · ")
                : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DatasetsDashboard({ initialMlTask }: DatasetsDashboardProps) {
  const [openDataset, setOpenDataset] = useState<string | null>(null)
  const [tab, setTab] = useState("browse")

  return (
    <div className="mx-auto max-w-5xl p-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">AgML Datasets</h1>
        <p className="text-muted-foreground text-sm">
          Browse public agricultural ML datasets, view their metadata, and
          select ones you're considering for future model training.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="sr-only">Datasets</CardTitle>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="browse">Browse</TabsTrigger>
              <TabsTrigger value="selected">Selected</TabsTrigger>
              <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="pt-6">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsContent value="browse">
              <BrowseTab initialMlTask={initialMlTask} onOpen={setOpenDataset} />
            </TabsContent>
            <TabsContent value="selected">
              <SelectedTab onOpen={setOpenDataset} />
            </TabsContent>
            <TabsContent value="leaderboard">
              <LeaderboardTab />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {openDataset && (
        <DatasetDetailDialog name={openDataset} onClose={() => setOpenDataset(null)} />
      )}
    </div>
  )
}
