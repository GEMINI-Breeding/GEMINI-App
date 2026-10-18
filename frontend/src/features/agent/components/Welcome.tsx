/**
 * Welcome — the first thing a new user sees: two questions, in order, each
 * skipped when it already has an answer.
 *
 *   1. Where should GEMI do the heavy work: this computer, or a cluster?
 *   2. Work with the agent, or by hand? (By hand: no agent tab, no model.)
 *   3. Which model should the agent use, and where does that run?
 *
 * For the second it shows what this computer has (memory, graphics card)
 * and which open models fit it. Once both are answered the app opens as
 * usual; someone who has answered them never sees this page.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bot, Check, Cpu, Hand, Loader2, Server } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { InstallHelper } from "@/features/agent/components/InstallHelper"
import { ModelSetupPanel } from "@/features/agent/components/ModelSetupDialog"
import {
  agentApi,
  type FoundModel,
  type Onboarding,
} from "@/features/agent/lib/agentApi"
import { autoSignIn } from "@/lib/autoSignIn"
import { getHomePrefs, setHomePrefs } from "@/lib/homePrefs"
import { openUrl } from "@/lib/platform"
import { isDesktopApp, setStackMode, stackMode, stackStatus } from "@/lib/stack"

const PROCESSING_KEY = "gemini.onboarding.processing" // "local" | "cluster"
const MODEL_KEY = "gemini.onboarding.model" // "later": decided to go without for now
const SKIP_KEY = "gemini.onboarding.skip" // this session only
const FORCE_KEY = "gemini.onboarding.force" // "run it again" from Settings

function get(store: Storage, key: string): string | null {
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}
function put(store: Storage, key: string, value: string | null): void {
  try {
    if (value === null) store.removeItem(key)
    else store.setItem(key, value)
  } catch {
    // no storage: the walkthrough simply shows again next time
  }
}

/** Show the walkthrough again from the start (Settings). */
export function restartWalkthrough(): void {
  put(localStorage, PROCESSING_KEY, null)
  put(localStorage, MODEL_KEY, null)
  put(sessionStorage, SKIP_KEY, null)
  put(sessionStorage, FORCE_KEY, "1")
}

// Opening the app with ?walkthrough=1 shows the walkthrough from the start (demos, support).
try {
  const url = new URL(window.location.href)
  if (url.searchParams.get("walkthrough") === "1") {
    restartWalkthrough()
    url.searchParams.delete("walkthrough")
    window.history.replaceState(null, "", url.toString())
  }
} catch {
  // not in a browser
}

const HOSTED = [
  {
    id: "anthropic",
    label: "Claude (Anthropic)",
    base_url: "https://api.anthropic.com/v1",
    model: "claude-sonnet-5-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "openai",
    label: "OpenAI",
    base_url: "https://api.openai.com/v1",
    model: "gpt-4o",
    keyUrl: "https://platform.openai.com/api-keys",
  },
] as const

function Choice({
  icon,
  title,
  children,
  selected,
  onClick,
  testId,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
  selected: boolean
  onClick: () => void
  testId: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className={`flex w-full gap-3 rounded-lg border p-4 text-left ${selected ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        <span className="text-muted-foreground block text-sm">{children}</span>
      </span>
      {selected && <Check className="text-primary ml-auto h-5 w-5 shrink-0" />}
    </button>
  )
}

function ProcessingStep({
  info,
  onChosen,
}: {
  info: Onboarding
  onChosen: (where: "local" | "cluster") => void
}) {
  const [where, setWhere] = useState<"local" | "cluster" | null>(null)
  const docker =
    info.docker === "running"
      ? "Docker is running."
      : info.docker === "not_running"
        ? "Docker is installed but not running: start Docker Desktop first."
        : "Needs Docker Desktop (free), which is not installed yet."
  return (
    <div className="space-y-4" data-testid="welcome-processing">
      <div>
        <h2 className="text-lg font-medium">
          Where should GEMI do the heavy work?
        </h2>
        <p className="text-muted-foreground text-sm">
          Building field maps and stitching rover images takes hours of
          computing. Your data lives where the work runs. You can change this
          later in Settings.
        </p>
      </div>
      <Choice
        icon={<Cpu className="h-5 w-5" />}
        title="This computer"
        selected={where === "local"}
        onClick={() => setWhere("local")}
        testId="welcome-processing-local"
      >
        Good for small data sets and trying things out. This computer:{" "}
        {info.system.summary || info.system.os}. {docker}
      </Choice>
      <Choice
        icon={<Server className="h-5 w-5" />}
        title="A cluster (HPC)"
        selected={where === "cluster"}
        onClick={() => setWhere("cluster")}
        testId="welcome-processing-cluster"
      >
        For whole fields and seasons. Needs a Slurm cluster you can log in to
        with an SSH key (no password prompt). Nothing is installed on this
        computer; the agent sets the cluster up with you in the next minutes.
      </Choice>
      {where === "local" && info.docker !== "running" && (
        <InstallHelper what="docker" />
      )}
      <div>
        <Button
          disabled={!where}
          data-testid="welcome-processing-next"
          onClick={() => where && onChosen(where)}
        >
          Continue
        </Button>
      </div>
    </div>
  )
}

function WorkStyleStep({ onChosen }: { onChosen: (agent: boolean) => void }) {
  const [agent, setAgent] = useState<boolean | null>(null)
  return (
    <div className="space-y-4" data-testid="welcome-style">
      <div>
        <h2 className="text-lg font-medium">How do you want to work?</h2>
        <p className="text-muted-foreground text-sm">
          Every step can be done by hand in Files, Process and Analyze. The
          agent can also do them for you on request. You can change this later
          in Settings → Home.
        </p>
      </div>
      <Choice
        icon={<Bot className="h-5 w-5" />}
        title="With the agent"
        selected={agent === true}
        onClick={() => setAgent(true)}
        testId="welcome-style-agent"
      >
        Ask in plain words ("upload this folder", "stitch the rover run", "which
        traits are heritable?") and it does the steps, asking you when something
        only you know. Needs a language model, chosen next.
      </Choice>
      <Choice
        icon={<Hand className="h-5 w-5" />}
        title="By hand"
        selected={agent === false}
        onClick={() => setAgent(false)}
        testId="welcome-style-hand"
      >
        No agent and no language model. Home opens on the dashboard built from
        your data.
      </Choice>
      <div>
        <Button
          disabled={agent === null}
          data-testid="welcome-style-next"
          onClick={() => agent !== null && onChosen(agent)}
        >
          Continue
        </Button>
      </div>
    </div>
  )
}

function HostedForm({ onWorked }: { onWorked: () => void }) {
  const [provider, setProvider] = useState<(typeof HOSTED)[number]>(HOSTED[0])
  const [key, setKey] = useState("")
  const [result, setResult] = useState<string | null>(null)
  const test = useMutation({
    mutationFn: async () => {
      await agentApi.saveConfig({
        base_url: provider.base_url,
        model: provider.model,
        api_key: key.trim(),
        tool_mode: "text",
        vision: true,
      })
      return agentApi.testConfig()
    },
    onSuccess: (r) => {
      setResult(
        r.ok
          ? `It answered in ${r.seconds} s. The agent will use ${provider.model}.`
          : `No answer: ${r.error}`,
      )
      if (r.ok) onWorked()
    },
    onError: (e) => setResult(e instanceof Error ? e.message : String(e)),
  })
  return (
    <div className="space-y-3" data-testid="welcome-hosted">
      <p className="text-muted-foreground text-sm">
        The most capable option, especially for reading images. It needs an API
        key from the provider (a chat subscription login does not work in other
        apps), and your requests and the images the agent looks at go to that
        provider.
      </p>
      <div className="flex gap-2">
        {HOSTED.map((p) => (
          <Button
            key={p.id}
            size="sm"
            variant={provider.id === p.id ? "default" : "outline"}
            onClick={() => setProvider(p)}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="welcome-key">API key</Label>
        <div className="flex gap-2">
          <Input
            id="welcome-key"
            type="password"
            value={key}
            data-testid="welcome-hosted-key"
            onChange={(e) => setKey(e.target.value)}
          />
          <Button
            disabled={!key.trim() || test.isPending}
            onClick={() => test.mutate()}
          >
            {test.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save and test
          </Button>
        </div>
        <button
          type="button"
          className="text-muted-foreground w-fit text-xs underline underline-offset-2"
          onClick={() => openUrl(provider.keyUrl)}
        >
          Get a key from {provider.label}
        </button>
      </div>
      {result && <p className="text-sm">{result}</p>}
    </div>
  )
}

/** Models that are already installed or being served here: pick one, nothing to download. */
function FoundModels({ found }: { found: FoundModel[] }) {
  const queryClient = useQueryClient()
  const [picked, setPicked] = useState<string | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const use = useMutation({
    mutationFn: async (m: FoundModel) => {
      setPicked(`${m.base_url} ${m.model}`)
      setNote(null)
      // With a stack running, saving the model needs a session: get one quietly first.
      try {
        await autoSignIn()
      } catch {
        // no stack, or sign-in is required: the save below says so if it matters
      }
      await agentApi.saveConfig({
        base_url: m.base_url,
        model: m.model,
        api_key: "none",
        tool_mode: "text",
        vision: m.vision ?? true,
      })
      return agentApi.testConfig()
    },
    onSuccess: (r, m) => {
      setNote(
        r.ok
          ? {
              ok: true,
              text: `${m.label} answered in ${r.seconds} s. The agent will use it.`,
            }
          : { ok: false, text: `${m.label} did not answer: ${r.error}` },
      )
      void queryClient.invalidateQueries({ queryKey: ["agent"] })
    },
    onError: (e, m) =>
      setNote({
        ok: false,
        text: `${m.label} could not be used: ${String(e)}`,
      }),
  })
  return (
    <div className="space-y-2" data-testid="welcome-found-models">
      <p className="text-muted-foreground text-sm">
        Found on this computer. Choosing one downloads nothing; a model that is
        not loaded yet takes a moment to start on first use.
      </p>
      <div className="divide-y rounded-md border">
        {found.map((m) => {
          const id = `${m.base_url} ${m.model}`
          return (
            <div
              key={id}
              className="flex flex-wrap items-center gap-2 p-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <span className="font-medium">{m.label}</span>
                <span className="text-muted-foreground"> · {m.server}</span>
                <span
                  className={`ml-2 rounded px-1.5 py-0.5 text-xs ${
                    m.loaded
                      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {m.loaded ? "running now" : "installed"}
                </span>
                {m.checks ? (
                  <span
                    className="bg-muted ml-2 rounded px-1.5 py-0.5 text-xs"
                    title={
                      m.checks.weak.length
                        ? `Not passed every time: ${m.checks.weak.join("; ")}`
                        : "Passed every check of the pipeline steps"
                    }
                  >
                    passed {m.checks.passed} of {m.checks.of} GEMI checks
                  </span>
                ) : (
                  <span className="text-muted-foreground ml-2 text-xs">
                    not checked with GEMI
                  </span>
                )}
                <span className="text-muted-foreground block truncate text-xs">
                  {m.model} at {m.base_url}
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={use.isPending}
                data-testid="welcome-found-use"
                onClick={() => use.mutate(m)}
              >
                {use.isPending && picked === id ? (
                  <>
                    <Loader2 className="mr-1 size-3 animate-spin" /> Asking it…
                  </>
                ) : (
                  "Use this model"
                )}
              </Button>
            </div>
          )
        })}
      </div>
      {note && (
        <p
          className={`text-sm ${note.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}
          data-testid="welcome-found-note"
        >
          {note.text}
        </p>
      )}
    </div>
  )
}

function ModelStep({
  info,
  processing,
  onAnswered,
}: {
  info: Onboarding
  processing: "local" | "cluster" | null
  onAnswered: (later: boolean) => void
}) {
  const found = info.found ?? []
  const [how, setHow] = useState<"found" | "open" | "hosted" | "later">(
    found.length ? "found" : "open",
  )
  const fits = Object.fromEntries(
    info.models.map((m) => [m.key, { fit: m.fit, why: m.why }]),
  )
  return (
    <div className="space-y-4" data-testid="welcome-model">
      <div>
        <h2 className="text-lg font-medium">
          Which model should the agent use?
        </h2>
        <p className="text-muted-foreground text-sm">
          GEMI's agent does the pipeline steps for you when you ask in plain
          words. It needs a language model to think with.
        </p>
      </div>
      <div
        className="bg-muted/50 rounded-md border p-3 text-sm"
        data-testid="welcome-system"
      >
        <span className="font-medium">This computer:</span>{" "}
        {info.system.summary || info.system.os}. {info.advice}
        {processing === "cluster" &&
          " You chose a cluster for processing: the model can run there too, on a GPU."}
      </div>
      <div className="flex flex-wrap gap-2">
        {found.length > 0 && (
          <Button
            size="sm"
            variant={how === "found" ? "default" : "outline"}
            data-testid="welcome-model-found"
            onClick={() => setHow("found")}
          >
            One already on this computer ({found.length})
          </Button>
        )}
        <Button
          size="sm"
          variant={how === "open" ? "default" : "outline"}
          data-testid="welcome-model-open"
          onClick={() => setHow("open")}
        >
          {found.length > 0
            ? "Install another open model"
            : "A free open model"}
        </Button>
        <Button
          size="sm"
          variant={how === "hosted" ? "default" : "outline"}
          data-testid="welcome-model-hosted"
          onClick={() => setHow("hosted")}
        >
          A hosted model (API key)
        </Button>
        <Button
          size="sm"
          variant={how === "later" ? "default" : "outline"}
          data-testid="welcome-model-later"
          onClick={() => setHow("later")}
        >
          Not now
        </Button>
      </div>
      {how === "found" && <FoundModels found={found} />}
      {how === "open" && (
        <ModelSetupPanel
          canEdit
          fits={fits}
          initial={info.recommended}
          onDone={() => undefined}
        />
      )}
      {how === "hosted" && <HostedForm onWorked={() => undefined} />}
      {how === "later" && (
        <p className="text-muted-foreground text-sm">
          GEMI works without the agent: every step is on the Process page. You
          can also drive GEMI from a coding agent you already use (Claude Code
          and others) with its own model; the user guide and the README say how.
          Set a model any time with the gear icon on the home page.
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button
          disabled={how !== "later" && !info.model.answered}
          data-testid="welcome-model-next"
          onClick={() => onAnswered(how === "later")}
        >
          {how === "later" ? "Continue without a model" : "Continue"}
        </Button>
        {how !== "later" && !info.model.answered && (
          <span className="text-muted-foreground text-xs">
            Continue unlocks once a model has answered a test question.
          </span>
        )}
        {info.model.answered && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            Ready: the agent is using {info.model.model}.
          </span>
        )}
      </div>
    </div>
  )
}

export function OnboardingGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  // Once the walkthrough is on screen it stays until the person finishes or
  // skips it, even if a question gets answered meanwhile (a model coming up
  // must not make the page vanish under them).
  const started = useRef(false)
  const [finished, setFinished] = useState(false)
  const [processingDone, setProcessingDone] = useState(false)
  const [styleDone, setStyleDone] = useState(false)

  const info = useQuery({
    queryKey: ["agent", "onboarding"],
    queryFn: agentApi.onboarding,
    retry: false,
    refetchInterval: () => (started.current && !finished ? 5_000 : false),
  })
  // The desktop app's own stack: configured once a data folder has been chosen.
  const desktop = useQuery({
    queryKey: ["stack", "onboarding"],
    queryFn: stackStatus,
    enabled: isDesktopApp(),
    retry: false,
  })
  // With a stack already there, the model settings need a session: sign in quietly.
  const reachable = info.data?.processing.stack_reachable
  useEffect(() => {
    if (reachable) void autoSignIn()
  }, [reachable])

  // No agent service (a plain browser build): the app as it was.
  if (info.isError || finished) return <>{children}</>
  if (!info.data || (isDesktopApp() && desktop.isLoading))
    return (
      <div className="text-muted-foreground flex min-h-screen items-center justify-center text-sm">
        Opening GEMI…
      </div>
    )

  const forced = get(sessionStorage, FORCE_KEY) === "1"
  const chosen = get(localStorage, PROCESSING_KEY) as "local" | "cluster" | null
  const processingAnswered =
    info.data.processing.answered ||
    Boolean(desktop.data?.config) ||
    chosen !== null ||
    (isDesktopApp() && stackMode() === "cluster")
  const prefs = getHomePrefs()
  // Asked of new installs and on "run it again"; someone already set up is
  // not stopped for it (Settings → Home has the same choice).
  // (Answering the processing question in this walkthrough makes it count as
  // answered; that must not skip this one.)
  const styleAnswered =
    !forced && (prefs.chosen || (processingAnswered && !processingDone))
  const modelAnswered =
    !prefs.agent ||
    info.data.model.answered ||
    get(localStorage, MODEL_KEY) === "later"
  const needed =
    forced || !processingAnswered || !styleAnswered || !modelAnswered
  if (get(sessionStorage, SKIP_KEY) === "1") return <>{children}</>
  if (!needed && !started.current) return <>{children}</>
  started.current = true

  const askedProcessing = forced || !processingAnswered || processingDone
  const askProcessing = askedProcessing && !processingDone
  const askedStyle = !styleAnswered || styleDone
  const askStyle = !askProcessing && askedStyle && !styleDone
  const total = (askedProcessing ? 1 : 0) + (askedStyle ? 1 : 0) + 1
  const at = askProcessing
    ? 1
    : askStyle
      ? (askedProcessing ? 1 : 0) + 1
      : total

  const leave = () => {
    put(sessionStorage, FORCE_KEY, null)
    queryClient.invalidateQueries({ queryKey: ["agent"] })
    setFinished(true)
  }
  // Whatever was chosen, the app opens next: with no stack connected yet the
  // home page is where the agent connects one, and a notice says what is missing.
  const finish = leave

  return (
    <div className="min-h-screen overflow-y-auto" data-testid="welcome">
      <div className="mx-auto max-w-2xl space-y-6 px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold">Welcome to GEMI</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            GEMI turns drone flights and rover runs into per-plot images and
            measurements.{" "}
            {total > 1
              ? `${total === 2 ? "Two" : "Three"} questions and it is ready.`
              : "One question and it is ready."}
          </p>
          <p className="text-muted-foreground mt-3 text-xs tracking-wide uppercase">
            Step {at} of {total}
          </p>
        </div>

        {askProcessing ? (
          <ProcessingStep
            info={info.data}
            onChosen={(where) => {
              put(localStorage, PROCESSING_KEY, where)
              if (isDesktopApp()) setStackMode(where)
              setProcessingDone(true)
            }}
          />
        ) : askStyle ? (
          <WorkStyleStep
            onChosen={(agent) => {
              setHomePrefs({ agent, chosen: true })
              setStyleDone(true)
              if (!agent) finish()
            }}
          />
        ) : (
          <ModelStep
            info={info.data}
            processing={chosen}
            onAnswered={(later) => {
              if (later) put(localStorage, MODEL_KEY, "later")
              finish()
            }}
          />
        )}

        <button
          type="button"
          className="text-muted-foreground text-xs underline underline-offset-2"
          data-testid="welcome-skip"
          onClick={() => {
            put(sessionStorage, SKIP_KEY, "1")
            leave()
          }}
        >
          Skip for now
        </button>
      </div>
    </div>
  )
}
