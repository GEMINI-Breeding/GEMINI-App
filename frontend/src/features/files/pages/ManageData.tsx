/**
 * "Manage" tab — DB-entity browser for the user's imports.
 *
 * Pre-Phase-9e this surface let users pick MinIO objects and remove
 * them directly. That was a misleading UX: a `delete_file` POST removes
 * one object but leaves the import's trait_records, plots, accessions,
 * datasets, experiment_files, and the experiment itself intact in
 * Postgres. The "import" looked deleted but was actually orphaned.
 *
 * Now the page lists experiments (the ownership root for everything an
 * import creates) and offers a single Delete affordance that calls
 * `apiExperimentsIdExperimentIdDeleteExperiment` — that path cascades
 * through dataset → trait records → plots → experiment_files → MinIO
 * sweep, the way a user expects "delete my import" to work. Type-name
 * confirmation gates each delete so an accidental click can't drop a
 * tree.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  ChevronDown,
  ChevronRight,
  Database,
  Dna,
  Download,
  ExternalLink,
  File,
  Trash2,
} from "lucide-react"
import { useState } from "react"

import {
  type DatasetOutput,
  type ExperimentOutput,
  ExperimentsService,
  type FileMetadata,
  FilesService,
  GenotypingStudiesService,
  type GenotypingStudyOutput,
  OpenAPI,
} from "@/client"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { idAsString } from "@/features/admin/lib/ids"
import useCustomToast from "@/hooks/useCustomToast"
import { getToken } from "@/lib/auth"

const DEFAULT_BUCKET = "gemini"

function apiUrl(path: string): string {
  return `${(OpenAPI.BASE ?? "").replace(/\/$/, "")}${path}`
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}

async function downloadViaBrowser(objectPath: string): Promise<void> {
  const url = apiUrl(`/api/files/download/${DEFAULT_BUCKET}/${objectPath}`)
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = objectUrl
  a.download = objectPath.split("/").pop() ?? "download"
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}

export function ManageData() {
  const [filter, setFilter] = useState("")
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToastWithCopy } = useCustomToast()
  const confirm = useConfirm()

  const experimentsQuery = useQuery({
    queryKey: ["experiments", "all"],
    queryFn: async () => {
      const res = await ExperimentsService.apiExperimentsAllGetAllExperiments({
        limit: 500,
        offset: 0,
      })
      return (res as ExperimentOutput[] | null) ?? []
    },
  })

  const filtered = (experimentsQuery.data ?? []).filter((e) => {
    if (!filter.trim()) return true
    return e.experiment_name.toLowerCase().includes(filter.toLowerCase())
  })

  const deleteMutation = useMutation({
    mutationFn: async (experimentId: string) => {
      await ExperimentsService.apiExperimentsIdExperimentIdDeleteExperiment({
        experimentId,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["experiments"] })
      queryClient.invalidateQueries({
        queryKey: ["users", "me", "experiments"],
      })
      showSuccessToast("Experiment deleted")
    },
    onError: (err) => {
      showErrorToastWithCopy(
        err instanceof Error ? err.message : "Delete failed",
      )
    },
  })

  const handleDelete = async (exp: ExperimentOutput) => {
    const id = idAsString(exp.id)
    if (!id) return
    const ok = await confirm({
      title: `Delete experiment "${exp.experiment_name}"?`,
      description: (
        <span>
          This permanently removes the experiment and everything it owns —
          datasets, plots, accessions, trait records, and any uploaded files in
          MinIO. <strong>This cannot be undone.</strong>
        </span>
      ),
      confirmLabel: "Delete experiment",
      variant: "destructive",
      requireTypedName: exp.experiment_name,
      action: () => deleteMutation.mutateAsync(id),
    })
    if (!ok) return
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Manage Data</h1>
        <p className="text-muted-foreground">
          Browse experiments and their datasets. Deleting an experiment here
          cascades through every import it owns.
        </p>
      </div>

      <Input
        placeholder="Filter by experiment name"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="max-w-sm"
        data-testid="manage-data-filter"
      />

      {experimentsQuery.isLoading ? (
        <div className="text-muted-foreground text-sm">
          Loading experiments…
        </div>
      ) : experimentsQuery.isError ? (
        <div className="text-destructive text-sm">
          Failed to load experiments:{" "}
          {experimentsQuery.error instanceof Error
            ? experimentsQuery.error.message
            : "unknown error"}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          hasAny={(experimentsQuery.data?.length ?? 0) > 0}
          filtering={filter.trim().length > 0}
        />
      ) : (
        <div
          className="rounded-md border divide-y"
          data-testid="manage-data-experiment-list"
        >
          {filtered.map((exp) => (
            <ExperimentRow
              key={idAsString(exp.id)}
              experiment={exp}
              onDelete={() => handleDelete(exp)}
              deleting={
                deleteMutation.isPending &&
                deleteMutation.variables === idAsString(exp.id)
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ExperimentRow({
  experiment,
  onDelete,
  deleting,
}: {
  experiment: ExperimentOutput
  onDelete: () => void
  deleting: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const expId = idAsString(experiment.id)
  const { showErrorToastWithCopy } = useCustomToast()

  const datasetsQuery = useQuery({
    queryKey: ["experiments", expId, "datasets"],
    queryFn: async () => {
      if (!expId) return []
      const res =
        await ExperimentsService.apiExperimentsIdExperimentIdDatasetsGetExperimentDatasets(
          { experimentId: expId },
        )
      return (res as DatasetOutput[] | null) ?? []
    },
    enabled: expanded && Boolean(expId),
  })

  // Genotyping studies tied to this experiment. Surfaced as a section
  // under the experiment because: (a) the genomic-import wizard creates
  // these but their files don't live under `Raw/{experiment_name}/`
  // (they're under `genotyping/{study_id}/`), so without this section
  // a user who imported genomic data sees nothing here even though the
  // import succeeded; (b) clicking through opens `/genotyping/{id}` for
  // the full per-study detail page.
  const studiesQuery = useQuery({
    queryKey: ["experiments", expId, "genotyping_studies"],
    queryFn: async () => {
      const res =
        await GenotypingStudiesService.apiGenotypingStudiesSearchStudies({
          experimentName: experiment.experiment_name,
        })
      return (res as GenotypingStudyOutput[] | null) ?? []
    },
    enabled: expanded,
  })

  // List files under Raw/ + Processed/ + genotyping/ that belong to
  // this experiment. The backend's list endpoint walks one prefix at a
  // time, so we fetch each top-level prefix and filter client-side.
  // Raw/Processed are filtered by experiment name (matches our upload
  // path convention `Raw/{date}/{experiment_name}/...`); genotyping/
  // is filtered by the ids of studies tied to this experiment.
  const filesQuery = useQuery({
    queryKey: [
      "experiments",
      expId,
      "files",
      // Re-key on study ids so a fresh genomic import refreshes the
      // file list without needing a hard reload.
      (studiesQuery.data ?? [])
        .map((s) => idAsString(s.id))
        .sort()
        .join(","),
    ],
    queryFn: async () => {
      const out: FileMetadata[] = []
      const studyIds = new Set(
        (studiesQuery.data ?? [])
          .map((s) => idAsString(s.id))
          .filter((s): s is string => Boolean(s)),
      )

      for (const top of ["Raw", "Processed"]) {
        try {
          const res = await FilesService.apiFilesListFilePathListFiles({
            filePath: `${DEFAULT_BUCKET}/${top}`,
          })
          const list = (res as FileMetadata[] | null) ?? []
          for (const f of list) {
            if (f.object_name.includes(`/${experiment.experiment_name}/`)) {
              out.push(f)
            }
          }
        } catch {
          // Empty prefix returns 404; ignore — `out` may be partial but
          // that's fine for the read-only browse.
        }
      }

      if (studyIds.size > 0) {
        try {
          const res = await FilesService.apiFilesListFilePathListFiles({
            filePath: `${DEFAULT_BUCKET}/genotyping`,
          })
          const list = (res as FileMetadata[] | null) ?? []
          for (const f of list) {
            // Layout: `genotyping/{study_id}/...`
            const segs = f.object_name.split("/")
            const sid = segs.length >= 2 ? segs[1] : ""
            if (sid && studyIds.has(sid)) out.push(f)
          }
        } catch {
          // Empty prefix returns 404; ignore.
        }
      }

      return out
    },
    enabled: expanded && !studiesQuery.isLoading,
  })

  const handleDownload = async (objectPath: string) => {
    try {
      await downloadViaBrowser(objectPath)
    } catch (err) {
      showErrorToastWithCopy(
        err instanceof Error ? err.message : "Download failed",
      )
    }
  }

  return (
    <div data-testid={`manage-data-experiment-${experiment.experiment_name}`}>
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setExpanded((v) => !v)}
          className="h-7 w-7 p-0"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </Button>
        <Database className="text-muted-foreground h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div
            className="truncate font-medium"
            title={experiment.experiment_name}
          >
            {experiment.experiment_name}
          </div>
          <div className="text-muted-foreground text-xs">
            {experiment.experiment_start_date && (
              <>
                Started {experiment.experiment_start_date}
                {experiment.experiment_end_date
                  ? ` → ${experiment.experiment_end_date}`
                  : ""}
              </>
            )}
          </div>
        </div>
        <LoadingButton
          size="sm"
          variant="ghost"
          loading={deleting}
          onClick={onDelete}
          title="Delete experiment"
          data-testid={`manage-data-delete-${experiment.experiment_name}`}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </LoadingButton>
      </div>
      {expanded && (
        <div className="bg-muted/20 border-t px-12 py-3 space-y-4">
          <section>
            <div className="text-muted-foreground mb-2 text-xs uppercase tracking-wide">
              Datasets
            </div>
            {datasetsQuery.isLoading ? (
              <div className="text-muted-foreground text-sm">Loading…</div>
            ) : datasetsQuery.isError ? (
              <div className="text-destructive text-sm">
                Failed to load datasets.
              </div>
            ) : (datasetsQuery.data?.length ?? 0) === 0 ? (
              <div className="text-muted-foreground text-sm">
                No datasets in this experiment.
              </div>
            ) : (
              <ul className="space-y-1 text-sm">
                {(datasetsQuery.data ?? []).map((ds) => (
                  <li
                    key={idAsString(ds.id)}
                    className="flex items-center gap-2"
                    data-testid={`manage-data-dataset-${ds.dataset_name ?? ""}`}
                  >
                    <span className="font-mono text-xs">{ds.dataset_name}</span>
                    {ds.collection_date && (
                      <span className="text-muted-foreground text-xs">
                        · {ds.collection_date}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="text-muted-foreground mb-2 text-xs uppercase tracking-wide">
              Genotyping Studies
            </div>
            {studiesQuery.isLoading ? (
              <div className="text-muted-foreground text-sm">Loading…</div>
            ) : studiesQuery.isError ? (
              <div className="text-destructive text-sm">
                Failed to load studies.
              </div>
            ) : (studiesQuery.data?.length ?? 0) === 0 ? (
              <div className="text-muted-foreground text-sm">
                No genotyping studies in this experiment.
              </div>
            ) : (
              <ul className="space-y-1 text-sm">
                {(studiesQuery.data ?? []).map((s) => (
                  <StudyRow key={idAsString(s.id)} study={s} />
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="text-muted-foreground mb-2 text-xs uppercase tracking-wide">
              Files
            </div>
            <FileList
              files={filesQuery.data ?? []}
              loading={filesQuery.isLoading}
              error={filesQuery.isError ? filesQuery.error : null}
              onDownload={handleDownload}
            />
          </section>
        </div>
      )}
    </div>
  )
}

function FileList({
  files,
  loading,
  error,
  onDownload,
}: {
  files: FileMetadata[]
  loading: boolean
  error: Error | null
  onDownload: (objectPath: string) => void
}) {
  if (loading) {
    return <div className="text-muted-foreground text-sm">Loading files…</div>
  }
  if (error) {
    return <div className="text-destructive text-sm">Failed to list files.</div>
  }
  if (files.length === 0) {
    return (
      <div className="text-muted-foreground text-sm">
        No files for this experiment yet.
      </div>
    )
  }
  return (
    <div
      className="rounded-md border bg-background divide-y"
      data-testid="manage-data-list"
    >
      {files.map((f) => (
        <div
          key={f.object_name}
          className="flex items-center gap-3 px-3 py-2 text-sm"
        >
          <File className="text-muted-foreground h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-xs" title={f.object_name}>
              {f.object_name}
            </div>
            <div className="text-muted-foreground text-xs">
              {formatBytes(f.size)} • {f.last_modified}
              {f.content_type ? ` • ${f.content_type}` : ""}
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDownload(f.object_name)}
            title="Download"
            data-testid={`download-${f.object_name}`}
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  )
}

function StudyRow({ study }: { study: GenotypingStudyOutput }) {
  const navigate = useNavigate()
  const sid = idAsString(study.id)
  return (
    <li
      className="flex items-center gap-2"
      data-testid={`manage-data-study-${study.study_name ?? ""}`}
    >
      <Dna className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
      <span className="font-medium">{study.study_name ?? "(unnamed)"}</span>
      {sid && (
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-6 px-2"
          onClick={() =>
            navigate({
              to: "/genotyping/$studyId",
              params: { studyId: sid },
            })
          }
          title="Open study"
        >
          Open
          <ExternalLink className="ml-1 h-3 w-3" />
        </Button>
      )}
    </li>
  )
}

function EmptyState({
  hasAny,
  filtering,
}: {
  hasAny: boolean
  filtering: boolean
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Database className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold">
        {hasAny && filtering
          ? "No experiments match your filter"
          : "No experiments yet"}
      </h3>
      <p className="text-muted-foreground">
        {hasAny && filtering
          ? "Try a different search term."
          : "Use the Upload tab to create one."}
      </p>
    </div>
  )
}
