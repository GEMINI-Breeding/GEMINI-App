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
import { getToken, login, onLogout } from "@/lib/auth"
import { openUrl } from "@/lib/platform"
import {
  applyStackUrls,
  configureStack,
  isManagedStack,
  onStackProgress,
  type StackStatus,
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

  const bringUp = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      setView({ kind: "checking" })
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
      if (!getToken()) await signInToStack()
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
    const t = setInterval(() => void bringUp(), 5_000)
    return () => clearInterval(t)
  }, [view.kind, bringUp])

  // A token that expired (8 days) logs the app out; sign straight back in.
  useEffect(
    () =>
      onLogout(() => {
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
          <DockerNeeded status={view.status} onRetry={bringUp} />
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
        {view.kind === "starting" && <Starting lines={view.lines} />}
        {view.kind === "error" && (
          <StartError message={view.message} onRetry={bringUp} />
        )}
      </div>
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
          GEMINI runs its processing services in Docker. Install Docker Desktop
          (free for personal, education and small-business use), start it once,
          then come back here.
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
            Docker Desktop is installed but not running. Open it and wait until
            it says “Engine running” — this page continues by itself.
          </p>
          {d.detail && (
            <pre className="text-muted-foreground max-h-32 overflow-auto text-xs whitespace-pre-wrap">
              {d.detail}
            </pre>
          )}
        </>
      )}
      <div className="flex gap-2">
        {d.state !== "not_running" && (
          <Button onClick={() => void openUrl(DOCKER_URL)}>
            Get Docker Desktop
          </Button>
        )}
        <Button variant="outline" onClick={onRetry}>
          Check again
        </Button>
      </div>
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
