/**
 * Manage Data → Reference data: every uploaded reference dataset (hand
 * measurements), with the original file to download and a delete.
 *
 * Reference datasets name their experiment / site / population as plain
 * strings rather than belonging to an experiment row, so they get their
 * own section instead of nesting under ExperimentRow.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Download, Trash2 } from "lucide-react"
import { useState } from "react"

import { ReferenceDataService, type ReferenceDatasetOutput } from "@/client"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { idAsString } from "@/features/admin/lib/ids"
import { useReferenceDatasets } from "@/features/analyze/hooks/useScopeReference"
import useCustomToast from "@/hooks/useCustomToast"
import { downloadViaBrowser } from "../lib/download"

/** MinIO object holding the original upload, if the backend kept one. */
export function originalObject(d: ReferenceDatasetOutput): string | null {
  let info: unknown = d.dataset_info
  if (typeof info === "string") {
    try {
      info = JSON.parse(info)
    } catch {
      return null
    }
  }
  const v = (info as { original_object?: unknown } | null)?.original_object
  return typeof v === "string" && v ? v : null
}

export function ReferenceDataSection() {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { showSuccessToast, showErrorToastWithCopy } = useCustomToast()
  const [filter, setFilter] = useState("")
  const datasetsQuery = useReferenceDatasets()

  const deleteMutation = useMutation({
    mutationFn: (datasetId: string) =>
      ReferenceDataService.apiReferenceDataIdDatasetIdDeleteDataset({
        datasetId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reference-data"] })
      showSuccessToast("Reference dataset deleted")
    },
    onError: (err) =>
      showErrorToastWithCopy(
        err instanceof Error ? err.message : "Delete failed",
      ),
  })

  const all = datasetsQuery.data ?? []
  const q = filter.trim().toLowerCase()
  const shown = q
    ? all.filter((d) =>
        [d.name, d.experiment, d.location, d.population].some((v) =>
          (v ?? "").toLowerCase().includes(q),
        ),
      )
    : all

  const onDelete = async (d: ReferenceDatasetOutput) => {
    const id = idAsString(d.id)
    await confirm({
      title: `Delete reference dataset "${d.name}"?`,
      description: (
        <span>
          Removes its {d.plot_count ?? 0} plot rows and the original uploaded
          file. Trait records and imagery are not touched.{" "}
          <strong>This cannot be undone.</strong>
        </span>
      ),
      confirmLabel: "Delete dataset",
      variant: "destructive",
      action: () => deleteMutation.mutateAsync(id),
    })
  }

  const onDownload = async (objectName: string) => {
    try {
      await downloadViaBrowser(objectName)
    } catch (err) {
      showErrorToastWithCopy(
        err instanceof Error ? err.message : "Download failed",
      )
    }
  }

  return (
    <section className="space-y-3" data-testid="reference-data-section">
      <div>
        <h2 className="text-lg font-semibold">Reference data</h2>
        <p className="text-muted-foreground text-sm">
          Hand measurements uploaded as Reference Data. They appear as extra
          columns in Analyze → Table for the matching experiment and site.
        </p>
      </div>
      {all.length > 0 && (
        <Input
          placeholder="Filter reference datasets"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-sm"
          data-testid="reference-data-filter"
        />
      )}
      {datasetsQuery.isLoading ? (
        <div className="text-muted-foreground text-sm">Loading…</div>
      ) : datasetsQuery.isError ? (
        <div className="text-destructive text-sm">
          Failed to load reference datasets.
        </div>
      ) : shown.length === 0 ? (
        <div
          className="text-muted-foreground text-sm"
          data-testid="reference-data-empty"
        >
          {q
            ? "No reference datasets match."
            : "No reference data yet. Upload it from Files → Upload → Reference Data."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-muted-foreground text-xs">
              <tr>
                {[
                  "Name",
                  "Experiment",
                  "Site",
                  "Population",
                  "Date",
                  "Plots",
                  "Traits",
                  "",
                ].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => {
                const obj = originalObject(d)
                return (
                  <tr
                    key={idAsString(d.id)}
                    className="border-t"
                    data-testid={`reference-data-row-${d.name}`}
                  >
                    <td className="px-3 py-2 font-medium">{d.name}</td>
                    <td className="px-3 py-2">{d.experiment || "—"}</td>
                    <td className="px-3 py-2">{d.location || "—"}</td>
                    <td className="px-3 py-2">{d.population || "—"}</td>
                    <td className="px-3 py-2">{d.dataset_date || "—"}</td>
                    <td
                      className="px-3 py-2 tabular-nums"
                      data-testid={`reference-data-plots-${d.name}`}
                    >
                      {d.plot_count ?? 0}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {(d.trait_columns ?? []).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!obj}
                          title={
                            obj
                              ? "Download the original file"
                              : "Uploaded before originals were kept"
                          }
                          onClick={() => obj && onDownload(obj)}
                          data-testid={`reference-data-download-${d.name}`}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Delete dataset"
                          onClick={() => onDelete(d)}
                          data-testid={`reference-data-delete-${d.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
