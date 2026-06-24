import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Trash2, Download, Search } from "lucide-react"
import { ReferenceDataService, type ReferenceDatasetPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import useCustomToast from "@/hooks/useCustomToast"

export function ManageReferenceData() {
  const queryClient = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const [search, setSearch] = useState("")
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const { data: datasets = [], isLoading } = useQuery({
    queryKey: ["reference-data-all"],
    queryFn: () => ReferenceDataService.listDatasets(),
  })

  const deleteMutation = useMutation({
    mutationFn: (datasetId: string) =>
      ReferenceDataService.deleteDataset({ datasetId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reference-data-all"] })
      showSuccessToast("Reference dataset deleted.")
      setConfirmId(null)
    },
    onError: () => showErrorToast("Failed to delete dataset"),
  })

  const filtered = (datasets as ReferenceDatasetPublic[]).filter((d) => {
    const q = search.toLowerCase()
    return (
      d.name.toLowerCase().includes(q) ||
      d.experiment.toLowerCase().includes(q) ||
      d.location.toLowerCase().includes(q) ||
      d.population.toLowerCase().includes(q)
    )
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-[220px] pl-8"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-12">
          <div className="rounded-full bg-muted p-4 mb-4">
            <Search className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">
            {search ? "No datasets match your search" : "No reference datasets yet"}
          </h3>
          <p className="text-muted-foreground">
            {search ? "Try a different search term" : "Upload reference data in the Upload tab"}
          </p>
        </div>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr>
                {["Name", "Experiment", "Location", "Population", "Date", "Plots", "File", ""].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground text-xs">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id} className="border-t hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2.5 font-medium max-w-[180px] truncate">{d.name}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{d.experiment || "—"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{d.location || "—"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{d.population || "—"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{d.date || "—"}</td>
                  <td className="px-3 py-2.5 tabular-nums">{d.plot_count}</td>
                  <td className="px-3 py-2.5 text-muted-foreground text-xs truncate max-w-[140px]">
                    {d.original_filename ?? "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1">
                      {d.original_filename && (
                        <a
                          href={`/api/v1/reference-data/${d.id}/download`}
                          download={d.original_filename}
                          className="inline-flex items-center justify-center rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title="Download original file"
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      )}
                      {confirmId === d.id ? (
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 text-xs px-2"
                            onClick={() => deleteMutation.mutate(d.id)}
                            disabled={deleteMutation.isPending}
                          >
                            {deleteMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs px-2"
                            onClick={() => setConfirmId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <button
                          className="inline-flex items-center justify-center rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Delete dataset"
                          onClick={() => setConfirmId(d.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
