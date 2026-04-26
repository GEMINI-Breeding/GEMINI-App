/**
 * InferencePage — run LOCATE_PLANTS over the per-plot PNGs of a flight scope.
 *
 * Worker contract (backend/gemini/workers/ml/worker.py:_locate_plants_job):
 *   image_path: MinIO object path to a PNG/JPEG
 *   api_key:    Roboflow API key
 *   model_id:   "workspace/project/version" (or "workspace/project")
 *   confidence_threshold, iou_threshold, crop_size, overlap (all optional)
 *   output_predictions_path: optional MinIO path to write prediction JSON
 *
 * The page:
 *   1. lets the user pick a registered Model row + the aerial scope,
 *   2. lists per-plot PNGs already produced by the SPLIT step,
 *   3. submits one LOCATE_PLANTS job per plot (bounded concurrency),
 *   4. each job is registered in the global ProcessContext so the bottom
 *      ProcessPanel surfaces wsManager-driven progress + Cancel.
 *
 * The Roboflow API key is stored in the user's `user_info.roboflow_api_key`
 * — keeping it off the Model row means a model registry can be shared
 * without leaking credentials. Saved via UsersService.apiUsersMeUpdateMe.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronLeft, Play } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import {
  FilesService,
  UsersService,
  type FileMetadata,
  type ModelOutput,
  type UserOutput,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useExperimentScope } from "@/contexts/ExperimentContext"
import { useProcess } from "@/contexts/ProcessContext"
import {
  AerialScopePicker,
  buildAerialScope,
  readStoredAerialFields,
  useAerialScopeContext,
  writeStoredAerialFields,
  type AerialScopeFields,
} from "@/features/process/components/AerialScopePicker"
import {
  isAerialScopeComplete,
  plotImagesPrefix,
} from "@/features/process/lib/paths"
import { useCancelJob, useSubmitJob } from "@/features/process/hooks/useJobs"
import { modelInfo, useModels } from "@/features/models/hooks/useModels"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { isLoggedIn } from "@/lib/auth"

const DEFAULT_BUCKET = "gemini"
const MAX_CONCURRENT = 4

type UserInfoShape = {
  roboflow_api_key?: string
  [key: string]: unknown
}

function readUserInfo(user: UserOutput | null | undefined): UserInfoShape {
  const raw = (user?.user_info ?? {}) as unknown
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as UserInfoShape
    } catch {
      return {}
    }
  }
  if (raw && typeof raw === "object") return raw as UserInfoShape
  return {}
}

export function InferencePage() {
  const ctx = useAerialScopeContext()
  const { experimentId } = useExperimentScope()
  const { addProcess } = useProcess()
  const { user } = useAuth()
  const submit = useSubmitJob()
  const cancel = useCancelJob()
  const qc = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const models = useModels()

  const [fields, setFields] = useState<AerialScopeFields>(() => readStoredAerialFields())
  useEffect(() => writeStoredAerialFields(fields), [fields])

  const scope = useMemo(() => {
    const s = buildAerialScope(ctx, fields)
    return isAerialScopeComplete(s) ? s : null
  }, [ctx, fields])

  const [selectedModelId, setSelectedModelId] = useState<string>("")
  useEffect(() => {
    if (!selectedModelId && models.data && models.data.length > 0) {
      const best = models.data.find((m) => modelInfo(m).best_model_path)
      setSelectedModelId(String((best ?? models.data[0]).id ?? ""))
    }
  }, [models.data, selectedModelId])

  const selectedModel = useMemo<ModelOutput | null>(() => {
    return models.data?.find((m) => String(m.id) === selectedModelId) ?? null
  }, [models.data, selectedModelId])

  const userInfo = readUserInfo(user)
  const [apiKey, setApiKey] = useState<string>("")
  useEffect(() => {
    setApiKey(userInfo.roboflow_api_key ?? "")
    // Re-sync only when the user object actually changes; the empty-deps
    // approach would miss the first hydrate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const saveKey = useMutation<unknown, Error, string>({
    mutationFn: async (key) => {
      const next: UserInfoShape = { ...userInfo, roboflow_api_key: key }
      return UsersService.apiUsersMeUpdateMe({
        requestBody: { user_info: next as Record<string, unknown> },
      })
    },
    onSuccess: () => {
      showSuccessToast("Roboflow API key saved")
      qc.invalidateQueries({ queryKey: ["currentUser"] })
    },
    onError: (err) => showErrorToast(err.message),
  })

  const plotImagesQuery = useQuery<FileMetadata[], Error>({
    queryKey: ["files", "list", scope ? plotImagesPrefix(scope) : null],
    queryFn: async () => {
      if (!scope) return []
      try {
        const res = await FilesService.apiFilesListFilePathListFiles({
          filePath: `${DEFAULT_BUCKET}/${plotImagesPrefix(scope)}`,
        })
        return ((res as FileMetadata[] | null) ?? []).filter((f) =>
          /\.(png|jpe?g)$/i.test(f.object_name ?? ""),
        )
      } catch {
        return []
      }
    },
    enabled: isLoggedIn() && Boolean(scope),
    refetchInterval: 15_000,
  })

  const plotImages = plotImagesQuery.data ?? []

  const info = selectedModel ? modelInfo(selectedModel) : null
  const canRun =
    Boolean(scope) &&
    Boolean(info?.roboflow_model_id) &&
    Boolean(apiKey) &&
    plotImages.length > 0

  const [running, setRunning] = useState(false)

  async function runBatch() {
    if (!scope || !selectedModel || !info?.roboflow_model_id || !apiKey) return
    setRunning(true)
    try {
      const queue = plotImages.slice()
      let inFlight = 0
      let submitted = 0
      let failures = 0

      await new Promise<void>((resolve) => {
        const tryStart = () => {
          while (inFlight < MAX_CONCURRENT && queue.length > 0) {
            const file = queue.shift()
            if (!file) break
            inFlight++
            void submitOne(file)
              .then(() => {
                submitted++
              })
              .catch(() => {
                failures++
              })
              .finally(() => {
                inFlight--
                if (queue.length === 0 && inFlight === 0) resolve()
                else tryStart()
              })
          }
          if (queue.length === 0 && inFlight === 0) resolve()
        }
        tryStart()
      })

      if (failures > 0) {
        showErrorToast(`Submitted ${submitted}, ${failures} failed to submit`)
      } else {
        showSuccessToast(`Submitted ${submitted} inference job(s)`)
      }
    } finally {
      setRunning(false)
    }

    async function submitOne(file: FileMetadata) {
      const objectPath = file.object_name ?? ""
      const filename = objectPath.split("/").pop() ?? "plot"
      const job = await submit.mutateAsync({
        jobType: "LOCATE_PLANTS",
        parameters: {
          image_path: objectPath,
          api_key: apiKey,
          model_id: info!.roboflow_model_id,
          // Predictions land alongside the plot image as a sibling .json so
          // a follow-up Analyze step can read them without rerunning.
          output_predictions_path: objectPath.replace(/\.(png|jpe?g)$/i, ".predictions.json"),
        },
        experimentId: experimentId,
      })
      const jobId = String(job.id ?? "")
      addProcess({
        type: "processing",
        title: `Inference: ${filename}`,
        status: "running",
        items: [],
        runId: jobId,
        link: `/process/jobs/${jobId}`,
        cancel: () => cancel.mutate(jobId),
      })
    }
  }

  return (
    <div className="container max-w-5xl space-y-4 px-4 py-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link to="/models">
            <ChevronLeft className="mr-1 h-4 w-4" /> Models
          </Link>
        </Button>
      </div>

      <header>
        <h1 className="text-xl font-semibold">Run inference</h1>
        <p className="text-muted-foreground text-sm">
          Send each per-plot image to Roboflow via the LOCATE_PLANTS worker.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Model</CardTitle>
          <CardDescription>Pick a registered Roboflow model.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="model">Model</Label>
            <Select value={selectedModelId} onValueChange={setSelectedModelId}>
              <SelectTrigger id="model" data-testid="inference-model">
                <SelectValue placeholder={models.isLoading ? "Loading…" : "Pick a model"} />
              </SelectTrigger>
              <SelectContent>
                {(models.data ?? []).map((m) => {
                  const minfo = modelInfo(m)
                  return (
                    <SelectItem key={String(m.id)} value={String(m.id)}>
                      {m.model_name}
                      {minfo.best_model_path ? " · best" : ""}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            {selectedModel && info && (
              <p className="text-xs text-muted-foreground">
                Roboflow id: <code>{info.roboflow_model_id ?? "unset"}</code>
                {info.task_type ? ` · ${info.task_type}` : ""}
              </p>
            )}
            {selectedModel && !info?.roboflow_model_id && (
              <p className="text-xs text-amber-600">
                This model has no Roboflow id set. Edit it on the Models page first.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="apikey">Roboflow API key</Label>
            <div className="flex gap-2">
              <Input
                id="apikey"
                data-testid="inference-api-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="rf_…"
              />
              <Button
                variant="outline"
                size="sm"
                data-testid="inference-save-key"
                onClick={() => saveKey.mutate(apiKey)}
                disabled={!apiKey || saveKey.isPending}
              >
                {saveKey.isPending ? "Saving…" : "Save to my profile"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Stored on your user record (<code>user_info.roboflow_api_key</code>),
              not on the model. Re-enter it on a different account.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Flight scope</CardTitle>
          <CardDescription>
            Inference runs on every PNG under{" "}
            <code>Processed/.../PlotImages/</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <AerialScopePicker value={fields} onChange={setFields} />
          <p className="text-xs text-muted-foreground">
            {scope
              ? plotImagesQuery.isLoading
                ? "Loading plot images…"
                : `${plotImages.length} plot image(s) found.`
              : "Pick a complete scope above."}
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{plotImages.length} plot images</Badge>
          {running && <span className="text-sm text-muted-foreground">submitting…</span>}
        </div>
        <Button
          data-testid="inference-run"
          disabled={!canRun || running}
          onClick={runBatch}
        >
          <Play className="mr-1.5 h-4 w-4" />
          {running ? "Submitting…" : "Run inference"}
        </Button>
      </div>
    </div>
  )
}
