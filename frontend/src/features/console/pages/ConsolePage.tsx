import { Check, Copy } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { OpenAPI } from "@/client"
import { Button } from "@/components/ui/button"
import { agentApi } from "@/features/agent/lib/agentApi"
import { getToken } from "@/lib/auth"
import { isManagedStack, stackLogs } from "@/lib/stack"

interface LogLine {
  level: string
  message: string
  ts: number
  /** "api", or the worker that logged it: "ml", "odm", "geo", … */
  source?: string
}

const SOURCE_LABEL: Record<string, string> = {
  api: "API",
  agent: "GEMI service",
  cluster: "Cluster jobs",
}

const LEVEL_COLOR: Record<string, string> = {
  DEBUG: "text-zinc-500",
  INFO: "text-green-400",
  WARNING: "text-yellow-400",
  ERROR: "text-red-400",
  CRITICAL: "text-red-600 font-bold",
}

export function ConsolePage() {
  const [lines, setLines] = useState<LogLine[]>([])
  const [stackLog, setStackLog] = useState<string>("")
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState("")
  const [source, setSource] = useState("")
  // "Clear" hides everything logged so far; polling keeps adding newer lines.
  const [clearedAt, setClearedAt] = useState(0)
  const [copied, setCopied] = useState(false)
  const [status, setStatus] = useState<
    "connecting" | "ok" | "forbidden" | "error"
  >("connecting")
  const [agentUp, setAgentUp] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    // The API's lines (and its workers') and the agent service's (uploads,
    // copies, cluster jobs), merged by time. Either can be missing: the API
    // only answers an administrator, and a plain web install has no agent.
    let apiLines: LogLine[] = []
    let agentLines: LogLine[] = []
    const show = () =>
      setLines(
        [...apiLines, ...agentLines].sort((a, b) => a.ts - b.ts).slice(-2000),
      )

    const poll = async () => {
      // Was `/api/v1/utils/logs` with the old backend's "access_token"
      // localStorage key — wrong path AND wrong key, so this always
      // 401'd or 404'd and the console sat empty. GEMINIbase mounts
      // controllers at /api/<key>, and the token lives under
      // "gemini.auth.token" (read via getToken()).
      const [api, agent] = await Promise.allSettled([
        fetch(`${OpenAPI.BASE}/api/utils/logs`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        }),
        agentApi.logs(),
      ])
      if (!active) return
      setAgentUp(agent.status === "fulfilled")
      if (agent.status === "fulfilled") agentLines = agent.value
      if (api.status === "fulfilled" && api.value.ok) {
        apiLines = await api.value.json()
        if (!active) return
        setStatus("ok")
        setStackLog("") // clear fallback log once connected
      } else if (
        api.status === "fulfilled" &&
        (api.value.status === 401 || api.value.status === 403)
      ) {
        // The API answers, but its log is for administrators.
        apiLines = []
        setStatus("forbidden")
      } else {
        setStatus("error")
        fetchStackLog()
      }
      show()
    }

    // The API is down, so its log stream is too: in the desktop app, show
    // the services' own logs from Docker instead.
    const fetchStackLog = async () => {
      if (!isManagedStack()) return
      try {
        const text = await stackLogs(200)
        if (active) setStackLog(text)
      } catch {
        // Docker itself unreachable — the stack gate explains that.
      }
    }

    poll()
    const interval = setInterval(poll, 2000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  const sources = [...new Set(lines.map((l) => l.source ?? "api"))].sort()
  const filtered = lines.filter(
    (l) =>
      l.ts > clearedAt &&
      (!source || (l.source ?? "api") === source) &&
      (!filter || l.message.toLowerCase().includes(filter.toLowerCase())),
  )

  // Follow new lines while auto-scroll is on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when a line arrives
  useEffect(() => {
    // Scroll the log box only: scrollIntoView also scrolled the page itself,
    // pushing the header and filters out of sight.
    const el = containerRef.current
    if (autoScroll && el) el.scrollTo({ top: el.scrollHeight })
  }, [autoScroll, filtered.length])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }

  const handleCopy = () => {
    const text = filtered
      .map((l) => `[${l.source ?? "api"}] ${l.message}`)
      .join("\n")
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const backendUrl = OpenAPI.BASE || "(empty — backend URL not injected)"

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)] gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Console</h1>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-mono ${
              status === "ok"
                ? "bg-green-900/40 text-green-400"
                : status === "error" || status === "forbidden"
                  ? "bg-red-900/40 text-red-400"
                  : "bg-zinc-800 text-zinc-400"
            }`}
          >
            {status === "ok"
              ? "connected"
              : status === "forbidden"
                ? "API log: administrators only"
                : status === "error"
                  ? "unreachable"
                  : "connecting…"}
          </span>
          {agentUp && (
            <span
              className="text-xs px-2 py-0.5 rounded-full font-mono bg-green-900/40 text-green-400"
              title="Uploads, copies and cluster jobs run by this computer's GEMI service"
            >
              + this computer
            </span>
          )}
          <span
            className="text-xs text-zinc-500 font-mono truncate max-w-xs"
            title={backendUrl}
          >
            {backendUrl}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground"
            data-testid="console-source-filter"
            aria-label="Log source"
          >
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s] ?? `${s} worker`}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-8 rounded border border-border bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-48"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={handleCopy}
            disabled={filtered.length === 0}
          >
            {copied ? (
              <Check className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() =>
              setClearedAt(lines.length ? lines[lines.length - 1].ts : 0)
            }
          >
            Clear
          </Button>
          <Button
            variant={autoScroll ? "secondary" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setAutoScroll((v) => !v)}
          >
            {autoScroll ? "Auto-scroll on" : "Auto-scroll off"}
          </Button>
        </div>
      </div>

      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto rounded-lg border border-border bg-zinc-950 p-3 font-mono text-xs"
      >
        {status === "error" && stackLog ? (
          <div>
            <p className="text-yellow-500 italic mb-2">
              GEMINI API unreachable — showing the services' logs:
            </p>
            <pre className="text-zinc-300 whitespace-pre-wrap break-all">
              {stackLog}
            </pre>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-zinc-500 italic">
            {status === "forbidden"
              ? "Nothing from this computer yet. The API's own log (jobs, workers) is shown to administrators."
              : "No log output yet…"}
          </p>
        ) : (
          filtered.map((line, i) => (
            <div
              key={i}
              className={`leading-5 whitespace-pre-wrap break-all ${LEVEL_COLOR[line.level] ?? "text-zinc-300"}`}
              data-testid="console-line"
              data-source={line.source ?? "api"}
            >
              <span className="mr-2 text-zinc-500">
                [{line.source ?? "api"}]
              </span>
              {line.message}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
