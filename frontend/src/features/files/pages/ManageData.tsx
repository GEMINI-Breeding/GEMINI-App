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
 *
 * An expanded experiment reads as what it holds: uploads and results, by
 * season and field date (lib/experimentContents). Files are listed per
 * upload, a page at a time, only when asked for: listing the whole store
 * to filter it here took minutes on a real field season.
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
  Eye,
  File,
  FolderOpen,
  LayoutGrid,
  List as ListIcon,
  Pencil,
  Trash2,
} from "lucide-react"
import { useMemo, useState } from "react"

import {
  type DatasetOutput,
  DatasetsService,
  type ExperimentOutput,
  ExperimentsService,
  type FileMetadata,
  FilesService,
  GenotypingStudiesService,
  type GenotypingStudyOutput,
} from "@/client"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { idAsString } from "@/features/admin/lib/ids"
import {
  AuthImage,
  thumbnailSrc,
} from "@/features/genotyping/components/AuthImage"
import useCustomToast from "@/hooks/useCustomToast"
import { EditUploadDialog } from "../components/EditUploadDialog"
import { ImageLightbox } from "../components/ImageLightbox"
import {
  isViewableCsv,
  MetadataViewerDialog,
} from "../components/MetadataViewerDialog"
import { ReferenceDataSection } from "../components/ReferenceDataSection"
import {
  DEFAULT_BUCKET,
  downloadViaBrowser,
  downloadZip,
} from "../lib/download"
import {
  bySeason,
  classify,
  dayOf,
  type Entry,
  type ResultEntry,
  type UploadEntry,
  uploadFolder,
} from "../lib/experimentContents"

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`
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
          Each experiment's uploads and results, by season. Deleting an
          experiment removes everything it owns.
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

      <ReferenceDataSection />
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

  // One small call per experiment, also used for the summary line, so it
  // loads with the list rather than on expand.
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
    enabled: Boolean(expId),
  })

  // Genotyping studies tied to this experiment: their files live under
  // `genotyping/{study_id}/`, not the experiment's folders, so without this
  // section a genomic import would look missing here.
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

  const entries = useMemo(
    () => (datasetsQuery.data ?? []).map(classify),
    [datasetsQuery.data],
  )
  const uploads = entries.filter((e): e is UploadEntry => e.kind === "upload")
  const results = entries.filter((e): e is ResultEntry => e.kind === "result")
  const seasons = Array.from(
    new Set(
      entries.map((e) => e.where?.season).filter((x): x is string => !!x),
    ),
  ).sort()

  const summary = datasetsQuery.isLoading
    ? "…"
    : [
        seasons.length
          ? `${seasons.length === 1 ? "Season" : "Seasons"} ${seasons.join(", ")}`
          : null,
        `${uploads.length} upload${uploads.length === 1 ? "" : "s"}`,
        `${results.length} result${results.length === 1 ? "" : "s"}`,
      ]
        .filter(Boolean)
        .join(" · ")

  return (
    <div data-testid={`manage-data-experiment-${experiment.experiment_name}`}>
      <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-label={expanded ? "Collapse" : "Expand"}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0" />
          )}
          <Database className="text-muted-foreground h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div
              className="truncate font-medium"
              title={experiment.experiment_name}
            >
              {experiment.experiment_name}
            </div>
            <div className="text-muted-foreground text-xs">{summary}</div>
          </div>
        </button>
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
        <div className="bg-muted/20 space-y-5 border-t px-4 py-4 sm:px-8">
          {datasetsQuery.isLoading ? (
            <div className="text-muted-foreground text-sm">Loading…</div>
          ) : datasetsQuery.isError ? (
            <div className="text-destructive text-sm">
              Failed to load this experiment's data.
            </div>
          ) : (
            <>
              <UploadsSection
                experiment={experiment.experiment_name}
                experimentId={expId}
                uploads={uploads}
              />
              <ResultsSection experimentId={expId} results={results} />
            </>
          )}

          {(studiesQuery.data?.length ?? 0) > 0 && (
            <section>
              <SectionTitle
                title="Genotyping studies"
                note="Marker data imported for this experiment."
              />
              <ul className="space-y-1 text-sm">
                {(studiesQuery.data ?? []).map((s) => (
                  <StudyRow key={idAsString(s.id)} study={s} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {note && <p className="text-muted-foreground text-xs">{note}</p>}
    </div>
  )
}

function SeasonHeading({
  season,
  count,
}: {
  season: string | null
  count: number
}) {
  return (
    <div className="text-muted-foreground bg-muted/40 px-3 py-1 text-xs font-medium">
      {season ? `${season} season` : "Season not recorded"}
      <span className="font-normal"> · {count}</span>
    </div>
  )
}

function UploadsSection({
  experiment,
  experimentId,
  uploads,
}: {
  experiment: string
  experimentId: string | null
  uploads: UploadEntry[]
}) {
  return (
    <section>
      <SectionTitle
        title="Uploads"
        note="Data brought into the app, by season and the date it was collected."
      />
      {uploads.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing uploaded to this experiment yet.
        </p>
      ) : (
        <div className="bg-background overflow-hidden rounded-md border">
          {bySeason(uploads).map((g) => (
            <div key={g.season ?? "unknown"}>
              <SeasonHeading season={g.season} count={g.entries.length} />
              <ul className="divide-y">
                {g.entries.map((e) => (
                  <DatasetRow
                    key={idAsString(e.dataset.id)}
                    entry={e}
                    experiment={experiment}
                    experimentId={experimentId}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

const MADE_BY: Record<ResultEntry["madeBy"], string> = {
  agent: "Agent",
  model: "Model run",
  pipeline: "Pipeline",
}

function ResultsSection({
  experimentId,
  results,
}: {
  experimentId: string | null
  results: ResultEntry[]
}) {
  const [open, setOpen] = useState(results.length <= 8)
  if (results.length === 0) return null
  return (
    <section>
      <button
        type="button"
        className="mb-2 flex items-center gap-1 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <span className="text-sm font-semibold">Results</span>
        <span className="text-muted-foreground text-xs">
          · {results.length} · measurements the pipeline, a model or the agent
          saved (they show in Analyze)
        </span>
      </button>
      {open && (
        <div className="bg-background overflow-hidden rounded-md border">
          {bySeason(results).map((g) => (
            <div key={g.season ?? "unknown"}>
              <SeasonHeading season={g.season} count={g.entries.length} />
              <ul className="divide-y">
                {g.entries.map((e) => (
                  <DatasetRow
                    key={idAsString(e.dataset.id)}
                    entry={e}
                    experiment=""
                    experimentId={experimentId}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * One upload or result. Deleting goes through `apiDatasetsIdDatasetIdDeleteDataset`
 * — `Dataset.delete()` on the backend removes the files uploaded under this
 * batch, the record rows that reference it, and its `dataset_data/` prefix.
 * A plain Yes/No confirm (dataset names are long auto-names; typing one would
 * be hostile); deleting a whole experiment keeps its type-the-name gate.
 */
function DatasetRow({
  entry,
  experiment,
  experimentId,
}: {
  entry: Entry
  experiment: string
  experimentId: string | null
}) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const { showSuccessToast, showErrorToastWithCopy } = useCustomToast()
  const dataset = entry.dataset
  const datasetId = idAsString(dataset.id)
  const datasetName = dataset.dataset_name ?? "(unnamed)"
  const [editing, setEditing] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const w = entry.where
  const isUpload = entry.kind === "upload"

  // Files under this batch: one COUNT(*), only for uploads (results hold
  // records, not files).
  const fileCountQuery = useQuery({
    queryKey: ["datasets", datasetId, "file_count"],
    queryFn: async () => {
      if (!datasetId) return null
      const res =
        await DatasetsService.apiDatasetsIdDatasetIdFileCountGetDatasetFileCount(
          { datasetId },
        )
      const fc = (res as { file_count?: number } | null)?.file_count
      return typeof fc === "number" ? fc : null
    },
    enabled: Boolean(datasetId) && isUpload,
    staleTime: 5 * 60_000,
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await DatasetsService.apiDatasetsIdDatasetIdDeleteDataset({
        datasetId: id,
      })
    },
    onSuccess: () => {
      if (experimentId) {
        queryClient.invalidateQueries({
          queryKey: ["experiments", experimentId, "datasets"],
        })
      }
      showSuccessToast(isUpload ? "Upload deleted" : "Results deleted")
    },
    onError: (err) => {
      showErrorToastWithCopy(
        err instanceof Error ? err.message : "Delete failed",
      )
    },
  })

  const title = w
    ? [w.site, w.population].filter(Boolean).join(" · ")
    : entry.kind === "upload"
      ? (entry.typeLabel ?? "Upload")
      : entry.what

  const handleDelete = async () => {
    if (!datasetId) return
    await confirm({
      title: isUpload
        ? `Delete this upload${w ? ` (${title}, ${w.date})` : ""}?`
        : `Delete the ${entry.kind === "result" ? `"${entry.what}"` : ""} results${w ? ` for ${w.date}` : ""}?`,
      description: (
        <span>
          {isUpload
            ? "This removes every file uploaded in this batch from storage, plus any records that reference it."
            : "This removes these measurements from Analyze. Images and other files are not touched."}{" "}
          <strong>This cannot be undone.</strong>
          <span className="text-muted-foreground mt-2 block font-mono text-xs">
            {datasetName}
          </span>
        </span>
      ),
      confirmLabel: isUpload ? "Delete upload" : "Delete results",
      variant: "destructive",
      action: () => deleteMutation.mutateAsync(datasetId),
    })
  }

  const fileCount = fileCountQuery.data
  const folder =
    isUpload && w && experiment ? uploadFolder(experiment, w) : null

  return (
    <li data-testid={`manage-data-dataset-${datasetName}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
        <span
          className="w-24 shrink-0 font-mono text-xs"
          title="Date collected"
        >
          {w?.date ?? "—"}
        </span>
        <span className="min-w-0 flex-1">
          {w || entry.kind === "result" ? (
            <span className="font-medium">{title}</span>
          ) : (
            <span
              className="text-muted-foreground italic"
              title="Uploaded before the app recorded season, site and date; edit the upload to add them"
            >
              Site and date not recorded
            </span>
          )}
          {w && (
            <span className="text-muted-foreground">
              {" "}
              · {w.platform}
              {w.sensor ? ` ${w.sensor}` : ""}
            </span>
          )}
          {entry.kind === "result" && w && (
            <span className="text-muted-foreground"> · {entry.what}</span>
          )}
        </span>
        {entry.kind === "upload" && entry.typeLabel && (
          <span
            className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-secondary-foreground"
            data-testid={`manage-data-dataset-type-${datasetName}`}
          >
            {entry.typeLabel}
          </span>
        )}
        {entry.kind === "result" && (
          <span className="rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            {MADE_BY[entry.madeBy]}
          </span>
        )}
        {isUpload && (
          <span
            className="text-muted-foreground w-20 text-right text-xs"
            data-testid={`manage-data-dataset-filecount-${datasetName}`}
          >
            {fileCount == null
              ? fileCountQuery.isLoading
                ? "…"
                : ""
              : `${fileCount.toLocaleString()} file${fileCount === 1 ? "" : "s"}`}
          </span>
        )}
        {entry.kind === "upload" && entry.uploaded && (
          <span
            className="text-muted-foreground hidden w-32 text-xs lg:inline"
            title={
              entry.sourceFolder ? `From ${entry.sourceFolder}` : undefined
            }
          >
            uploaded {dayOf(entry.uploaded)}
          </span>
        )}
        <span className="flex items-center gap-0.5">
          {isUpload && (
            <Button
              size="sm"
              variant={browsing ? "secondary" : "ghost"}
              className="h-7 px-2 text-xs"
              disabled={!folder}
              title={
                folder
                  ? "List this upload's files"
                  : "Where this older upload was stored was not recorded; find it under Files → View"
              }
              onClick={() => setBrowsing((v) => !v)}
              data-testid={`manage-data-browse-${datasetName}`}
            >
              <FolderOpen className="mr-1 h-3.5 w-3.5" /> Files
            </Button>
          )}
          {isUpload && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(true)}
              title="Edit upload (season, site, population, date, platform, sensor)"
              aria-label="Edit upload"
              data-testid={`manage-data-edit-dataset-${datasetName}`}
              className="h-7 w-7 p-0"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          <LoadingButton
            size="sm"
            variant="ghost"
            loading={deleteMutation.isPending}
            onClick={handleDelete}
            title={isUpload ? "Delete upload" : "Delete results"}
            data-testid={`manage-data-delete-dataset-${datasetName}`}
            className="h-7 w-7 p-0"
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </LoadingButton>
        </span>
      </div>
      {isUpload && (
        <EditUploadDialog
          datasetId={datasetId}
          datasetName={datasetName}
          experimentId={experimentId}
          open={editing}
          onClose={() => setEditing(false)}
        />
      )}
      {browsing && folder && (
        <FolderFiles
          prefix={folder}
          zipName={`${experiment}-${w?.date ?? ""}-${w?.platform ?? ""}`}
        />
      )}
    </li>
  )
}

const PAGE = 100
const IMAGE_FILE = /\.(jpe?g|png|webp|gif|tiff?)$/i

/**
 * The files of one upload's folder, a page at a time. The server pages the
 * listing, so a flight of thousands of images costs one small response per
 * page instead of the whole store.
 */
function FolderFiles({ prefix, zipName }: { prefix: string; zipName: string }) {
  const { showErrorToastWithCopy } = useCustomToast()
  const [pages, setPages] = useState(1)
  const [viewing, setViewing] = useState<string | null>(null)
  const [zipping, setZipping] = useState(false)
  const query = useQuery({
    queryKey: ["files", "page", prefix, pages],
    queryFn: async () => {
      const res =
        (await FilesService.apiFilesListPaginatedFilePathListFilesPaginated({
          filePath: `${DEFAULT_BUCKET}/${prefix}`,
          limit: PAGE * pages,
          offset: 0,
        })) as { files?: FileMetadata[]; total_count?: number } | null
      return { files: res?.files ?? [], total: res?.total_count ?? 0 }
    },
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
  })
  const files = query.data?.files ?? []
  const total = query.data?.total ?? 0
  const imageNames = files
    .map((f) => f.object_name)
    .filter((n) => IMAGE_FILE.test(n))
  const others = files.filter((f) => !IMAGE_FILE.test(f.object_name))
  // Pictures by default when the folder is mostly pictures.
  const [grid, setGrid] = useState<boolean | null>(null)
  const showGrid = grid ?? imageNames.length * 2 >= files.length
  const [openAt, setOpenAt] = useState<number | null>(null)

  const zipAll = async () => {
    setZipping(true)
    try {
      await downloadZip({ prefix, filename: zipName })
    } catch (err) {
      showErrorToastWithCopy(
        err instanceof Error ? err.message : "Download failed",
      )
    } finally {
      setZipping(false)
    }
  }

  return (
    <div className="bg-muted/30 border-t px-3 py-2">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <code
          className="text-muted-foreground min-w-0 flex-1 truncate"
          title={prefix}
        >
          {prefix}
        </code>
        {query.data && (
          <span className="text-muted-foreground">
            {total.toLocaleString()} file{total === 1 ? "" : "s"}
          </span>
        )}
        {imageNames.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => setGrid(!showGrid)}
            data-testid="manage-data-view-toggle"
          >
            {showGrid ? (
              <>
                <ListIcon className="mr-1 h-3.5 w-3.5" /> List
              </>
            ) : (
              <>
                <LayoutGrid className="mr-1 h-3.5 w-3.5" /> Pictures
              </>
            )}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={zipAll}
          disabled={zipping || total === 0}
          data-testid={`manage-data-zip-${zipName}`}
        >
          <Download className="mr-1 h-3.5 w-3.5" />
          {zipping ? "Preparing…" : "Download all (.zip)"}
        </Button>
      </div>
      {query.isLoading ? (
        <div className="text-muted-foreground text-sm">Loading files…</div>
      ) : query.isError ? (
        <div className="text-destructive text-sm">Failed to list files.</div>
      ) : files.length === 0 ? (
        <div className="text-muted-foreground text-sm">
          No files in this folder.
        </div>
      ) : (
        <>
          <div
            className={`bg-background max-h-[28rem] overflow-auto rounded-md border ${
              showGrid ? "p-2" : "divide-y"
            }`}
            data-testid="manage-data-list"
          >
            {showGrid && imageNames.length > 0 && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {imageNames.map((name, i) => (
                  <div key={name} className="group relative">
                    <button
                      type="button"
                      className="block aspect-square w-full overflow-hidden rounded bg-muted"
                      onClick={() => setOpenAt(i)}
                      title={name.slice(prefix.length)}
                    >
                      <AuthImage
                        src={thumbnailSrc(name, 300)}
                        alt={name.split("/").pop() ?? ""}
                        className="h-full w-full rounded-none border-0 object-cover transition-transform group-hover:scale-105"
                        lazy
                      />
                    </button>
                    <div className="mt-0.5 flex items-center gap-1">
                      <span className="text-muted-foreground min-w-0 flex-1 truncate text-[10px]">
                        {name.split("/").pop()}
                      </span>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => void downloadViaBrowser(name)}
                        title="Download"
                        data-testid={`download-${name}`}
                      >
                        <Download className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {(showGrid ? others : files).map((f) => (
              <div
                key={f.object_name}
                className="flex items-center gap-3 px-3 py-1.5 text-sm"
              >
                <File className="text-muted-foreground h-4 w-4 shrink-0" />
                <div
                  className="min-w-0 flex-1 truncate font-mono text-xs"
                  title={f.object_name}
                >
                  {f.object_name.slice(prefix.length) || f.object_name}
                </div>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {formatBytes(f.size)}
                </span>
                {isViewableCsv(f.object_name) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={() => setViewing(f.object_name)}
                    title="View"
                    data-testid={`view-${f.object_name}`}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() =>
                    downloadViaBrowser(f.object_name).catch((err) =>
                      showErrorToastWithCopy(
                        err instanceof Error ? err.message : "Download failed",
                      ),
                    )
                  }
                  title="Download"
                  data-testid={`download-${f.object_name}`}
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          {files.length < total && (
            <Button
              size="sm"
              variant="ghost"
              className="mt-1 h-7 text-xs"
              disabled={query.isFetching}
              onClick={() => setPages((n) => n + 1)}
            >
              {query.isFetching
                ? "Loading…"
                : `Show ${Math.min(PAGE, total - files.length)} more (${files.length.toLocaleString()} of ${total.toLocaleString()} shown)`}
            </Button>
          )}
        </>
      )}
      <MetadataViewerDialog
        objectPath={viewing}
        onClose={() => setViewing(null)}
      />
      <ImageLightbox
        images={imageNames}
        index={openAt}
        onIndex={setOpenAt}
        onClose={() => setOpenAt(null)}
        caption={(n) => n.slice(prefix.length)}
      />
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
