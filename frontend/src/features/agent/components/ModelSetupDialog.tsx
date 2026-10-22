/**
 * ModelSetupDialog — give the agent an open model before there is an agent.
 *
 * The agent can set everything else up, but not the model it thinks with.
 * Here a person picks one from a short list and where it should run:
 *
 *   - this computer (Ollama downloads and serves it), or
 *   - a cluster (GEMI surveys it over SSH, installs the model server and the
 *     weights, starts it on a GPU and connects).
 *
 * Both are fixed sequences the agent service runs; this dialog shows each
 * step with its expected and actual time.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Circle, Loader2, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { InstallHelper } from "@/features/agent/components/InstallHelper"
import {
  agentApi,
  type ClusterModelPlan,
  type ModelSetupJob,
  type OpenModel,
} from "@/features/agent/lib/agentApi"

function duration(seconds: number): string {
  if (seconds < 50) return `${Math.max(1, Math.round(seconds / 5) * 5)} s`
  if (seconds < 3300) return `${Math.max(1, Math.round(seconds / 60))} min`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60 / 5) * 5
  return m ? `${h} h ${m} min` : `${h} h`
}

function Progress({ job }: { job: ModelSetupJob }) {
  const left = job.steps
    .filter((s) => s.status === "waiting" || s.status === "running")
    .reduce(
      (sum, s) =>
        sum +
        (s.status === "running"
          ? (s.remaining_s ?? Math.max(s.estimate_s - (s.running_s ?? 0), 0))
          : s.estimate_s),
      0,
    )
  return (
    <div className="space-y-2" data-testid="model-setup-progress">
      <p className="text-sm">
        <span className="font-medium">{job.label}</span>{" "}
        {job.where === "local" ? "on this computer" : "on the cluster"}
        {job.state === "running" && (
          <span className="text-muted-foreground">
            {" "}
            · about {duration(left)} left (expected {duration(job.estimate_s)}{" "}
            in all, {duration(job.elapsed_s)} so far)
          </span>
        )}
        {job.state === "done" && (
          <span className="text-emerald-600 dark:text-emerald-400">
            {" "}
            · ready, the agent is using it (took {duration(job.elapsed_s)})
          </span>
        )}
      </p>
      <ol className="space-y-1.5">
        {job.steps.map((s) => (
          <li key={s.name} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5">
              {s.status === "done" ? (
                <Check className="h-4 w-4 text-emerald-600" />
              ) : s.status === "running" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : s.status === "failed" ? (
                <X className="h-4 w-4 text-red-600" />
              ) : (
                <Circle className="text-muted-foreground h-4 w-4" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              {s.name}
              <span className="text-muted-foreground block text-xs">
                {s.status === "waiting" &&
                  (s.estimate_s
                    ? `expected ${duration(s.estimate_s)}`
                    : "nothing to do")}
                {s.status === "running" &&
                  `${duration(s.running_s ?? 0)} of an expected ${duration(s.estimate_s)}` +
                    (typeof s.percent === "number" ? ` · ${s.percent}%` : "")}
                {s.status === "done" && `took ${duration(s.seconds ?? 0)}`}
                {s.detail ? ` · ${s.detail}` : ""}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {job.state === "failed" && job.error && (
        <p className="text-sm whitespace-pre-wrap text-red-700 dark:text-red-400">
          {job.error}
        </p>
      )}
    </div>
  )
}

/**
 * The model list, the two places to run one, and the progress of a set-up.
 * `fits`: per model, whether it will run on this computer (from the
 * walkthrough's look at memory and graphics card). `initial`: the model to
 * preselect. `onDone`: called once a set-up has finished and the agent uses it.
 */
export function ModelSetupPanel({
  canEdit,
  active = true,
  fits,
  initial,
  onDone,
}: {
  canEdit: boolean
  active?: boolean
  fits?: Record<string, { fit: "yes" | "slow" | "no"; why: string }>
  initial?: string | null
  onDone?: () => void
}) {
  const open = active
  const queryClient = useQueryClient()
  const [picked, setPicked] = useState(initial ?? "gemma4-31b")
  const [where, setWhere] = useState<"local" | "cluster">("local")
  const [ssh, setSsh] = useState("")
  const [plan, setPlan] = useState<ClusterModelPlan | null>(null)
  const [error, setError] = useState<string | null>(null)

  const setup = useQuery({
    queryKey: ["agent", "model_setup"],
    queryFn: agentApi.modelSetup,
    enabled: open,
    refetchInterval: (q) =>
      q.state.data?.job?.state === "running" ? 2_000 : false,
  })
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e))
  const started = () => {
    setError(null)
    queryClient.invalidateQueries({ queryKey: ["agent", "model_setup"] })
  }
  // When a setup finishes, the agent's model has changed: refresh what the page shows.
  const done = setup.data?.job?.state === "done"
  // onDone is the caller's and may change every render; keep the latest in a ref.
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  useEffect(() => {
    if (!done) return
    queryClient.invalidateQueries({ queryKey: ["agent", "config"] })
    queryClient.invalidateQueries({ queryKey: ["agent", "onboarding"] })
    onDoneRef.current?.()
  }, [done, queryClient])

  const local = useMutation({
    mutationFn: () => agentApi.modelSetupLocal(picked),
    onSuccess: started,
    onError: fail,
  })
  const survey = useMutation({
    mutationFn: () => agentApi.modelSetupClusterPlan(ssh.trim() || undefined),
    onSuccess: (p) => {
      setError(null)
      setPlan(p)
    },
    onError: fail,
  })
  const cluster = useMutation({
    mutationFn: () =>
      agentApi.modelSetupCluster(picked, plan as ClusterModelPlan),
    onSuccess: started,
    onError: fail,
  })

  const data = setup.data
  const job = data?.job
  const running = job?.state === "running"
  const model: OpenModel | undefined = data?.models.find(
    (m) => m.key === picked,
  )
  const ollama = data?.local.ollama
  const installed = model ? data?.local.installed.includes(model.ollama) : false
  const configured = data?.cluster

  return (
    <div className="space-y-4">
      {job && (
        <div className="rounded-md border p-3">
          <Progress job={job} />
        </div>
      )}

      {!running && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>1. Model</Label>
            <div className="grid gap-1.5">
              {setup.isLoading && (
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking which
                  models suit this computer…
                </p>
              )}
              {setup.isError && (
                <p className="text-destructive text-sm">
                  Could not reach the agent service to list models. Is it
                  running?
                </p>
              )}
              {(data?.models ?? []).map((m) => (
                <button
                  type="button"
                  key={m.key}
                  data-testid={`model-${m.key}`}
                  onClick={() => {
                    setPicked(m.key)
                    if (!m.hf) setWhere("local")
                  }}
                  className={`rounded-md border px-3 py-2 text-left text-sm ${picked === m.key ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
                >
                  <span className="font-medium">{m.label}</span>
                  <span className="text-muted-foreground"> · {m.by}</span>
                  {fits?.[m.key] && (
                    <span
                      title={fits[m.key].why}
                      className={`ml-2 rounded px-1.5 py-0.5 text-xs ${
                        fits[m.key].fit === "yes"
                          ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                          : fits[m.key].fit === "slow"
                            ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {fits[m.key].fit === "yes"
                        ? "runs well on this computer"
                        : fits[m.key].fit === "slow"
                          ? "slow on this computer"
                          : "too large for this computer"}
                    </span>
                  )}
                  {m.checks ? (
                    <span
                      title={
                        m.checks.weak.length
                          ? `Not passed every time: ${m.checks.weak.join("; ")}`
                          : "Passed every check of the pipeline steps"
                      }
                      className={`ml-2 rounded px-1.5 py-0.5 text-xs ${
                        m.checks.passed / m.checks.of >= 0.9
                          ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                          : m.checks.passed / m.checks.of >= 0.7
                            ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      passed {m.checks.passed} of {m.checks.of} GEMI checks
                    </span>
                  ) : (
                    m.tested && (
                      <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                        used on full runs
                      </span>
                    )
                  )}
                  <span className="text-muted-foreground block text-xs">
                    {m.note} About {m.disk_gb} GB to download here
                    {m.gpu_gb ? `; a ${m.gpu_gb} GB GPU on a cluster.` : "."}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>2. Where it runs</Label>
            <div className="flex gap-2">
              <Button
                variant={where === "local" ? "default" : "outline"}
                size="sm"
                onClick={() => setWhere("local")}
              >
                This computer
              </Button>
              <Button
                variant={where === "cluster" ? "default" : "outline"}
                size="sm"
                disabled={!model?.hf}
                onClick={() => setWhere("cluster")}
              >
                A cluster (HPC)
              </Button>
            </div>
          </div>

          {where === "local" && model && (
            <div className="space-y-2 text-sm" data-testid="model-setup-local">
              {ollama === "missing" ? (
                <>
                  <p>
                    Running a model here uses Ollama, a free program that
                    downloads and serves models. GEMI installs it for you (no
                    administrator rights needed), then you choose the model.
                  </p>
                  <InstallHelper
                    what="ollama"
                    onReady={() =>
                      queryClient.invalidateQueries({
                        queryKey: ["agent", "model_setup"],
                      })
                    }
                  />
                </>
              ) : (
                <>
                  <p className="text-muted-foreground">
                    {installed
                      ? `${model.label} is already downloaded.`
                      : `Downloads about ${model.disk_gb} GB (roughly ${duration((model.disk_gb * 1000) / 25)} on a fast connection), then loads it.`}{" "}
                    {fits?.[model.key]
                      ? `On this computer: ${fits[model.key].why}.`
                      : `Needs about ${Math.ceil(model.disk_gb * 1.3)} GB of free memory (GPU, or RAM on a Mac) to answer at a usable speed.`}
                    {ollama === "installed" &&
                      " Ollama is installed but not running; GEMI will start it."}
                  </p>
                  <Button
                    disabled={!canEdit || local.isPending}
                    data-testid="model-setup-local-start"
                    onClick={() => local.mutate()}
                  >
                    {installed ? "Use it" : "Download and use it"}
                  </Button>
                </>
              )}
            </div>
          )}

          {where === "cluster" && model && (
            <div
              className="space-y-2 text-sm"
              data-testid="model-setup-cluster"
            >
              {!plan && (
                <>
                  {configured ? (
                    <p className="text-muted-foreground">
                      The cluster{" "}
                      <span className="font-mono">{configured}</span> is already
                      set up. Leave the box empty to use it, or give another
                      login.
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      The SSH command you log in with. Key-based login must
                      already work (no password or two-factor prompt).
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Input
                      value={ssh}
                      placeholder="ssh you@login.cluster.edu"
                      data-testid="model-setup-ssh"
                      onChange={(e) => setSsh(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      disabled={
                        !canEdit ||
                        survey.isPending ||
                        (!configured && !ssh.trim())
                      }
                      onClick={() => survey.mutate()}
                    >
                      {survey.isPending && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      Look at the cluster
                    </Button>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Looking only reads (about 15 s): which GPU queues you can
                    use, how long they wait, where there is storage.
                  </p>
                </>
              )}
              {plan && (
                <div className="space-y-2 rounded-md border p-3">
                  <p>
                    <span className="font-medium">{plan.host}</span>
                    {plan.configured
                      ? " (settings already there)"
                      : plan.existing_install
                        ? " (GEMI is already installed there)"
                        : ""}
                  </p>
                  <ul className="text-muted-foreground list-disc space-y-0.5 pl-5 text-xs">
                    <li>
                      GPU queues to try, in order:{" "}
                      <span className="font-mono">
                        {plan.llm_try.join(", ")}
                      </span>
                    </li>
                    <li>
                      Data and model files in{" "}
                      <span className="font-mono">{plan.data_root}</span>
                    </li>
                    <li>
                      Wait for a GPU right now:{" "}
                      {plan.gpu_wait_min == null
                        ? "not measured"
                        : plan.gpu_wait_min <= 1
                          ? "none"
                          : `about ${plan.gpu_wait_min} min`}
                    </li>
                    <li>
                      Model server:{" "}
                      {plan.server_installed
                        ? "installed"
                        : "to install (about 15 min, once)"}
                      ; {model.label} needs a {model.gpu_gb} GB GPU
                    </li>
                  </ul>
                  <div className="flex gap-2">
                    <Button
                      disabled={!canEdit || cluster.isPending}
                      data-testid="model-setup-cluster-start"
                      onClick={() => cluster.mutate()}
                    >
                      Set it up
                    </Button>
                    <Button variant="ghost" onClick={() => setPlan(null)}>
                      Another cluster
                    </Button>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    This writes GEMI's settings for the cluster on this
                    computer, copies its scripts there, and submits jobs under
                    your account (a download job, then one GPU job that runs
                    until you stop it in the Compute panel).
                  </p>
                </div>
              )}
            </div>
          )}
          {!canEdit && (
            <p className="text-muted-foreground text-xs">
              Only an administrator can set the agent's model up.
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="text-sm whitespace-pre-wrap text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}

export function ModelSetupDialog({
  open,
  onOpenChange,
  canEdit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  canEdit: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        data-testid="model-setup"
      >
        <DialogHeader>
          <DialogTitle>Set up an open model for the agent</DialogTitle>
          <DialogDescription>
            Free models you run yourself: nothing leaves your computer or your
            cluster. No agent is needed for this; GEMI does the steps and shows
            how long each should take.
          </DialogDescription>
        </DialogHeader>
        <ModelSetupPanel canEdit={canEdit} active={open} />
      </DialogContent>
    </Dialog>
  )
}
