/**
 * AgentHome — the app's home page: configure the agent's model, start a run
 * (optionally following a skill), and watch what it does.
 *
 * Layout: runs + stack status on the left, the selected run's conversation
 * in the middle, model settings in a dialog. The conversation is the run's
 * event log from the agent service, polled while the run is working.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertCircle,
  Bot,
  Check,
  ChevronRight,
  Cpu,
  Loader2,
  Plus,
  Send,
  Settings,
  Square,
  Wrench,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { AgentText } from "@/features/agent/components/AgentText"
import { ComputePanel } from "@/features/agent/components/ComputePanel"
import {
  type AgentConfig,
  type AgentEvent,
  type AgentRun,
  type AgentRunStatus,
  agentApi,
  takeAgentRequest,
} from "@/features/agent/lib/agentApi"
import useAuth from "@/hooks/useAuth"
import { openUrl } from "@/lib/platform"

const NO_SKILL = "__none__"

/**
 * Where the agent's model runs. Every choice is an OpenAI-compatible chat
 * endpoint; a preset only fills in the address and a sensible model name.
 */
const PROVIDERS = [
  {
    id: "anthropic",
    label: "Claude (Anthropic)",
    base_url: "https://api.anthropic.com/v1",
    model: "claude-sonnet-5-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
    note: "Needs an API key from the Anthropic Console (a Claude.ai subscription login cannot be used by other apps).",
  },
  {
    id: "openai",
    label: "OpenAI",
    base_url: "https://api.openai.com/v1",
    model: "gpt-4o",
    keyUrl: "https://platform.openai.com/api-keys",
    note: "Needs an OpenAI API key.",
  },
  {
    id: "local",
    label: "A model you run (cluster, vLLM, Ollama)",
    base_url: "http://127.0.0.1:8000/v1",
    model: "gemma4",
    keyUrl: "",
    note: "On a cluster: start the Agent model in the Compute panel; the address is filled in when it connects.",
  },
] as const

function providerOf(url: string | undefined): string {
  if (!url) return "local"
  if (url.includes("anthropic.com")) return "anthropic"
  if (url.includes("openai.com")) return "openai"
  return "local"
}

const STATUS_LABEL: Record<AgentRunStatus, string> = {
  idle: "Idle",
  running: "Working",
  awaiting_approval: "Needs approval",
  waiting: "Waiting for you",
  failed: "Failed",
  cancelled: "Stopped",
  interrupted: "Interrupted",
}

function StatusBadge({ status }: { status: AgentRunStatus }) {
  const tone =
    status === "running"
      ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200"
      : status === "awaiting_approval"
        ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        : status === "failed"
          ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
          : "bg-muted text-muted-foreground"
  return (
    <Badge variant="secondary" className={`${tone} gap-1 font-normal`}>
      {status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
      {STATUS_LABEL[status]}
    </Badge>
  )
}

// ── Model settings ──────────────────────────────────────────────────────────

function SettingsDialog({
  open,
  onOpenChange,
  config,
  canEdit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: AgentConfig | undefined
  canEdit: boolean
}) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Partial<AgentConfig>>({})
  const [test, setTest] = useState<string | null>(null)
  useEffect(() => {
    if (open && config) {
      setDraft({ ...config, api_key: "" })
      setTest(null)
    }
  }, [open, config])

  const save = useMutation({
    mutationFn: () => agentApi.saveConfig(draft),
    onSuccess: (saved) => {
      queryClient.setQueryData(["agent", "config"], saved)
      setTest(null)
    },
  })
  const runTest = useMutation({
    mutationFn: async () => {
      await agentApi.saveConfig(draft)
      return agentApi.testConfig()
    },
    onSuccess: (r) =>
      setTest(
        r.ok
          ? `Model answered in ${r.seconds}s: “${r.reply}”`
          : `No answer: ${r.error}`,
      ),
    onError: (e) => setTest(e instanceof Error ? e.message : String(e)),
  })

  const set = (patch: Partial<AgentConfig>) =>
    setDraft((d) => ({ ...d, ...patch }))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Agent model</DialogTitle>
          <DialogDescription>
            Any OpenAI-compatible chat endpoint: a model you run yourself (vLLM,
            Ollama, llama.cpp) or a hosted one.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Provider</Label>
            <Select
              value={providerOf(draft.base_url)}
              disabled={!canEdit}
              onValueChange={(id) => {
                const p = PROVIDERS.find((x) => x.id === id)
                if (p) set({ base_url: p.base_url, model: p.model })
              }}
            >
              <SelectTrigger data-testid="agent-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(() => {
              const p = PROVIDERS.find(
                (x) => x.id === providerOf(draft.base_url),
              )
              return p ? (
                <p className="text-muted-foreground text-xs">
                  {p.note}{" "}
                  {p.keyUrl && (
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={() => openUrl(p.keyUrl)}
                    >
                      Get a key
                    </button>
                  )}
                </p>
              ) : null
            })()}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="agent-url">Endpoint URL</Label>
            <Input
              id="agent-url"
              data-testid="agent-url"
              value={draft.base_url ?? ""}
              disabled={!canEdit}
              placeholder="http://localhost:8000/v1"
              onChange={(e) => set({ base_url: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="agent-model">Model name</Label>
              <Input
                id="agent-model"
                data-testid="agent-model"
                value={draft.model ?? ""}
                disabled={!canEdit}
                onChange={(e) => set({ model: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="agent-key">API key</Label>
              <Input
                id="agent-key"
                type="password"
                value={draft.api_key ?? ""}
                disabled={!canEdit}
                placeholder={
                  config?.api_key ? "stored — leave empty to keep" : "none"
                }
                onChange={(e) => set({ api_key: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Tool calls</Label>
              <Select
                value={draft.tool_mode ?? "text"}
                disabled={!canEdit}
                onValueChange={(v) =>
                  set({ tool_mode: v as AgentConfig["tool_mode"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">
                    As text (works with any model)
                  </SelectItem>
                  <SelectItem value="native">
                    Endpoint's function calling
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Images</Label>
              <Select
                value={draft.vision === false ? "no" : "yes"}
                disabled={!canEdit}
                onValueChange={(v) => set({ vision: v === "yes" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Model can see images</SelectItem>
                  <SelectItem value="no">Text only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {!canEdit && (
            <p className="text-muted-foreground text-xs">
              Only an administrator can change these settings.
            </p>
          )}
          {test && (
            <p className="text-sm" data-testid="agent-test-result">
              {test}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={!canEdit || runTest.isPending}
            onClick={() => runTest.mutate()}
          >
            {runTest.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save and test
          </Button>
          <Button
            disabled={!canEdit || save.isPending}
            onClick={() =>
              save.mutate(undefined, { onSuccess: () => onOpenChange(false) })
            }
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Conversation ────────────────────────────────────────────────────────────

function ToolEvent({ event }: { event: AgentEvent }) {
  const [open, setOpen] = useState(false)
  const args = JSON.stringify(event.args ?? {})
  return (
    <div className="text-xs" data-testid="agent-tool-event">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 text-left"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <Wrench className="h-3 w-3 shrink-0" />
        <span className="font-mono">{event.tool}</span>
        <span className="truncate font-mono opacity-70">
          {args === "{}" ? "" : args}
        </span>
        {event.error && (
          <AlertCircle className="h-3 w-3 shrink-0 text-red-600" />
        )}
        {event.seconds != null && (
          <span className="ml-auto shrink-0">{event.seconds}s</span>
        )}
      </button>
      {open && (
        <pre className="bg-muted mt-1 max-h-64 overflow-auto rounded p-2 whitespace-pre-wrap">
          {event.error ?? event.result}
        </pre>
      )}
      {(event.images ?? []).map((path) => (
        <a
          key={path}
          href={agentApi.imageUrl(path)}
          target="_blank"
          rel="noreferrer"
        >
          <img
            src={agentApi.imageUrl(path)}
            alt={`Output of ${event.tool}`}
            className="mt-1 max-h-72 rounded border"
            loading="lazy"
          />
        </a>
      ))}
    </div>
  )
}

function Conversation({ run }: { run: AgentRun }) {
  const end = useRef<HTMLDivElement>(null)
  const count = run.events.length
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when events arrive
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" })
  }, [count])
  return (
    <div className="flex flex-col gap-3" data-testid="agent-conversation">
      {run.events.map((e) => {
        if (e.kind === "user")
          return (
            <div
              key={e.n}
              className="bg-primary/10 ml-12 self-end rounded-lg px-3 py-2 text-sm whitespace-pre-wrap"
            >
              {e.text}
            </div>
          )
        if (e.kind === "assistant")
          return (
            <div
              key={e.n}
              className="mr-12 flex gap-2 text-sm"
              data-testid="agent-reply"
            >
              <Bot className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
              <AgentText text={e.text ?? ""} />
            </div>
          )
        if (e.kind === "tool") return <ToolEvent key={e.n} event={e} />
        if (e.kind === "skill")
          return (
            <p key={e.n} className="text-muted-foreground text-xs">
              Following skill <span className="font-mono">{e.name}</span>
            </p>
          )
        if (e.kind === "approval")
          return (
            <p key={e.n} className="text-muted-foreground text-xs">
              {e.approved ? "Approved" : "Declined"}{" "}
              <span className="font-mono">{e.tool}</span>
            </p>
          )
        if (e.kind === "error")
          return (
            <p key={e.n} className="text-sm text-red-700 dark:text-red-400">
              {e.text}
            </p>
          )
        if (e.kind === "status")
          return (
            <p key={e.n} className="text-muted-foreground text-xs">
              {e.text}
            </p>
          )
        return null
      })}
      <div ref={end} />
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

/**
 * `setup`: the first-run page, shown without signing in while no processing
 * stack exists. The agent then has the cluster-setup tools only; once the
 * stack answers, the page offers the way to the sign-in.
 */
export function AgentHome({ setup = false }: { setup?: boolean }) {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [selected, setSelected] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [text, setText] = useState("")
  const [skill, setSkill] = useState(NO_SKILL)
  const [track, setTrack] = useState("")
  const [computeOpen, setComputeOpen] = useState(true)

  const mode = useQuery({
    queryKey: ["agent", "mode"],
    queryFn: agentApi.mode,
    enabled: setup,
    refetchInterval: 5_000,
  })
  const stackReady = setup && mode.data?.mode === "ready"

  const config = useQuery({
    queryKey: ["agent", "config"],
    queryFn: agentApi.config,
    retry: false,
  })
  const skills = useQuery({
    queryKey: ["agent", "skills"],
    queryFn: agentApi.skills,
    enabled: config.isSuccess,
  })
  const stack = useQuery({
    queryKey: ["agent", "status"],
    queryFn: agentApi.status,
    enabled: config.isSuccess,
    refetchInterval: 15_000,
  })
  const runs = useQuery({
    queryKey: ["agent", "runs"],
    queryFn: agentApi.runs,
    enabled: config.isSuccess,
    refetchInterval: 5_000,
  })
  const run = useQuery({
    queryKey: ["agent", "run", selected],
    queryFn: () => agentApi.run(selected as string),
    enabled: Boolean(selected),
    refetchInterval: (q) =>
      q.state.data?.status === "running" || q.state.data?.status === "idle"
        ? 1_500
        : false,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["agent", "runs"] })
    queryClient.invalidateQueries({ queryKey: ["agent", "run", selected] })
  }
  const start = useMutation({
    mutationFn: () =>
      agentApi.start({
        text: text.trim(),
        ...(skill !== NO_SKILL ? { skill } : {}),
        ...(track.trim() ? { track: track.trim() } : {}),
      }),
    onSuccess: (r) => {
      setText("")
      setSelected(r.id)
      queryClient.setQueryData(["agent", "run", r.id], r)
      queryClient.invalidateQueries({ queryKey: ["agent", "runs"] })
    },
  })
  const reply = useMutation({
    mutationFn: () => agentApi.message(selected as string, text.trim()),
    onSuccess: () => {
      setText("")
      refresh()
    },
  })
  // A request handed over by another page ("Continue with agent" on a run):
  // start it once the service has answered.
  const handedOver = useRef(false)
  useEffect(() => {
    if (!config.isSuccess || handedOver.current) return
    handedOver.current = true
    const text = takeAgentRequest()
    if (!text) return
    agentApi
      .start({ text })
      .then((r) => {
        setSelected(r.id)
        queryClient.setQueryData(["agent", "run", r.id], r)
        queryClient.invalidateQueries({ queryKey: ["agent", "runs"] })
      })
      .catch(() => setText(text)) // could not start: leave it in the box
  }, [config.isSuccess, queryClient])

  const decide = useMutation({
    mutationFn: (approved: boolean) =>
      agentApi.approve(selected as string, approved),
    onSuccess: refresh,
  })
  const stop = useMutation({
    mutationFn: () => agentApi.cancel(selected as string),
    onSuccess: refresh,
  })

  if (config.isError)
    return (
      <div
        className="mx-auto max-w-xl py-16 text-center"
        data-testid="agent-unavailable"
      >
        <Bot className="text-muted-foreground mx-auto mb-3 h-8 w-8" />
        <h1 className="text-lg font-medium">The agent is not running</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {config.error instanceof Error
            ? config.error.message
            : "The agent service did not answer."}
        </p>
        <p className="text-muted-foreground mt-3 text-sm">
          Start it from the repository's{" "}
          <span className="font-mono">agent</span> folder with{" "}
          <span className="font-mono">python -m gemi_agent serve</span>, then
          reload. Setup: <span className="font-mono">agent/SETUP.md</span>.
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => config.refetch()}
        >
          Try again
        </Button>
      </div>
    )

  const current = selected ? run.data : undefined
  const working = current?.status === "running" || current?.status === "idle"
  const canSend =
    text.trim().length > 0 && !working && !start.isPending && !reply.isPending
  const send = () => {
    if (!canSend) return
    if (current && current.status !== "interrupted") reply.mutate()
    else start.mutate()
  }
  const active = stack.data?.jobs_active ?? []
  const error = start.error ?? reply.error ?? decide.error ?? stop.error

  return (
    <div
      className={
        setup
          ? "flex h-screen gap-4 p-4"
          : "flex h-[calc(100vh-6rem)] gap-4 pr-4"
      }
    >
      {/* Left: runs and stack status */}
      <div className="flex w-64 shrink-0 flex-col gap-3">
        <Button
          variant="outline"
          className="justify-start"
          data-testid="agent-new-run"
          onClick={() => {
            setSelected(null)
            setText("")
          }}
        >
          <Plus className="h-4 w-4" /> New run
        </Button>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {(runs.data ?? []).map((r) => (
            <button
              type="button"
              key={r.id}
              onClick={() => setSelected(r.id)}
              className={`hover:bg-muted w-full rounded-md px-2 py-1.5 text-left ${selected === r.id ? "bg-muted" : ""}`}
            >
              <div className="truncate text-sm">
                {r.title || "Untitled run"}
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <StatusBadge status={r.status} />
                <span className="text-muted-foreground text-xs">
                  {r.steps} steps
                </span>
              </div>
            </button>
          ))}
          {runs.data?.length === 0 && (
            <p className="text-muted-foreground px-2 text-sm">No runs yet.</p>
          )}
        </div>
        <Card>
          <CardContent
            className="space-y-1 p-3 text-xs"
            data-testid="agent-stack-status"
          >
            <div className="font-medium">Stack</div>
            {stack.isLoading && (
              <p className="text-muted-foreground">Checking…</p>
            )}
            {stack.isError && (
              <p className="text-red-700 dark:text-red-400">
                Status unavailable
              </p>
            )}
            {stack.data && (
              <>
                <p>
                  {active.length} active job{active.length === 1 ? "" : "s"}
                  {stack.data.workers_busy.length > 0 &&
                    ` · ${stack.data.workers_busy.length} worker(s) busy`}
                </p>
                {stack.data.uploads.map((u) => (
                  <p key={u.task_id}>
                    Upload {u.percent}% ({u.status})
                  </p>
                ))}
                {stack.data.note && (
                  <p className="text-amber-700 dark:text-amber-400">
                    {stack.data.note}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Middle: conversation */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-3 flex items-center gap-2">
          <h1 className="truncate text-lg font-medium">
            {current ? current.title || "Run" : "Agent"}
          </h1>
          {current && <StatusBadge status={current.status} />}
          <div className="ml-auto flex items-center gap-2">
            <span
              className="text-muted-foreground text-xs"
              data-testid="agent-model-name"
            >
              {config.data?.model}
            </span>
            {working && (
              <Button variant="outline" size="sm" onClick={() => stop.mutate()}>
                <Square className="h-3.5 w-3.5" /> Stop
              </Button>
            )}
            <Button
              variant={computeOpen ? "secondary" : "ghost"}
              size="sm"
              data-testid="agent-compute-toggle"
              onClick={() => setComputeOpen((o) => !o)}
            >
              <Cpu className="h-3.5 w-3.5" /> Compute
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Agent model settings"
              data-testid="agent-settings"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          {setup && (
            <Card className="mb-3" data-testid="agent-setup-banner">
              <CardContent className="flex flex-wrap items-center gap-3 p-3 text-sm">
                {stackReady ? (
                  <>
                    <span className="flex-1">
                      The processing stack is connected
                      {mode.data?.cluster ? ` (${mode.data.cluster})` : ""}.
                      Sign in to use the whole app.
                    </span>
                    <Button asChild>
                      <a href="/login">Sign in</a>
                    </Button>
                  </>
                ) : (
                  <span>
                    <span className="font-medium">First-time setup.</span> No
                    processing stack is connected yet. Tell the agent where your
                    compute is — for a cluster, paste the SSH command you use to
                    log in (for example{" "}
                    <span className="font-mono">ssh you@login.cluster.edu</span>
                    ) — and it will look around, propose where each part should
                    run, and start it. The agent needs a language model first:{" "}
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      data-testid="agent-setup-choose-model"
                      onClick={() => setSettingsOpen(true)}
                    >
                      choose one
                    </button>{" "}
                    (Claude with an API key, or any other) and press “Save and
                    test”. The cluster login itself must work with an SSH key,
                    without a password prompt.
                  </span>
                )}
              </CardContent>
            </Card>
          )}
          {current ? (
            <Conversation run={current} />
          ) : (
            <div className="text-muted-foreground mx-auto max-w-xl pt-10 text-sm">
              <p>
                Tell the agent what to do: upload data, check what is running,
                mark plots, stitch. Pick a skill to have it follow that
                procedure from the start.
              </p>
              <ul className="mt-4 space-y-1.5">
                {(skills.data ?? []).map((s) => (
                  <li key={s.name}>
                    <button
                      type="button"
                      className="hover:text-foreground text-left"
                      onClick={() => setSkill(s.name)}
                    >
                      <span className="text-foreground font-mono text-xs">
                        {s.name}
                      </span>{" "}
                      — {s.description}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {current?.status === "awaiting_approval" && current.pending && (
          <Card className="mt-3 border-amber-300">
            <CardContent
              className="flex flex-wrap items-center gap-3 p-3 text-sm"
              data-testid="agent-approval"
            >
              <div className="min-w-0 flex-1">
                The agent wants to run{" "}
                <span className="font-mono">{current.pending.tool}</span>, which{" "}
                {current.pending.reason ?? "needs your approval"}:
                <pre className="mt-1 text-xs whitespace-pre-wrap">
                  {JSON.stringify(current.pending.args)}
                </pre>
              </div>
              <Button
                variant="outline"
                disabled={decide.isPending}
                onClick={() => decide.mutate(false)}
              >
                Decline
              </Button>
              <Button
                disabled={decide.isPending}
                onClick={() => decide.mutate(true)}
              >
                <Check className="h-4 w-4" /> Allow
              </Button>
            </CardContent>
          </Card>
        )}

        {error && (
          <p className="mt-2 text-sm text-red-700 dark:text-red-400">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}

        <div className="mt-3 space-y-2">
          {!current && (
            <div className="flex flex-wrap gap-2">
              <Select value={skill} onValueChange={setSkill}>
                <SelectTrigger className="w-56" data-testid="agent-skill">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SKILL}>
                    No skill (agent decides)
                  </SelectItem>
                  {(skills.data ?? []).map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="min-w-0 flex-1"
                value={track}
                placeholder="Rover track folder (optional), e.g. Raw/2026/EXP/SITE/POP/2026-09-17/Amiga/RGB/c0fca235/"
                onChange={(e) => setTrack(e.target.value)}
              />
            </div>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              data-testid="agent-input"
              value={text}
              rows={2}
              placeholder={
                current
                  ? "Reply to the agent…"
                  : setup
                    ? "e.g. My cluster login is: ssh you@login.cluster.edu"
                    : "What should the agent do?"
              }
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <Button disabled={!canSend} onClick={send} data-testid="agent-send">
              <Send className="h-4 w-4" /> {current ? "Send" : "Start"}
            </Button>
          </div>
        </div>
      </div>

      {computeOpen && (
        <ComputePanel canManage={setup || Boolean(user?.is_superuser)} />
      )}

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        config={config.data}
        canEdit={setup || Boolean(user?.is_superuser)}
      />
    </div>
  )
}
