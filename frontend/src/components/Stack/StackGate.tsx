/**
 * StackGate — in the desktop app, nothing renders until the local stack is
 * up and the app is signed in to it.
 *
 * Docker missing / not running → say what to do (the app must not fail at
 * an API call). First run → ask where the data lives (D5). Otherwise start
 * the stack with progress, then sign in with the install's own account so
 * there is never a login screen for your own machine.
 *
 * Outside the desktop app (browser, dev builds) it renders children as is.
 */
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InstallHelper } from "@/features/agent/components/InstallHelper"
import { agentApi } from "@/features/agent/lib/agentApi"
import { getToken, login, onLogout } from "@/lib/auth"
import { signInRequired } from "@/lib/autoSignIn"
import { openUrl } from "@/lib/platform"
import {
  applyStackUrls,
  configureStack,
  isManagedStack,
  onStackProgress,
  type StackStatus,
  setStackMode,
  stackCredentials,
  stackLogs,
  stackStatus,
  startStack,
} from "@/lib/stack"

const DOCKER_URL = "https://www.docker.com/products/docker-desktop/"

type View =
  | { kind: "checking" }
  | { kind: "docker"; status: StackStatus }
  | { kind: "first-run"; status: StackStatus }
  | { kind: "starting"; lines: string[] }
  | { kind: "error"; message: string }
  | { kind: "ready" }

export async function signInToStack(): Promise<void> {
  const { email, password } = await stackCredentials()
  await login(email, password)
}

export function StackGate({ children }: { children: ReactNode }) {
  if (!isManagedStack()) return <>{children}</>
  return <ManagedStackGate>{children}</ManagedStackGate>
}

function ManagedStackGate({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>({ kind: "checking" })
  const running = useRef(false)

  // `quiet`: a background re-check. The page stays as it is unless the
  // answer changes (otherwise it would blank to "Checking…" every few seconds).
  const bringUp = useCallback(async (quiet = false) => {
    if (running.current) return
    running.current = true
    try {
      if (!quiet) setView({ kind: "checking" })
      let status = await stackStatus()
      if (status.docker.state !== "ready") {
        setView({ kind: "docker", status })
        return
      }
      if (!status.config) {
        setView({ kind: "first-run", status })
        return
      }
      if (!status.healthy) {
        setView({ kind: "starting", lines: [] })
        const unlisten = await onStackProgress((p) =>
          setView((v) =>
            v.kind === "starting"
              ? { kind: "starting", lines: [...v.lines.slice(-199), p.message] }
              : v,
          ),
        )
        try {
          await startStack()
        } finally {
          unlisten()
        }
        status = await stackStatus()
      }
      applyStackUrls(status)
      if (!getToken() && !signInRequired()) await signInToStack()
      setView({ kind: "ready" })
    } catch (e) {
      setView({ kind: "error", message: String(e) })
    } finally {
      running.current = false
    }
  }, [])

  useEffect(() => {
    void bringUp()
  }, [bringUp])

  // Docker Desktop takes a while to start: re-check on its own.
  useEffect(() => {
    if (view.kind !== "docker") return
    const t = setInterval(() => void bringUp(true), 5_000)
    return () => clearInterval(t)
  }, [view.kind, bringUp])

  // A token that expired (8 days) logs the app out; sign straight back in.
  useEffect(
    () =>
      onLogout(() => {
        if (signInRequired()) return // the layout shows the login page
        void signInToStack()
          .then(() => window.location.assign("/"))
          .catch((e) => setView({ kind: "error", message: String(e) }))
      }),
    [],
  )

  if (view.kind === "ready") return <>{children}</>
  return (
    <div
      className="flex min-h-screen items-center justify-center p-6"
      data-testid="stack-gate"
    >
      <div className="w-full max-w-lg space-y-4">
        {view.kind === "checking" && <p>Checking GEMINI services…</p>}
        {view.kind === "docker" && (
          <DockerNeeded status={view.status} onRetry={() => void bringUp()} />
        )}
        {view.kind === "first-run" && (
          <FirstRun
            status={view.status}
            onDone={async (dir) => {
              try {
                await configureStack(dir)
                await bringUp()
              } catch (e) {
                setView({ kind: "error", message: String(e) })
              }
            }}
          />
        )}
        {(view.kind === "docker" || view.kind === "first-run") && (
          <UseRunningStack />
        )}
        {(view.kind === "docker" || view.kind === "first-run") && (
          <UseCluster />
        )}
        {view.kind === "starting" && <Starting lines={view.lines} />}
        {view.kind === "error" && (
          <StartError message={view.message} onRetry={() => void bringUp()} />
        )}
      </div>
    </div>
  )
}

/**
 * A GEMINI stack is already answering on this computer (started from a
 * terminal, or by another copy of the app): use it as it is, instead of
 * setting up a second one that would compete for the same ports. Asked of
 * the agent service, which already checks the stack's health.
 */
function UseRunningStack() {
  const [found, setFound] = useState(false)
  useEffect(() => {
    let live = true
    agentApi
      .mode()
      .then((m) => live && setFound(Boolean(m.stack_reachable)))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  if (!found) return null
  return (
    <div
      className="space-y-2 rounded-md border border-emerald-600/50 p-3"
      data-testid="stack-use-running"
    >
      <p className="text-sm font-medium">
        A GEMINI stack is already running on this computer
      </p>
      <p className="text-muted-foreground text-sm">
        Use it as it is: nothing new is installed or started, and its data is
        what you will see.
      </p>
      <Button
        onClick={() => {
          // Same as a cluster's tunnel: the app starts nothing and talks to
          // the API that is already there.
          setStackMode("cluster")
          window.location.assign("/")
        }}
      >
        Use the running stack
      </Button>
    </div>
  )
}

/**
 * The other way to run GEMINI: nothing on this computer, processing on an
 * HPC cluster. Offered wherever the local path asks for something (Docker,
 * a data folder); the agent then sets the cluster up from an SSH login.
 */
function UseCluster() {
  return (
    <div
      className="space-y-2 rounded-md border p-3"
      data-testid="stack-use-cluster"
    >
      <p className="text-sm font-medium">Have an HPC cluster instead?</p>
      <p className="text-muted-foreground text-sm">
        GEMINI can run its processing on a Slurm cluster and keep the data
        there. Nothing is installed on this computer and Docker is not needed.
        You give the agent the SSH command you log in with; it looks at the
        cluster, proposes where each part should run, and starts it after you
        agree.
      </p>
      <Button
        variant="outline"
        onClick={() => {
          setStackMode("cluster")
          window.location.assign("/")
        }}
      >
        Set up on a cluster
      </Button>
    </div>
  )
}

function DockerNeeded({
  status,
  onRetry,
}: {
  status: StackStatus
  onRetry: () => void
}) {
  const d = status.docker
  const isWindows = navigator.userAgent.includes("Windows")
  return (
    <div className="space-y-3" data-testid="stack-docker">
      <h1 className="text-xl font-semibold">
        {d.state === "missing"
          ? "GEMINI needs Docker Desktop"
          : d.state === "no_compose"
            ? "Please update Docker Desktop"
            : "Start Docker Desktop"}
      </h1>
      {d.state === "missing" && (
        <p>
          GEMINI runs its processing services in Docker. GEMI can download
          Docker Desktop (free for personal, education and small-business use)
          and open its installer; your system then asks you to approve it.
          {isWindows &&
            " On Windows, Docker Desktop's installer also sets up WSL 2 — accept that step and restart if it asks."}
        </p>
      )}
      {d.state === "no_compose" && (
        <p>
          This version of Docker has no “docker compose”. Update Docker Desktop.
        </p>
      )}
      {d.state === "not_running" && (
        <>
          <p>
            Docker Desktop is installed but not running. Start it here (or open
            it yourself); this page continues by itself once it is up.
          </p>
          {d.detail && (
            <pre className="text-muted-foreground max-h-32 overflow-auto text-xs whitespace-pre-wrap">
              {d.detail}
            </pre>
          )}
        </>
      )}
      {d.state === "no_compose" ? (
        <Button onClick={() => void openUrl(DOCKER_URL)}>
          Get Docker Desktop
        </Button>
      ) : (
        <InstallHelper what="docker" onReady={onRetry} />
      )}
      <Button variant="outline" onClick={onRetry}>
        Check again
      </Button>
    </div>
  )
}

function FirstRun({
  status,
  onDone,
}: {
  status: StackStatus
  onDone: (dir: string) => Promise<void>
}) {
  const [dir, setDir] = useState(status.default_data_dir ?? "")
  const [busy, setBusy] = useState(false)
  const choose = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog")
    const picked = await open({
      directory: true,
      defaultPath: dir || undefined,
    })
    if (typeof picked === "string") setDir(picked)
  }
  return (
    <div className="space-y-3" data-testid="stack-first-run">
      <h1 className="text-xl font-semibold">
        Where should GEMINI keep its data?
      </h1>
      <p>
        Uploads, orthomosaics and the database go here, and can grow to hundreds
        of gigabytes. Pick a drive with room to spare. You can change this later
        in Settings.
      </p>
      <div className="flex gap-2">
        <Input
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          aria-label="Data folder"
        />
        <Button variant="outline" onClick={() => void choose()}>
          Choose…
        </Button>
      </div>
      {status.legacy_install && (
        <p className="text-muted-foreground text-sm">
          Your data from the previous GEMI version is kept exactly where it is
          and is never modified or deleted. Once GEMINI is running you can
          import it from Settings → Data & services.
        </p>
      )}
      <Button
        disabled={!dir || busy}
        onClick={async () => {
          setBusy(true)
          await onDone(dir)
          setBusy(false)
        }}
      >
        Continue
      </Button>
    </div>
  )
}

function Starting({ lines }: { lines: string[] }) {
  const last = lines.at(-1) ?? ""
  return (
    <div className="space-y-3" data-testid="stack-starting">
      <h1 className="text-xl font-semibold">Starting GEMINI…</h1>
      <p className="text-muted-foreground text-sm">
        The first start downloads the processing services (a few GB); later
        starts take seconds.
      </p>
      <pre className="bg-muted max-h-48 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
        {last}
      </pre>
    </div>
  )
}

function StartError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  const [logs, setLogs] = useState<string | null>(null)
  return (
    <div className="space-y-3" data-testid="stack-error">
      <h1 className="text-xl font-semibold">GEMINI couldn't start</h1>
      <pre className="bg-muted max-h-48 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
        {message}
      </pre>
      <div className="flex gap-2">
        <Button onClick={onRetry}>Try again</Button>
        <Button
          variant="outline"
          onClick={async () => setLogs(await stackLogs(300).catch(String))}
        >
          Show service logs
        </Button>
      </div>
      {logs !== null && (
        <pre className="bg-muted max-h-80 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
          {logs}
        </pre>
      )}
    </div>
  )
}
