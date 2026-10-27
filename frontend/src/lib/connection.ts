/**
 * Is the processing stack (the GEMINIbase REST API) reachable right now?
 *
 * The app opens whether or not it is: without it the home page (agent,
 * compute) still works, and a notice says what is missing and how to fix it
 * (components/System/ConnectionNotice.tsx). Pages that need the stack show
 * their own empty or error states until it is back.
 */
import { useQuery } from "@tanstack/react-query"

function backendBase(): string {
  const base = (window as { __GEMI_BACKEND_URL__?: string })
    .__GEMI_BACKEND_URL__
  return base ? base.replace(/\/$/, "") : ""
}

export function backendHealthUrl(): string {
  return `${backendBase()}/healthz`
}

/** One look: true when the API answers its health check. */
export async function checkBackend(timeoutMs = 4000): Promise<boolean> {
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), timeoutMs)
  try {
    const r = await fetch(backendHealthUrl(), { signal: stop.signal })
    // The dev server answers unknown paths with its HTML page: only JSON counts.
    return r.ok && (r.headers.get("content-type") ?? "").includes("json")
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

// Misses in a row. One slow answer is not an outage: a page that has many
// requests in flight (the dashboard's analyses) can hold the health check in
// the browser's queue past its timeout while the stack is perfectly well.
let misses = 0
const MISSES_FOR_DOWN = 2

// A large upload fills a slow link (an SSH tunnel to a cluster): the health
// check then waits behind the upload's parts and times out while the stack
// answers every part. A part that arrived recently proves the connection.
let lastAnswer = 0
const ANSWER_COUNTS_MS = 120_000

/** Call when the API answered a request (e.g. an upload part was stored). */
export function noteBackendAnswered(): void {
  lastAnswer = Date.now()
}

async function checkSteady(): Promise<boolean> {
  const ok = await checkBackend(8000)
  misses = ok ? 0 : misses + 1
  if (ok) lastAnswer = Date.now()
  return (
    ok || misses < MISSES_FOR_DOWN || Date.now() - lastAnswer < ANSWER_COUNTS_MS
  )
}

/**
 * Live answer, re-checked every few seconds (also while the window is in the
 * background, so the answer is current when the person comes back).
 * `undefined` until the first check has finished; `false` only after two
 * checks in a row went unanswered.
 */
export function useBackendUp(): boolean | undefined {
  const q = useQuery({
    queryKey: ["backend", "up"],
    queryFn: checkSteady,
    refetchInterval: (query) => (query.state.data ? 20_000 : 3_000),
    refetchIntervalInBackground: true,
    retry: false,
  })
  return q.data
}
