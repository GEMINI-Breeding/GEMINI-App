/**
 * Upload data that is already on the cluster: the person types the folder's
 * path (the app never searches the cluster's storage), looks at what is in
 * it, and a cluster job uploads it into the session with the same labels as
 * an upload from this computer. Shown only while a cluster is set up, to
 * administrators (the cluster is reached with this computer's SSH access).
 */
import { useMutation, useQuery } from "@tanstack/react-query"
import { FolderSearch, Loader2, Server, Upload } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { agentApi } from "@/features/agent/lib/agentApi"
import type { EntityChoice } from "./EntitySelectField"

/** The Files page's data types the cluster upload handles, by the uploader's name. */
const CLUSTER_DATA_TYPES: Record<string, string> = {
  "Image Data": "images",
  "Farm-ng Binary File": "amiga_bin",
  Orthomosaic: "orthomosaic",
}

function label(
  field: string,
  values: Record<string, string>,
  scope: Record<string, EntityChoice>,
): string {
  const c = scope[field]
  if (c && (c.kind === "existing" || c.kind === "new") && c.name.trim())
    return c.name.trim()
  return (values[field] ?? "").trim()
}

export function ClusterFolderUpload({
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
  const { data: compute } = useQuery({
    queryKey: ["agent", "compute"],
    queryFn: () => agentApi.compute(),
    staleTime: 30_000,
    retry: false,
  })
  const [folder, setFolder] = useState("")
  const [nameEnds, setNameEnds] = useState("")
  const peek = useMutation({
    mutationFn: () => agentApi.clusterFolder(folder.trim()),
  })
  const ingest = useMutation({
    mutationFn: () => {
      const settings: Record<string, string> = {
        folder: folder.trim(),
        experiment: label("experiment", formValues, scope),
        site: label("location", formValues, scope),
        population: label("population", formValues, scope),
        date: label("date", formValues, scope),
        platform: label("platform", formValues, scope),
        sensor: label("sensor", formValues, scope),
        data_type: CLUSTER_DATA_TYPES[dataType ?? ""],
      }
      if (nameEnds.trim()) settings.name_ends = nameEnds.trim()
      return agentApi.clusterIngest(settings)
    },
    onSuccess: () =>
      toast.success(
        "Submitted: a cluster job is uploading the folder. The run shows on the Process tab when it is done.",
      ),
  })

  const kind = CLUSTER_DATA_TYPES[dataType ?? ""]
  if (!compute?.cluster || !kind) return null
  const spaced = ["experiment", "location", "population", "platform", "sensor"]
    .map((f) => label(f, formValues, scope))
    .some((v) => /\s/.test(v))
  const absolute = folder.trim().startsWith("/")

  return (
    <div
      className="space-y-3 rounded-lg border p-4"
      data-testid="cluster-folder-upload"
    >
      <div className="flex items-center gap-2">
        <Server className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium">
          Or upload a folder that is on {compute.cluster}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Type the folder's full path on the cluster (or its parent folder). The
        app looks only there, never through the cluster's storage, and the files
        are uploaded by a cluster job, not copied to this computer.
      </p>
      <div className="flex gap-2">
        <Input
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="/group/yourlab/data/2025-07-01/Drone/RGB"
          data-testid="cluster-folder-path"
        />
        <Button
          variant="outline"
          disabled={!absolute || peek.isPending}
          onClick={() => peek.mutate()}
        >
          {peek.isPending ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <FolderSearch className="mr-1.5 h-4 w-4" />
          )}
          Look
        </Button>
      </div>
      {peek.data && (
        <pre
          className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs"
          data-testid="cluster-folder-peek"
        >
          {peek.data.result}
        </pre>
      )}
      {peek.error && (
        <p className="text-sm text-destructive">{String(peek.error)}</p>
      )}
      <Input
        value={nameEnds}
        onChange={(e) => setNameEnds(e.target.value)}
        placeholder="Only files whose names end with … (optional, e.g. _V.JPG)"
      />
      <div className="flex items-center gap-3">
        <Button
          disabled={
            disabled || !absolute || !peek.data || spaced || ingest.isPending
          }
          onClick={() => ingest.mutate()}
          data-testid="cluster-folder-ingest"
        >
          {ingest.isPending ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-1.5 h-4 w-4" />
          )}
          Upload from the cluster
        </Button>
        <span className="text-xs text-muted-foreground">
          {disabled
            ? disabledReason
            : !peek.data
              ? "Look at the folder first."
              : spaced
                ? "Names with spaces cannot be sent to the cluster yet."
                : null}
        </span>
      </div>
      {ingest.data && (
        <pre className="max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
          {ingest.data.result}
        </pre>
      )}
      {ingest.error && (
        <p className="text-sm text-destructive">{String(ingest.error)}</p>
      )}
    </div>
  )
}
