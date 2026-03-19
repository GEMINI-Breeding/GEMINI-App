import { useEffect, useRef, useState } from "react"
import { OpenAPI } from "@/client"
import { Button } from "@/components/ui/button"
import { Copy, Check } from "lucide-react"

interface LogLine {
  level: string
  message: string
  ts: number
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
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState("")
  const [copied, setCopied] = useState(false)
  const [status, setStatus] = useState<"connecting" | "ok" | "error">("connecting")
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true

    const poll = async () => {
      try {
        const token = localStorage.getItem("access_token") || ""
        const base = OpenAPI.BASE
        const res = await fetch(`${base}/api/v1/utils/logs`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!active) return
        if (res.ok) {
          const data: LogLine[] = await res.json()
          setLines(data)
          setStatus("ok")
        } else {
          setStatus("error")
        }
      } catch {
        if (active) setStatus("error")
      }
    }

    poll()
    const interval = setInterval(poll, 2000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [lines, autoScroll])

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }

  const filtered = filter
    ? lines.filter((l) => l.message.toLowerCase().includes(filter.toLowerCase()))
    : lines

  const handleCopy = () => {
    const text = filtered.map((l) => l.message).join("\n")
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
          <span className={`text-xs px-2 py-0.5 rounded-full font-mono ${
            status === "ok" ? "bg-green-900/40 text-green-400" :
            status === "error" ? "bg-red-900/40 text-red-400" :
            "bg-zinc-800 text-zinc-400"
          }`}>
            {status === "ok" ? "connected" : status === "error" ? "unreachable" : "connecting…"}
          </span>
          <span className="text-xs text-zinc-500 font-mono truncate max-w-xs" title={backendUrl}>
            {backendUrl}
          </span>
        </div>
        <div className="flex items-center gap-2">
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
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setLines([])}
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
        {filtered.length === 0 ? (
          <p className="text-zinc-500 italic">No log output yet…</p>
        ) : (
          filtered.map((line, i) => (
            <div key={i} className={`leading-5 whitespace-pre-wrap break-all ${LEVEL_COLOR[line.level] ?? "text-zinc-300"}`}>
              {line.message}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
