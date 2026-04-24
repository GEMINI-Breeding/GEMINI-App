import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Download, FolderOpen, Image, RefreshCw, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"

import { FilesService, type FileMetadata } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useExperimentScope } from "@/contexts/ExperimentContext"
import { getToken } from "@/lib/auth"
import { OpenAPI } from "@/client"
import useCustomToast from "@/hooks/useCustomToast"

type Section = "Raw" | "Processed" | "Intermediate"

const SECTIONS: Section[] = ["Raw", "Processed", "Intermediate"]

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
  const url = apiUrl(`/api/files/download/${objectPath}`)
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
  const [section, setSection] = useState<Section>("Raw")
  const [filter, setFilter] = useState("")
  const { experimentId } = useExperimentScope()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToastWithCopy } = useCustomToast()

  // Build a MinIO prefix from the active section. Experiment scoping is a
  // Phase-7 refinement — for now we list the whole top-level section so
  // freshly uploaded Raw/ files show up even before the path convention
  // gets tied to experiment metadata.
  const prefix = section

  const filesQuery = useQuery({
    queryKey: ["files", "list", prefix],
    queryFn: async () => {
      const files = await FilesService.apiFilesListFilePathListFiles({
        filePath: prefix,
      })
      return (files as FileMetadata[] | null) ?? []
    },
  })

  const filtered = useMemo(() => {
    const all = filesQuery.data ?? []
    if (!filter.trim()) return all
    const needle = filter.toLowerCase()
    return all.filter((f) => f.object_name.toLowerCase().includes(needle))
  }, [filesQuery.data, filter])

  const deleteMutation = useMutation({
    mutationFn: async (objectPath: string) => {
      await FilesService.apiFilesDeleteFilePathDeleteFile({
        filePath: objectPath,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files", "list", prefix] })
      showSuccessToast("File deleted")
    },
    onError: (err) => {
      showErrorToastWithCopy(
        err instanceof Error ? err.message : "Delete failed",
      )
    },
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
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Manage Data</h1>
          <p className="text-muted-foreground">
            Browse files stored under <code className="text-xs">{prefix}/</code>
            {experimentId && (
              <>
                {" "}
                (active experiment:{" "}
                <code className="text-xs">{experimentId.slice(0, 8)}</code>)
              </>
            )}
          </p>
        </div>
        <LoadingButton
          variant="outline"
          loading={filesQuery.isFetching}
          onClick={() =>
            queryClient.invalidateQueries({
              queryKey: ["files", "list", prefix],
            })
          }
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </LoadingButton>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={section}
          onValueChange={(v) => setSection(v as Section)}
        >
          <SelectTrigger className="w-48" data-testid="manage-data-section">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SECTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Filter by path"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-xs"
          data-testid="manage-data-filter"
        />
      </div>

      {filesQuery.isLoading ? (
        <div className="text-muted-foreground text-sm">Loading files…</div>
      ) : filesQuery.isError ? (
        <div className="text-destructive text-sm">
          Failed to list files:{" "}
          {filesQuery.error instanceof Error
            ? filesQuery.error.message
            : "unknown error"}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="rounded-full bg-muted p-4 mb-4">
            <FolderOpen className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">
            {filesQuery.data?.length === 0
              ? `No files under ${prefix}/`
              : "No files match your filter"}
          </h3>
          <p className="text-muted-foreground">
            {filesQuery.data?.length === 0
              ? "Upload some data first, then refresh this view."
              : "Try loosening your filter."}
          </p>
        </div>
      ) : (
        <div
          className="rounded-md border divide-y"
          data-testid="manage-data-list"
        >
          {filtered.map((f) => (
            <FileRow
              key={f.object_name}
              file={f}
              onDownload={() => handleDownload(f.object_name)}
              onDelete={() => deleteMutation.mutate(f.object_name)}
              deleting={
                deleteMutation.isPending &&
                deleteMutation.variables === f.object_name
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

function FileRow({
  file,
  onDownload,
  onDelete,
  deleting,
}: {
  file: FileMetadata
  onDownload: () => void
  onDelete: () => void
  deleting: boolean
}) {
  const isImage =
    file.content_type?.startsWith("image/") ??
    /\.(png|jpe?g|webp|gif|tif)$/i.test(file.object_name)
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-muted/40">
      <div className="flex-shrink-0 text-muted-foreground">
        {isImage ? (
          <Image className="h-4 w-4" />
        ) : (
          <FolderOpen className="h-4 w-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs" title={file.object_name}>
          {file.object_name}
        </div>
        <div className="text-muted-foreground text-xs">
          {formatBytes(file.size)} • {file.last_modified}
          {file.content_type ? ` • ${file.content_type}` : ""}
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={onDownload}
        title="Download"
        data-testid={`download-${file.object_name}`}
      >
        <Download className="h-4 w-4" />
      </Button>
      <LoadingButton
        size="sm"
        variant="ghost"
        loading={deleting}
        onClick={onDelete}
        title="Delete"
        data-testid={`delete-${file.object_name}`}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </LoadingButton>
    </div>
  )
}
