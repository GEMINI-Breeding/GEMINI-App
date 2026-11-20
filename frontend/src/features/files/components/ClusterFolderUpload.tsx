/**
 * Upload data that is already on the cluster: the person types the folder's
 * path (the app never searches the cluster's storage), looks at what is in
 * it, and a cluster job uploads it into the session with the same labels as
 * an upload from this computer. Shown only while a cluster is set up, to
 * administrators (the cluster is reached with this computer's SSH access).
 */
import { useMutation, useQuery } from "@tanstack/react-query"
import { FolderSearch, Loader2, Upload } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { agentApi, type SameFlightFolder } from "@/features/agent/lib/agentApi"
import { friendlyError } from "@/features/agent/lib/friendlyError"
import type { EntityChoice } from "./EntitySelectField"

/** The Files page's data types the cluster upload handles, by the uploader's name. */
export const CLUSTER_DATA_TYPES: Record<string, string> = {
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

/** The run's settings for the agent's uploader, from the Files page form. */
export function uploadSettings(
  dataType: string | null,
  formValues: Record<string, string>,
  scope: Record<string, EntityChoice>,
): Record<string, string> {
  return {
    experiment: label("experiment", formValues, scope),
    site: label("location", formValues, scope),
    population: label("population", formValues, scope),
    date: label("date", formValues, scope),
    platform: label("platform", formValues, scope),
    sensor: label("sensor", formValues, scope),
    data_type: CLUSTER_DATA_TYPES[dataType ?? ""],
    // Same-day batches are told apart by these (one upload per run or treatment).
    ...(formValues.treatment?.trim()
      ? { treatment: formValues.treatment.trim() }
      : {}),
    ...(formValues.run_of_day?.trim()
      ? { run_of_day: formValues.run_of_day.trim() }
      : {}),
  }
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
  // The flight's other cameras found beside the folder, by folder: upload it too, as which sensor.
  const [also, setAlso] = useState<
    Record<string, { on: boolean; sensor: string }>
  >({})
  const peek = useMutation({
    mutationFn: () => agentApi.clusterFolder(folder.trim()),
    onSuccess: (d) =>
      setAlso(
        Object.fromEntries(
          (d.same_flight ?? []).map((f) => [
            f.folder,
            { on: true, sensor: f.sensor },
          ]),
        ),
      ),
  })
  const sameFlight: SameFlightFolder[] = peek.data?.same_flight ?? []
  const ingest = useMutation({
    mutationFn: async () => {
      const base = uploadSettings(dataType, formValues, scope)
      const settings: Record<string, string> = {
        folder: folder.trim(),
        ...base,
      }
      if (nameEnds.trim()) settings.name_ends = nameEnds.trim()
      const first = await agentApi.clusterIngest(settings)
      const more: string[] = []
      // Each other camera as its own sensor, with the same labels (date, treatment, run).
      for (const f of sameFlight) {
        const pick = also[f.folder]
        if (!pick?.on || !pick.sensor.trim()) continue
        const r = await agentApi.clusterIngest({
          ...base,
          folder: f.folder,
          sensor: pick.sensor.trim(),
          ...(f.name_ends ? { name_ends: f.name_ends } : {}),
        })
        more.push(`${pick.sensor}: ${r.result.trim().split("\n").pop()}`)
      }
      return {
        result: [first.result.trim(), ...more].join("\n"),
        others: more.length,
      }
    },
    onSuccess: (d) =>
      toast.success(
        d.others
          ? `Submitted: cluster jobs are uploading the folder and ${d.others} other camera${d.others > 1 ? "s" : ""} of the flight. The runs show on the Process tab when they are done.`
          : "Submitted: a cluster job is uploading the folder. The run shows on the Process tab when it is done.",
      ),
  })

  const kind = CLUSTER_DATA_TYPES[dataType ?? ""]
  if (!compute?.cluster || !kind) return null
  if (formValues.date_mode === "files")
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="cluster-folder-upload"
      >
        Dates read from the files work for uploads from this computer and from
        online storage. A folder on the cluster goes up with one date: choose
        "One date" on the left, and upload each date's folder on its own.
      </p>
    )
  const absolute = folder.trim().startsWith("/")

  return (
    <div className="space-y-3" data-testid="cluster-folder-upload">
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
        <p className="text-sm text-destructive">{friendlyError(peek.error)}</p>
      )}
      {sameFlight.length > 0 && (
        <div
          className="space-y-2 rounded-md border p-3"
          data-testid="cluster-same-flight"
        >
          <p className="text-sm font-medium">Other cameras of this flight</p>
          <p className="text-xs text-muted-foreground">
            Frames beside this folder taken at the same moments. Uploaded with
            the same labels as their own sensor, they come out of the plot
            images step with the RGB frames, cut per plot (a thermal camera also
            gives each plot's canopy temperature).
          </p>
          {sameFlight.map((f) => (
            <div key={f.folder} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={also[f.folder]?.on ?? false}
                onCheckedChange={(v) =>
                  setAlso((a) => ({
                    ...a,
                    [f.folder]: { ...a[f.folder], on: v === true },
                  }))
                }
                aria-label={`Upload ${f.folder} too`}
              />
              <span className="min-w-0 flex-1 truncate" title={f.folder}>
                {f.folder.split("/").pop()} — {f.files} frames
                {f.name_ends ? ` (${f.name_ends})` : ""}
              </span>
              <span className="text-xs text-muted-foreground">as sensor</span>
              <Input
                className="h-8 w-36"
                value={also[f.folder]?.sensor ?? f.sensor}
                onChange={(e) =>
                  setAlso((a) => ({
                    ...a,
                    [f.folder]: {
                      on: a[f.folder]?.on ?? true,
                      sensor: e.target.value,
                    },
                  }))
                }
              />
            </div>
          ))}
        </div>
      )}
      <Input
        value={nameEnds}
        onChange={(e) => setNameEnds(e.target.value)}
        placeholder="Only files whose names end with … (optional, e.g. _V.JPG)"
      />
      <div className="flex items-center gap-3">
        <Button
          disabled={disabled || !absolute || !peek.data || ingest.isPending}
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
              : null}
        </span>
      </div>
      {ingest.data && (
        <pre className="max-h-32 overflow-auto rounded bg-muted p-2 text-xs">
          {ingest.data.result}
        </pre>
      )}
      {ingest.error && (
        <p className="text-sm text-destructive">
          {friendlyError(ingest.error)}
        </p>
      )}
    </div>
  )
}
