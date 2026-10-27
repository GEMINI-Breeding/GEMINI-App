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
  type CloudProvider,
} from "@/features/agent/lib/agentApi"
import { CLUSTER_DATA_TYPES, uploadSettings } from "./ClusterFolderUpload"
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
  const [fetchId, setFetchId] = useState<string | null>(null)

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
    mutationFn: () => {
      const settings = uploadSettings(dataType, formValues, scope)
      if (nameEnds.trim()) settings.name_ends = nameEnds.trim()
      return agentApi.cloudFetch({
        name: remote,
        path: picked ?? path,
        settings,
        keep,
      })
    },
    onSuccess: (f) => setFetchId(f.id),
  })

  const progress = useQuery({
    queryKey: ["agent", "cloud", "fetch", fetchId],
    queryFn: () => agentApi.cloudFetchState(fetchId as string),
    enabled: Boolean(fetchId),
    refetchInterval: (q) =>
      q.state.data && isFinished(q.state.data) ? false : 5000,
  })
  const finished = progress.data && isFinished(progress.data)
  useEffect(() => {
    if (!progress.data || !isFinished(progress.data)) return
    if (isFailure(progress.data))
      toast.error("The copy did not finish; see the details under it.")
    else toast.success("Copied and uploaded. The run shows on the Process tab.")
  }, [progress.data])

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
              disabled={
                disabled || start.isPending || Boolean(fetchId && !finished)
              }
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
            <p className="text-sm text-destructive">{String(start.error)}</p>
          )}
        </div>
      )}

      {fetchId && progress.data && (
        <div
          className="space-y-1 rounded bg-muted p-2 text-xs"
          data-testid="cloud-progress"
        >
          <p className="flex items-center gap-2 font-medium">
            {!finished && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {stateLabel(progress.data)}
          </p>
          {progress.data.line && <p>{progress.data.line}</p>}
          {progress.data.error && (
            <p className="text-destructive">{progress.data.error}</p>
          )}
        </div>
      )}
    </div>
  )
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
