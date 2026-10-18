/**
 * InstallHelper — gets Ollama or Docker onto this computer from the app.
 *
 * Ollama is installed completely (download, install for this user, start).
 * Docker Desktop's installer is downloaded and opened; the system then asks
 * the person to approve it, and a "Start Docker" button starts it once it is
 * installed. On Linux, Docker is installed from a terminal; the commands are
 * shown to copy. Without the agent service (a plain browser build) it falls
 * back to the download page.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Copy, Download, Loader2, Play, X } from "lucide-react"
import { useEffect, useRef } from "react"

import { Button } from "@/components/ui/button"
import {
  agentApi,
  type InstallJob,
  type InstallOverview,
} from "@/features/agent/lib/agentApi"
import { openUrl } from "@/lib/platform"

const PAGES = {
  ollama: "https://ollama.com/download",
  docker: "https://www.docker.com/products/docker-desktop/",
}

function duration(s: number): string {
  return s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`
}

function JobSteps({ job }: { job: InstallJob }) {
  return (
    <ul className="space-y-1 text-xs" data-testid={`install-${job.what}-steps`}>
      {job.steps.map((s) => (
        <li key={s.name} className="flex items-center gap-2">
          {s.status === "done" ? (
            <Check className="h-3.5 w-3.5 text-green-600" />
          ) : s.status === "running" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : s.status === "failed" ? (
            <X className="h-3.5 w-3.5 text-red-600" />
          ) : (
            <span className="h-3.5 w-3.5" />
          )}
          <span
            className={s.status === "waiting" ? "text-muted-foreground" : ""}
          >
            {s.name}
          </span>
          <span className="text-muted-foreground min-w-0 truncate">
            {s.detail}
            {s.status === "running" && s.remaining_s
              ? ` · about ${duration(s.remaining_s)} left`
              : ""}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function InstallHelper({
  what,
  onReady,
}: {
  what: "ollama" | "docker"
  /** Called once the program is installed and running. */
  onReady?: () => void
}) {
  const queryClient = useQueryClient()
  const status = useQuery({
    queryKey: ["agent", "install"],
    queryFn: agentApi.install,
    retry: false,
    refetchInterval: (q) => {
      const d = q.state.data as InstallOverview | undefined
      return d?.jobs?.[what]?.state === "running" ? 1_500 : 8_000
    },
  })
  const refresh = (d: InstallOverview) =>
    queryClient.setQueryData(["agent", "install"], d)
  const install = useMutation({
    mutationFn: () =>
      what === "ollama" ? agentApi.installOllama() : agentApi.installDocker(),
    onSuccess: refresh,
  })
  const start = useMutation({
    mutationFn: agentApi.startDocker,
    onSuccess: refresh,
  })

  const d = status.data
  const state = d?.[what]
  const job = d?.jobs?.[what]
  const ready = state === "running"

  const told = useRef(false)
  useEffect(() => {
    if (ready && !told.current) {
      told.current = true
      onReady?.()
    }
  }, [ready, onReady])

  // No agent service: only the download page can help.
  if (status.isError)
    return (
      <Button variant="outline" onClick={() => void openUrl(PAGES[what])}>
        <Download className="h-4 w-4" />
        {what === "ollama" ? "Get Ollama" : "Get Docker Desktop"}
      </Button>
    )
  if (!d)
    return <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />

  const name = what === "ollama" ? "Ollama" : "Docker"
  const busy = job?.state === "running" || install.isPending || start.isPending
  const error =
    (install.error instanceof Error && install.error.message) ||
    (start.error instanceof Error && start.error.message) ||
    (job?.state === "failed" ? job.error : null)

  return (
    <div className="space-y-2" data-testid={`install-${what}`}>
      {ready ? (
        <p className="flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
          <Check className="h-4 w-4" /> {name} is installed and running.
        </p>
      ) : what === "docker" && state === "missing" && d.docker_linux_steps ? (
        <div className="space-y-1.5 text-sm">
          <p>
            On Linux, Docker is installed from a terminal (it needs your
            password). Run these, then come back; this page notices by itself:
          </p>
          <pre className="bg-muted rounded p-2 text-xs whitespace-pre-wrap">
            {d.docker_linux_steps.join("\n")}
          </pre>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void navigator.clipboard?.writeText(
                d.docker_linux_steps?.slice(0, 2).join(" && ") ?? "",
              )
            }
          >
            <Copy className="h-3.5 w-3.5" /> Copy the commands
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {state === "missing" ? (
            <Button
              disabled={busy}
              data-testid={`install-${what}-run`}
              onClick={() => install.mutate()}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {what === "ollama" ? "Install Ollama" : "Install Docker Desktop"}
            </Button>
          ) : what === "docker" ? (
            <Button
              disabled={busy}
              data-testid="install-docker-start"
              onClick={() => start.mutate()}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Start Docker
            </Button>
          ) : null}
          <button
            type="button"
            className="text-muted-foreground text-xs underline underline-offset-2"
            onClick={() => void openUrl(PAGES[what])}
          >
            or download it yourself
          </button>
        </div>
      )}
      {job && job.state !== "done" && <JobSteps job={job} />}
      {job?.note && !ready && (
        <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          {job.note}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-700 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}
