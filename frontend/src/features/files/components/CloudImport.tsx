/**
 * Copy data from online storage (Box, Google Drive, Dropbox, S3, WebDAV, a
 * public web folder, SFTP) into the app. The copy runs where the stack runs:
 * on a cluster, a cluster job copies straight from the storage and uploads
 * from there (nothing passes through this computer); on this computer, the
 * agent service copies and uploads. Signing in to Box, Google Drive or
 * Dropbox opens the browser on the computer running the app.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ChevronRight,
  File as FileIcon,
  Folder,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { type FileMetadata, FilesService } from "@/client"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  agentApi,
  type CloudFetch,
  type CloudItem,
  type CloudProvider,
} from "@/features/agent/lib/agentApi"
import { friendlyError } from "@/features/agent/lib/friendlyError"
import {
  dateFromFolder,
  dateOf,
  dateTokenIn,
  groupByDate,
} from "@/features/files/lib/fileDates"
import { CLUSTER_DATA_TYPES, uploadSettings } from "./ClusterFolderUpload"
import { DateCheckDialog, type DateCheckGroup } from "./DateCheckDialog"
import type { EntityChoice } from "./EntitySelectField"

const FINISHED = new Set(["done", "failed", "COMPLETED", "FAILED", "ENDED"])

export function isFinished(f: Pick<CloudFetch, "state">): boolean {
  return FINISHED.has(f.state)
}

export function isFailure(f: Pick<CloudFetch, "state">): boolean {
  return f.state === "failed" || f.state === "FAILED" || f.state === "ENDED"
}

/** "1.2 GiB" from bytes. */
export function humanSize(n: number | null | undefined): string {
  if (n == null) return ""
  const u = ["B", "KB", "MB", "GB", "TB"]
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${u[i]}`
}

/** A connection's default name: its type, numbered if taken. */
export function defaultName(type: string, taken: string[]): string {
  if (!taken.includes(type)) return type
  for (let i = 2; ; i++)
    if (!taken.includes(`${type}${i}`)) return `${type}${i}`
}

export function CloudImport({
  dataType,
  formValues,
  scope,
  disabled,
  disabledReason,
}: {
  dataType: string | null
  formValues: Record<string, string>
  scope: Record<string, EntityChoice>
  disabled: boolean
  disabledReason?: string
}) {
  const queryClient = useQueryClient()
  const overview = useQuery({
    queryKey: ["agent", "cloud"],
    queryFn: () => agentApi.cloud(),
    staleTime: 60_000,
    retry: false,
  })
  const [remote, setRemote] = useState("")
  const [path, setPath] = useState("")
  const [picked, setPicked] = useState<string | null>(null)
  const [nameEnds, setNameEnds] = useState("")
  const [keep, setKeep] = useState(false)
  const [adding, setAdding] = useState(false)
  // The copies started (one per date when dates come from the files).
  const [fetchIds, setFetchIds] = useState<{ id: string; date: string }[]>([])
  const [datePrompt, setDatePrompt] = useState<{
    groups: DateCheckGroup[]
    resolve: (dates: string[] | null) => void
  } | null>(null)

  const remotes = overview.data?.remotes ?? []
  useEffect(() => {
    if (!remote && remotes.length) setRemote(remotes[0].name)
  }, [remote, remotes])

  const listing = useQuery({
    queryKey: ["agent", "cloud", "ls", remote, path],
    queryFn: () => agentApi.cloudBrowse(remote, path),
    enabled: Boolean(remote),
    retry: false,
    staleTime: 60_000,
  })

  const remove = useMutation({
    mutationFn: () => agentApi.cloudRemove(remote),
    onSuccess: () => {
      setRemote("")
      setPath("")
      queryClient.invalidateQueries({ queryKey: ["agent", "cloud"] })
    },
  })

  const start = useMutation({
    mutationFn: async (): Promise<{ id: string; date: string }[]> => {
      const base = uploadSettings(dataType, formValues, scope)
      if (nameEnds.trim()) base.name_ends = nameEnds.trim()
      const target = picked ?? path
      if (formValues.date_mode !== "files") {
        const f = await agentApi.cloudFetch({
          name: remote,
          path: target,
          settings: base,
          keep,
        })
        return [{ id: f.id, date: base.date }]
      }
      // Dates from the files: list them (and dated folders one level down),
      // one copy per date, after the person has checked the dates.
      const files = await filesToCopy(
        remote,
        target,
        picked,
        listing.data?.items,
      )
      const wanted = files.filter(
        (f) =>
          keepsType(base.data_type, f.name) &&
          (!base.name_ends ||
            base.name_ends
              .split(",")
              .some((e) => e.trim() && f.name.endsWith(e.trim()))),
      )
      if (wanted.length === 0)
        throw new Error("No files of this data type in that folder.")
      const fallback =
        formValues.date?.trim() || new Date().toISOString().slice(0, 10)
      const groups = groupByDate(
        wanted,
        (f) => dateOf({ name: f.name, folder: f.folder, modified: f.modified }),
        fallback,
      )
      // Dates already in the app (every file, same name and size, for that date, platform
      // and sensor): not copied again. A date partly there is copied, and the upload sends
      // only the files the app does not hold.
      const already: string[] = []
      const fresh = []
      for (const g of groups) {
        const prefix = `Raw/${g.date.slice(0, 4)}/${base.experiment}/${base.site}/${base.population}/${g.date}/${base.platform}/${base.sensor}/`
        let have = new Set<string>()
        try {
          const listed =
            ((await FilesService.apiFilesListFilePathListFiles({
              filePath: `gemini/${prefix}`,
            })) as FileMetadata[] | null) ?? []
          have = new Set(
            listed
              .filter((f) => (f.object_name ?? "").startsWith(prefix))
              .map(
                (f) =>
                  `${(f.object_name ?? "").split("/").pop()}|${f.size ?? 0}`,
              ),
          )
        } catch {
          // Not listed: copy it; the upload skips what is there anyway.
        }
        if (g.items.every((f) => have.has(`${f.name}|${f.size ?? 0}`)))
          already.push(g.date)
        else fresh.push(g)
      }
      if (already.length)
        toast.info(
          `Already in the app, not copied again: ${already.join(", ")}.`,
        )
      groups.splice(0, groups.length, ...fresh)
      if (groups.length === 0) return []
      const dates = await new Promise<string[] | null>((resolve) =>
        setDatePrompt({
          groups: groups.map((g) => ({
            date: g.date,
            source: g.source,
            count: g.items.length,
            samples: g.items.slice(0, 3).map((f) => f.name),
            label:
              [...new Set(g.items.map((f) => f.folder).filter(Boolean))]
                .slice(0, 2)
                .join(", ") || undefined,
          })),
          resolve,
        }),
      )
      if (!dates) return []
      const out: { id: string; date: string }[] = []
      const failed: string[] = []
      for (const [i, g] of groups.entries()) {
        const settings: Record<string, string> = { ...base, date: dates[i] }
        const names = g.items.map((f) => f.name)
        const folders = [...new Set(g.items.map((f) => f.folder))]
        let from = target
        if (folders.length === 1 && folders[0] && dateFromFolder(folders[0])) {
          // A dated folder: copy it whole.
          from = [target, folders[0]].filter(Boolean).join("/")
        } else {
          const token = dateTokenIn(names, g.date)
          if (token) settings.name_has = token
          else if (names.join(",").length <= 190)
            settings.name_ends = names.join(",")
          else
            throw new Error(
              `The ${g.items.length} files of ${g.date} cannot be picked out of the folder by name. Put each date's files in its own folder, or upload them with one date.`,
            )
        }
        // Each date on its own: one that cannot start does not stop the others.
        try {
          const f = await agentApi.cloudFetch({
            name: remote,
            path: from,
            settings,
            keep,
          })
          out.push({ id: f.id, date: dates[i] })
        } catch (e) {
          failed.push(`${dates[i]}: ${friendlyError(e)}`)
        }
      }
      if (failed.length)
        toast.error(
          `${failed.length} of ${groups.length} dates did not start — ${failed.join("; ")}`,
        )
      return out
    },
    onSuccess: (list) => setFetchIds(list),
  })

  const kind = CLUSTER_DATA_TYPES[dataType ?? ""]
  if (!kind) return null
  const where = overview.data?.where
  const cluster = overview.data?.cluster
  const crumbs = path ? path.split("/") : []
  const target = picked ?? path

  if (overview.isLoading)
    return (
      <p
        className="flex items-center gap-2 text-sm text-muted-foreground"
        data-testid="cloud-import"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Looking up your storage connections…
      </p>
    )

  return (
    <div className="space-y-3" data-testid="cloud-import">
      <p className="text-xs text-muted-foreground">
        {where === "cluster"
          ? `Box, Google Drive, Dropbox, S3, WebDAV, a web folder or SFTP. A job on ${cluster} copies the folder straight from the storage and uploads it there: nothing passes through this computer.`
          : "Box, Google Drive, Dropbox, S3, WebDAV, a web folder or SFTP. This computer copies the folder from the storage, then uploads it."}
      </p>
      {overview.error && (
        <p className="text-sm text-destructive">{String(overview.error)}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {remotes.length > 0 && (
          <Select
            value={remote}
            onValueChange={(v) => {
              setRemote(v)
              setPath("")
              setPicked(null)
            }}
          >
            <SelectTrigger className="w-56" data-testid="cloud-remote">
              <SelectValue placeholder="Connection" />
            </SelectTrigger>
            <SelectContent>
              {remotes.map((r) => (
                <SelectItem key={r.name} value={r.name}>
                  {r.name} · {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAdding((a) => !a)}
          data-testid="cloud-connect-open"
        >
          <Plus className="mr-1 h-4 w-4" />
          {remotes.length ? "Connect another" : "Connect storage"}
        </Button>
        {remote && (
          <Button
            variant="ghost"
            size="sm"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
            title="Remove this connection (its sign-in is deleted)"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {adding && overview.data && (
        <ConnectForm
          providers={overview.data.providers}
          taken={remotes.map((r) => r.name)}
          where={where === "cluster" ? `on ${cluster}` : "on this computer"}
          onDone={(name) => {
            setAdding(false)
            setRemote(name)
            setPath("")
            queryClient.invalidateQueries({ queryKey: ["agent", "cloud"] })
          }}
        />
      )}

      {remote && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <button
              type="button"
              className="font-medium hover:underline"
              onClick={() => {
                setPath("")
                setPicked(null)
              }}
            >
              {remote}
            </button>
            {crumbs.map((c, i) => (
              <span
                key={crumbs.slice(0, i + 1).join("/")}
                className="flex items-center gap-1"
              >
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <button
                  type="button"
                  className="hover:underline"
                  onClick={() => {
                    setPath(crumbs.slice(0, i + 1).join("/"))
                    setPicked(null)
                  }}
                >
                  {c}
                </button>
              </span>
            ))}
          </div>
          <div
            className="max-h-56 overflow-auto rounded border"
            data-testid="cloud-listing"
          >
            {listing.isLoading ? (
              <p className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Listing…
              </p>
            ) : listing.error ? (
              <p className="p-2 text-xs text-destructive">
                {String(listing.error)}
              </p>
            ) : (listing.data?.items ?? []).length === 0 ? (
              <p className="p-2 text-xs text-muted-foreground">
                This folder is empty.
              </p>
            ) : (
              (listing.data?.items ?? []).map((it) => (
                <button
                  key={it.path}
                  type="button"
                  className={`flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-muted ${picked === it.path ? "bg-muted font-medium" : ""}`}
                  onClick={() => {
                    if (it.is_dir) {
                      setPath(it.path)
                      setPicked(null)
                    } else setPicked(picked === it.path ? null : it.path)
                  }}
                >
                  {it.is_dir ? (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{it.name}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {humanSize(it.size)}
                  </span>
                </button>
              ))
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Copies{" "}
            <span className="font-medium text-foreground">
              {target ? `${remote}/${target}` : `all of ${remote}`}
            </span>
            {picked
              ? " (this file)"
              : " (this folder and the folders in it; open a folder to copy only it, click a file for one file)"}
            .
          </p>
          <Input
            value={nameEnds}
            onChange={(e) => setNameEnds(e.target.value)}
            placeholder="Only files whose names end with … (optional, e.g. _V.JPG)"
          />
          <div className="flex items-center gap-2">
            <Checkbox
              id="cloud-keep"
              checked={keep}
              onCheckedChange={(v) => setKeep(v === true)}
            />
            <Label htmlFor="cloud-keep" className="text-xs font-normal">
              Keep the copy{" "}
              {where === "cluster" ? `on ${cluster}` : "on this computer"} after
              uploading
            </Label>
          </div>
          <div className="flex items-center gap-3">
            <Button
              disabled={disabled || start.isPending}
              onClick={() => start.mutate()}
              data-testid="cloud-fetch"
            >
              {start.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-1.5 h-4 w-4" />
              )}
              Copy and upload
            </Button>
            {disabled && (
              <span className="text-xs text-muted-foreground">
                {disabledReason}
              </span>
            )}
          </div>
          {start.error && (
            <p className="text-sm text-destructive">
              {friendlyError(start.error)}
            </p>
          )}
        </div>
      )}

      {fetchIds.map((f) => (
        <FetchProgress key={f.id} id={f.id} date={f.date} />
      ))}
      <DateCheckDialog
        groups={datePrompt?.groups ?? null}
        onConfirm={(dates) => {
          datePrompt?.resolve(dates)
          setDatePrompt(null)
        }}
        onCancel={() => {
          datePrompt?.resolve(null)
          setDatePrompt(null)
        }}
      />
    </div>
  )
}

/** One copy's progress (one per date when dates come from the files). */
function FetchProgress({ id, date }: { id: string; date: string }) {
  const progress = useQuery({
    queryKey: ["agent", "cloud", "fetch", id],
    queryFn: () => agentApi.cloudFetchState(id),
    refetchInterval: (q) =>
      q.state.data && isFinished(q.state.data) ? false : 5000,
  })
  const finished = progress.data && isFinished(progress.data)
  useEffect(() => {
    if (!progress.data || !isFinished(progress.data)) return
    if (isFailure(progress.data))
      toast.error(
        `The copy of ${date} did not finish; see the details under it.`,
      )
    else
      toast.success(
        `${date}: copied and uploaded. The run shows on the Process tab.`,
      )
  }, [progress.data, date])
  if (!progress.data) return null
  return (
    <div
      className="space-y-1 rounded bg-muted p-2 text-xs"
      data-testid="cloud-progress"
    >
      <p className="flex items-center gap-2 font-medium">
        {!finished && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {date}: {stateLabel(progress.data)}
      </p>
      {progress.data.line && <p>{progress.data.line}</p>}
      {progress.data.error && (
        <p className="text-destructive">{progress.data.error}</p>
      )}
    </div>
  )
}

/** The data types' file kinds, as the upload after the copy takes them. */
const TYPE_EXT: Record<string, RegExp> = {
  images: /\.(jpe?g|png|tiff?)$/i,
  amiga_bin: /\.bin$/i,
  orthomosaic: /\.tiff?$/i,
}

export function keepsType(dataType: string | undefined, name: string): boolean {
  const re = TYPE_EXT[dataType ?? ""]
  return re ? re.test(name) : true
}

interface CopyFile {
  name: string
  size?: number | null
  /** The folder under the chosen one it is in ("" when directly in it). */
  folder: string
  modified: string | null
}

/** The files a copy of ``target`` takes: the chosen file, or the folder's files
 * and those of its folders one level down (date folders, say). */
async function filesToCopy(
  remote: string,
  target: string,
  picked: string | null,
  shown: CloudItem[] | undefined,
): Promise<CopyFile[]> {
  if (picked) {
    const it = (shown ?? []).find((i) => i.path === picked)
    return [
      {
        name: picked.split("/").pop() ?? picked,
        folder: "",
        modified: it?.modified ?? null,
        size: it?.size ?? null,
      },
    ]
  }
  const top = await agentApi.cloudBrowse(remote, target)
  const out: CopyFile[] = top.items
    .filter((i) => !i.is_dir)
    .map((i) => ({
      name: i.name,
      folder: "",
      modified: i.modified,
      size: i.size,
    }))
  for (const dir of top.items.filter((i) => i.is_dir).slice(0, 60)) {
    const sub = await agentApi.cloudBrowse(remote, dir.path)
    out.push(
      ...sub.items
        .filter((i) => !i.is_dir)
        .map((i) => ({
          name: i.name,
          folder: dir.name,
          modified: i.modified,
          size: i.size,
        })),
    )
  }
  return out
}

function stateLabel(f: CloudFetch): string {
  switch (f.state) {
    case "copying":
      return "Copying from the storage…"
    case "uploading":
      return "Uploading into the app…"
    case "done":
    case "COMPLETED":
      return "Done: the run shows on the Process tab"
    case "failed":
    case "FAILED":
    case "ENDED":
      return "The copy did not finish"
    case "WAITING":
      return "Waiting for a free cluster job slot (starts by itself)…"
    case "PENDING":
    case "QUEUED":
      return "Waiting for the cluster to start the copy job…"
    case "RUNNING":
      return "Copying and uploading on the cluster…"
    default:
      return f.state
  }
}

function ConnectForm({
  providers,
  taken,
  where,
  onDone,
}: {
  providers: CloudProvider[]
  taken: string[]
  where: string
  onDone: (name: string) => void
}) {
  const [type, setType] = useState(providers[0]?.type ?? "box")
  const [name, setName] = useState(() => defaultName(type, taken))
  const [fields, setFields] = useState<Record<string, string>>({})
  const spec = providers.find((p) => p.type === type)
  const connect = useMutation({
    mutationFn: () => agentApi.cloudConnect({ name, type, fields }),
    onSuccess: (r) => {
      toast.success(`Connected ${r.name}`)
      onDone(r.name)
    },
  })
  return (
    <div className="space-y-2 rounded border p-3" data-testid="cloud-connect">
      <div className="flex flex-wrap gap-2">
        <Select
          value={type}
          onValueChange={(t) => {
            setType(t)
            setName(defaultName(t, taken))
            setFields({})
          }}
        >
          <SelectTrigger className="w-72" data-testid="cloud-provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providers.map((p) => (
              <SelectItem key={p.type} value={p.type}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="w-40"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          placeholder="name"
          aria-label="Connection name"
        />
      </div>
      {spec?.fields?.map((f) =>
        f.options ? (
          <Select
            key={f.key}
            value={fields[f.key] ?? ""}
            onValueChange={(v) => setFields((x) => ({ ...x, [f.key]: v }))}
          >
            <SelectTrigger className="w-72">
              <SelectValue placeholder={f.label} />
            </SelectTrigger>
            <SelectContent>
              {f.options.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            key={f.key}
            type={f.secret ? "password" : "text"}
            value={fields[f.key] ?? ""}
            onChange={(e) =>
              setFields((x) => ({ ...x, [f.key]: e.target.value }))
            }
            placeholder={f.label}
            autoComplete="off"
          />
        ),
      )}
      <p className="text-xs text-muted-foreground">
        {spec?.oauth
          ? `A browser window opens for you to sign in to ${spec.label}. The sign-in is kept ${where} only, for copies made there.`
          : `The settings are kept ${where} only, for copies made there.`}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!name || connect.isPending}
          onClick={() => connect.mutate()}
          data-testid="cloud-connect-save"
        >
          {connect.isPending && (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          )}
          {spec?.oauth ? "Sign in" : "Connect"}
        </Button>
        {connect.isPending && spec?.oauth && (
          <span className="text-xs text-muted-foreground">
            Waiting for you to finish signing in in the browser…
          </span>
        )}
      </div>
      {connect.error && (
        <p className="text-sm text-destructive">{String(connect.error)}</p>
      )}
    </div>
  )
}
