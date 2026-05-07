/**
 * NewRunDialog — pick an uploaded dataset to start a Run from.
 *
 * Mirrors `main`'s NewRunDialog: the user filters / scrolls a table of
 * uploaded datasets and picks one. Selecting a row commits the run with
 * the upload's full path-component scope so RunDetail no longer has to
 * re-prompt the user for date / platform / sensor / experiment / etc.
 *
 * The available uploads come from the MinIO listing of `Raw/` (see
 * useAvailableUploads). Pipeline-type filtering (aerial/ground) follows
 * `pipelineKindAccepts`. The picked tuple's experiment *name* is mapped
 * to the GEMINIbase Experiment.id once at submit time so step
 * submissions don't re-resolve it.
 */
import { useNavigate } from "@tanstack/react-router"
import { ImageIcon, Layers } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAllExperiments } from "@/features/experiments/hooks/useExperimentData"
import {
  type AvailableUpload,
  pipelineKindAccepts,
  useAvailableUploads,
} from "@/features/process/hooks/useAvailableUploads"
import {
  createRun,
  type Pipeline,
  type Run,
  useRuns,
} from "@/features/process/lib/runStore"
import useCustomToast from "@/hooks/useCustomToast"

interface NewRunDialogProps {
  pipeline: Pipeline
  workspaceId: string
  open: boolean
  onClose: () => void
}

interface Filters {
  experiment: string
  location: string
  population: string
  date: string
}

function emptyFilters(): Filters {
  return { experiment: "", location: "", population: "", date: "" }
}

function uploadIncludedInRuns(upload: AvailableUpload, runs: Run[]): boolean {
  return runs.some(
    (r) =>
      r.uploadScope?.year === upload.year &&
      r.uploadScope?.experiment === upload.experiment &&
      r.uploadScope?.location === upload.location &&
      r.uploadScope?.population === upload.population &&
      r.uploadScope?.date === upload.date &&
      r.uploadScope?.platform === upload.platform &&
      r.uploadScope?.sensor === upload.sensor &&
      r.uploadScope?.experimentId !== undefined,
  )
}

export function NewRunDialog({
  pipeline,
  workspaceId,
  open,
  onClose,
}: NewRunDialogProps) {
  const navigate = useNavigate()
  const { showErrorToast } = useCustomToast()
  const [selectedId, setSelectedId] = useState<string>("")
  const [filters, setFilters] = useState<Filters>(emptyFilters)

  const { uploads, isLoading } = useAvailableUploads()
  const { data: experiments = [] } = useAllExperiments()
  const runs = useRuns(pipeline.id)

  const acceptedUploads = useMemo(
    () => uploads.filter((u) => pipelineKindAccepts(pipeline.type, u.dataType)),
    [uploads, pipeline.type],
  )

  const filteredUploads = useMemo(() => {
    const f = filters
    return acceptedUploads.filter((u) => {
      if (
        f.experiment &&
        !u.experiment.toLowerCase().includes(f.experiment.toLowerCase())
      ) {
        return false
      }
      if (
        f.location &&
        !u.location.toLowerCase().includes(f.location.toLowerCase())
      ) {
        return false
      }
      if (
        f.population &&
        !u.population.toLowerCase().includes(f.population.toLowerCase())
      ) {
        return false
      }
      if (f.date && !u.date.includes(f.date)) return false
      return true
    })
  }, [acceptedUploads, filters])

  const selected = filteredUploads.find((u) => u.id === selectedId) ?? null

  function setFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  function handleCreate() {
    if (!selected) return
    // Resolve experiment NAME → Experiment.id. The MinIO path captured the
    // experiment name verbatim from the upload form; lookup is exact match.
    const expRow = experiments.find(
      (e) => e.experiment_name === selected.experiment,
    )
    const experimentId = expRow?.id != null ? String(expRow.id) : undefined
    if (!experimentId) {
      showErrorToast(
        `No experiment named "${selected.experiment}" exists. Re-upload under an existing experiment, or create one in the Files tab.`,
      )
      return
    }
    const run = createRun({
      pipelineId: pipeline.id,
      // Display-only: name the run after the upload so the user can spot
      // it in the WorkspaceDetail run list without opening it.
      name: `${selected.date} · ${selected.platform}/${selected.sensor}`,
      scope: {
        experimentId,
        seasonId: null,
        siteId: null,
        populationId: null,
      },
      uploadScope: {
        year: selected.year,
        experiment: selected.experiment,
        location: selected.location,
        population: selected.population,
        date: selected.date,
        platform: selected.platform,
        sensor: selected.sensor,
        experimentId,
      },
    })
    onClose()
    navigate({
      to: "/process/$workspaceId/run/$runId",
      params: { workspaceId, runId: run.id },
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>New Run — {pipeline.name}</DialogTitle>
          <DialogDescription>
            Pick the uploaded dataset to process. The pipeline runs against the
            images at this MinIO scope.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-4 gap-3">
            {(["experiment", "location", "population", "date"] as const).map(
              (field) => (
                <div key={field} className="space-y-1.5">
                  <Label
                    htmlFor={`upload-filter-${field}`}
                    className="text-xs capitalize"
                  >
                    {field}
                  </Label>
                  <Input
                    id={`upload-filter-${field}`}
                    placeholder={`Filter by ${field}…`}
                    value={filters[field]}
                    onChange={(e) => setFilter(field, e.target.value)}
                  />
                </div>
              ),
            )}
          </div>

          <div className="rounded-md border">
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/70 z-10 text-left">
                  <tr>
                    {[
                      "Type",
                      "Experiment",
                      "Site",
                      "Population",
                      "Date",
                      "Platform",
                      "Sensor",
                      "Files",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-2 py-2 font-medium text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-2 py-6 text-center text-muted-foreground"
                      >
                        Loading uploads…
                      </td>
                    </tr>
                  ) : filteredUploads.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-2 py-6 text-center text-muted-foreground"
                      >
                        No uploads match. Upload data via the Files tab first.
                      </td>
                    </tr>
                  ) : (
                    filteredUploads.map((u) => {
                      const included = uploadIncludedInRuns(u, runs)
                      const isSelected = u.id === selectedId
                      return (
                        <tr
                          key={u.id}
                          data-testid="upload-row"
                          aria-selected={isSelected}
                          className={
                            included
                              ? "opacity-50"
                              : isSelected
                                ? "bg-primary/10 cursor-pointer"
                                : "cursor-pointer hover:bg-muted/50"
                          }
                          onClick={() => !included && setSelectedId(u.id)}
                        >
                          <td className="px-2 py-1.5">
                            {u.dataType === "Orthomosaic" ? (
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <Layers className="h-3 w-3" />
                                Ortho
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <ImageIcon className="h-3 w-3" />
                                Images
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 font-medium max-w-[120px] truncate">
                            {u.experiment}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground max-w-[100px] truncate">
                            {u.location}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground max-w-[100px] truncate">
                            {u.population}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">
                            {u.date}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
                            {u.platform}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
                            {u.sensor}
                          </td>
                          <td className="px-2 py-1.5 tabular-nums">
                            {u.fileCount}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={!selected}>
            Create Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
