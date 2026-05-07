import { useQuery } from "@tanstack/react-query"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  File as FileIcon,
  Image as ImageIcon,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import {
  type ExperimentOutput,
  ExperimentsService,
  type FileMetadata,
  FilesService,
  OpenAPI,
} from "@/client"
import { MultiSelectFilter } from "@/components/Common/MultiSelectFilter"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { idAsString } from "@/features/admin/lib/ids"
import { deriveImagePathAttrs } from "@/features/files/lib/imagePath"
import { getToken } from "@/lib/auth"

const DEFAULT_BUCKET = "gemini"
const PAGE_SIZE = 50
const TOP_PREFIXES = ["Raw", "Processed"] as const
const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "tif", "tiff", "svg"])

function fileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? ""
}

function isImageFile(name: string): boolean {
  return IMAGE_EXTS.has(fileExt(name))
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileNameOf(objectName: string): string {
  return objectName.split("/").pop() ?? objectName
}

function apiUrl(path: string): string {
  return `${(OpenAPI.BASE ?? "").replace(/\/$/, "")}${path}`
}

/**
 * Fetch the thumbnail with bearer auth and return an object URL. The
 * `<img src="/api/files/thumbnail/...">` form cannot include the
 * Authorization header, so we blob-fetch and feed `URL.createObjectURL`.
 */
function useThumbnailUrl(
  bucket: string,
  objectName: string,
): { url: string | null; loading: boolean } {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    let createdObjectUrl: string | null = null
    setLoading(true)
    setUrl(null)
    const path = `/api/files/thumbnail/${bucket}/${objectName}?size=200`
    fetch(apiUrl(path), {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Thumbnail ${res.status}`)
        return res.blob()
      })
      .then((blob) => {
        if (!active) return
        createdObjectUrl = URL.createObjectURL(blob)
        setUrl(createdObjectUrl)
        setLoading(false)
      })
      .catch(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl)
    }
  }, [bucket, objectName])

  return { url, loading }
}

function ThumbnailTile({ file }: { file: FileMetadata }) {
  const { url, loading } = useThumbnailUrl(file.bucket_name, file.object_name)
  const name = fileNameOf(file.object_name)
  return (
    <div
      className="group relative rounded-lg border overflow-hidden hover:border-primary transition-colors"
      data-testid="image-thumbnail"
    >
      <div className="aspect-square bg-muted flex items-center justify-center">
        {url ? (
          <img
            src={url}
            alt={name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : loading ? (
          <ImageIcon className="text-muted-foreground h-6 w-6 animate-pulse" />
        ) : (
          <ImageIcon className="text-muted-foreground h-6 w-6" />
        )}
      </div>
      <div className="p-1.5">
        <p className="text-xs truncate" title={name}>
          {name}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {formatSize(file.size ?? 0)}
        </p>
      </div>
    </div>
  )
}

async function downloadFile(file: FileMetadata): Promise<void> {
  const url = apiUrl(
    `/api/files/download/${file.bucket_name}/${file.object_name}`,
  )
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = objectUrl
  a.download = fileNameOf(file.object_name)
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}

export function ImageViewer() {
  const [experimentName, setExperimentName] = useState<string>("")
  const [offset, setOffset] = useState(0)
  const [filenameQuery, setFilenameQuery] = useState<string>("")
  const [filterLocation, setFilterLocation] = useState<Set<string>>(new Set())
  const [filterPopulation, setFilterPopulation] = useState<Set<string>>(
    new Set(),
  )
  const [filterDate, setFilterDate] = useState<Set<string>>(new Set())
  const [filterPlatform, setFilterPlatform] = useState<Set<string>>(new Set())
  const [filterSensor, setFilterSensor] = useState<Set<string>>(new Set())

  const experimentsQuery = useQuery({
    queryKey: ["view", "experiments"],
    queryFn: () =>
      ExperimentsService.apiExperimentsAllGetAllExperiments({
        limit: 500,
        offset: 0,
      }),
  })
  const experiments: ExperimentOutput[] =
    (experimentsQuery.data as ExperimentOutput[] | null) ?? []

  // Files land under varying path layouts depending on the upload route:
  //   Raw/{year}/{experiment}/{location}/.../Images/...   (drone uploads)
  //   Raw/{date}/{experiment}/{filename}                   (wizard / supplemental)
  //   Processed/{year}/{experiment}/...                    (worker outputs)
  // The experiment name is never the FIRST segment under Raw/, so we
  // can't use `gemini/Raw/{experimentName}` as a server-side prefix.
  // List each top-level prefix and filter client-side for objects whose
  // path contains the experiment name as a complete segment. Same
  // pattern as ManageData.tsx.
  const filesQuery = useQuery({
    queryKey: ["view", "image-files", experimentName],
    queryFn: async () => {
      if (!experimentName) return [] as FileMetadata[]
      const out: FileMetadata[] = []
      const segment = `/${experimentName}/`
      for (const top of TOP_PREFIXES) {
        try {
          const res = await FilesService.apiFilesListFilePathListFiles({
            filePath: `${DEFAULT_BUCKET}/${top}`,
          })
          const list = (res as FileMetadata[] | null) ?? []
          for (const f of list) {
            if (f.object_name.includes(segment)) out.push(f)
          }
        } catch {
          // 404 on an empty top-level prefix (e.g. nothing under
          // Processed/ yet) is benign — keep going.
        }
      }
      return out
    },
    enabled: Boolean(experimentName),
  })

  // All matching files for the experiment. Build an attrs lookup once
  // so per-file filter checks are O(1).
  const allFiles: FileMetadata[] = filesQuery.data ?? []
  const fileAttrs = useMemo(() => {
    const map = new Map<string, ReturnType<typeof deriveImagePathAttrs>>()
    for (const f of allFiles) {
      map.set(
        f.object_name,
        deriveImagePathAttrs(f.object_name, experimentName),
      )
    }
    return map
  }, [allFiles, experimentName])

  // Distinct option lists per attribute (drop empty values so the
  // dropdown only lists real choices).
  // Distinct option lists per attribute (drop empty values so the
  // dropdowns only list real choices). Computed once per attrs change.
  const optionLists = useMemo(() => {
    const sets = {
      location: new Set<string>(),
      population: new Set<string>(),
      date: new Set<string>(),
      platform: new Set<string>(),
      sensor: new Set<string>(),
    }
    for (const f of allFiles) {
      const a = fileAttrs.get(f.object_name)
      if (!a) continue
      if (a.location) sets.location.add(a.location)
      if (a.population) sets.population.add(a.population)
      if (a.date) sets.date.add(a.date)
      if (a.platform) sets.platform.add(a.platform)
      if (a.sensor) sets.sensor.add(a.sensor)
    }
    return {
      location: [...sets.location].sort(),
      population: [...sets.population].sort(),
      date: [...sets.date].sort(),
      platform: [...sets.platform].sort(),
      sensor: [...sets.sensor].sort(),
    }
  }, [allFiles, fileAttrs])
  const {
    location: locationOptions,
    population: populationOptions,
    date: dateOptions,
    platform: platformOptions,
    sensor: sensorOptions,
  } = optionLists

  // Apply filters: filename text + per-attribute multi-selects. A file
  // matches iff every active filter (non-empty selected set) contains
  // its derived value at that position. Files that lack a derived value
  // for an active filter are excluded — the user explicitly narrowed.
  const filteredFiles = useMemo(() => {
    const fnQuery = filenameQuery.trim().toLowerCase()
    return allFiles.filter((f) => {
      if (fnQuery && !f.object_name.toLowerCase().includes(fnQuery))
        return false
      const attrs = fileAttrs.get(f.object_name)
      if (!attrs) return false
      if (filterLocation.size > 0 && !filterLocation.has(attrs.location))
        return false
      if (filterPopulation.size > 0 && !filterPopulation.has(attrs.population))
        return false
      if (filterDate.size > 0 && !filterDate.has(attrs.date)) return false
      if (filterPlatform.size > 0 && !filterPlatform.has(attrs.platform))
        return false
      if (filterSensor.size > 0 && !filterSensor.has(attrs.sensor)) return false
      return true
    })
  }, [
    allFiles,
    fileAttrs,
    filenameQuery,
    filterLocation,
    filterPopulation,
    filterDate,
    filterPlatform,
    filterSensor,
  ])

  // Order images first, then non-images, then paginate client-side.
  const orderedFiles = useMemo(() => {
    const imgs = filteredFiles.filter((f) => isImageFile(f.object_name))
    const others = filteredFiles.filter((f) => !isImageFile(f.object_name))
    return [...imgs, ...others]
  }, [filteredFiles])
  const totalCount = orderedFiles.length
  const pagedFiles = useMemo(
    () => orderedFiles.slice(offset, offset + PAGE_SIZE),
    [orderedFiles, offset],
  )
  const imageFiles = pagedFiles.filter((f) => isImageFile(f.object_name))
  const otherFiles = pagedFiles.filter((f) => !isImageFile(f.object_name))
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1
  const rangeStart = totalCount === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + PAGE_SIZE, totalCount)

  const anyFilterActive =
    filenameQuery.trim().length > 0 ||
    filterLocation.size > 0 ||
    filterPopulation.size > 0 ||
    filterDate.size > 0 ||
    filterPlatform.size > 0 ||
    filterSensor.size > 0

  function resetFilters() {
    setFilenameQuery("")
    setFilterLocation(new Set())
    setFilterPopulation(new Set())
    setFilterDate(new Set())
    setFilterPlatform(new Set())
    setFilterSensor(new Set())
    setOffset(0)
  }
  const resetOffset = () => setOffset(0)

  return (
    <div className="space-y-4" data-testid="image-viewer">
      <div className="flex items-end gap-4">
        <div className="space-y-1">
          <label
            htmlFor="image-viewer-experiment"
            className="text-xs text-muted-foreground"
          >
            Experiment
          </label>
          <Select
            value={experimentName}
            onValueChange={(v) => {
              setExperimentName(v)
              setOffset(0)
            }}
          >
            <SelectTrigger
              id="image-viewer-experiment"
              className="w-64"
              data-testid="image-viewer-experiment"
            >
              <SelectValue placeholder="Pick an experiment" />
            </SelectTrigger>
            <SelectContent>
              {experiments.map((e) => (
                <SelectItem key={idAsString(e.id)} value={e.experiment_name}>
                  {e.experiment_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!experimentName && (
        <p className="text-sm text-muted-foreground">
          Pick an experiment to browse its uploaded files.
        </p>
      )}

      {experimentName && filesQuery.isLoading && (
        <p className="text-sm text-muted-foreground">Loading files…</p>
      )}

      {experimentName && filesQuery.isError && (
        <p className="text-sm text-destructive">
          Failed to load files. The experiment may have no uploads yet.
        </p>
      )}

      {experimentName &&
        !filesQuery.isLoading &&
        !filesQuery.isError &&
        allFiles.length > 0 && (
          <div
            className="flex flex-wrap items-end gap-3"
            data-testid="image-viewer-filters"
          >
            <div className="space-y-1">
              <label
                htmlFor="image-viewer-filename"
                className="text-xs text-muted-foreground"
              >
                Filename contains
              </label>
              <Input
                id="image-viewer-filename"
                value={filenameQuery}
                onChange={(e) => {
                  setFilenameQuery(e.target.value)
                  resetOffset()
                }}
                placeholder="e.g. IMG_0018"
                className="w-48"
                data-testid="image-viewer-filter-filename"
              />
            </div>
            {locationOptions.length > 0 && (
              <MultiSelectFilter
                label="Location"
                options={locationOptions}
                selected={filterLocation}
                onChange={(next) => {
                  setFilterLocation(next)
                  resetOffset()
                }}
                width="w-40"
                testId="image-viewer-filter-location"
              />
            )}
            {populationOptions.length > 0 && (
              <MultiSelectFilter
                label="Population"
                options={populationOptions}
                selected={filterPopulation}
                onChange={(next) => {
                  setFilterPopulation(next)
                  resetOffset()
                }}
                width="w-44"
                testId="image-viewer-filter-population"
              />
            )}
            {dateOptions.length > 0 && (
              <MultiSelectFilter
                label="Date"
                options={dateOptions}
                selected={filterDate}
                onChange={(next) => {
                  setFilterDate(next)
                  resetOffset()
                }}
                width="w-40"
                testId="image-viewer-filter-date"
              />
            )}
            {platformOptions.length > 0 && (
              <MultiSelectFilter
                label="Platform"
                options={platformOptions}
                selected={filterPlatform}
                onChange={(next) => {
                  setFilterPlatform(next)
                  resetOffset()
                }}
                width="w-36"
                testId="image-viewer-filter-platform"
              />
            )}
            {sensorOptions.length > 0 && (
              <MultiSelectFilter
                label="Sensor"
                options={sensorOptions}
                selected={filterSensor}
                onChange={(next) => {
                  setFilterSensor(next)
                  resetOffset()
                }}
                width="w-36"
                testId="image-viewer-filter-sensor"
              />
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={resetFilters}
              disabled={!anyFilterActive}
              className="self-end"
              data-testid="image-viewer-reset-filters"
            >
              Reset filters
            </Button>
          </div>
        )}

      {experimentName &&
        !filesQuery.isLoading &&
        !filesQuery.isError &&
        allFiles.length === 0 && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="image-viewer-empty"
          >
            No files uploaded under this experiment yet.
          </p>
        )}

      {experimentName &&
        !filesQuery.isLoading &&
        !filesQuery.isError &&
        allFiles.length > 0 &&
        totalCount === 0 && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="image-viewer-no-match"
          >
            No files match the current filters. Try clearing them.
          </p>
        )}

      {experimentName && totalCount > 0 && (
        <>
          <div className="flex items-center justify-between">
            <p
              className="text-sm text-muted-foreground"
              data-testid="image-viewer-count"
            >
              {totalCount === 1
                ? "1 file"
                : `${rangeStart}-${rangeEnd} of ${totalCount} files`}
              {anyFilterActive ? ` (filtered from ${allFiles.length})` : ""}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= totalCount}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {imageFiles.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">
                Images ({imageFiles.length} on this page)
              </h4>
              <div
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
                data-testid="image-gallery"
              >
                {imageFiles.map((f) => (
                  <ThumbnailTile key={f.object_name} file={f} />
                ))}
              </div>
            </div>
          )}

          {imageFiles.length === 0 && otherFiles.length > 0 && (
            <p
              className="text-sm text-muted-foreground"
              data-testid="image-viewer-no-images-on-page"
            >
              No images on this page. Advance to find image files, or check the
              "Other Files" list below.
            </p>
          )}

          {otherFiles.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">
                Other Files ({otherFiles.length} on this page)
              </h4>
              <div
                className="rounded-md border divide-y"
                data-testid="image-viewer-files"
              >
                {otherFiles.map((f) => (
                  <div
                    key={f.object_name}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40"
                  >
                    <FileIcon className="text-muted-foreground h-4 w-4 shrink-0" />
                    <span
                      className="text-sm truncate flex-1 font-mono"
                      title={f.object_name}
                    >
                      {fileNameOf(f.object_name)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatSize(f.size ?? 0)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        downloadFile(f).catch(() => {
                          /* swallow — caller surface is best-effort */
                        })
                      }}
                      title="Download"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
