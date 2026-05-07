import { useCallback, useEffect, useState } from "react"

interface BackendStatusProps {
  onReady: () => void
}

/**
 * `/healthz` is the Litestar built-in liveness route the GEMINIbase
 * REST API mounts unconditionally. It works on the migration backend
 * AND on older backend forks that don't have the `/api/utils/*`
 * controller. Polling it instead of `/api/utils/health-check` keeps
 * the splash compatible across both.
 */
function backendBase(): string {
  const baseUrl = (window as { __GEMI_BACKEND_URL__?: string })
    .__GEMI_BACKEND_URL__
  return baseUrl ? baseUrl.replace(/\/$/, "") : ""
}

function healthUrl(): string {
  return `${backendBase()}/healthz`
}

function schemaUrl(): string {
  return `${backendBase()}/schema/openapi.json`
}

interface PollOutcome {
  ok: boolean
  status: number | null
  errorMessage: string | null
}

async function pollOnce(url: string): Promise<PollOutcome> {
  try {
    const response = await fetch(url)
    return {
      ok: response.ok,
      status: response.status,
      errorMessage: response.ok
        ? null
        : `HTTP ${response.status} ${response.statusText || "Not OK"}`,
    }
  } catch (err) {
    return {
      ok: false,
      status: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Sentinel paths the frontend depends on. These were added by the
 * migration's Phase-2 auth + utils controllers and are absent from any
 * pre-migration backend image. Checking presence at boot turns a later
 * 404 (e.g. on login) into an actionable "rebuild your backend image"
 * message at the splash, before the user has a chance to click anything.
 */
const REQUIRED_PATHS = [
  "/api/users/login/access-token",
  "/api/utils/health-check",
] as const

interface CompatibilityResult {
  ok: boolean
  missing: string[]
  fetchError: string | null
}

async function checkCompatibility(): Promise<CompatibilityResult> {
  try {
    const response = await fetch(schemaUrl())
    if (!response.ok) {
      return {
        ok: false,
        missing: [],
        fetchError: `HTTP ${response.status} from ${schemaUrl()}`,
      }
    }
    // The dev server's proxy may not be configured for `/schema/*`, in
    // which case Vite serves its SPA fallback (HTML) and `response.json()`
    // throws an opaque "string did not match expected pattern" error.
    // Sniff the content-type / body shape so we can surface a useful
    // message instead.
    const contentType = response.headers.get("content-type") ?? ""
    const text = await response.text()
    const looksLikeJson =
      /json/i.test(contentType) || text.trimStart().startsWith("{")
    if (!looksLikeJson) {
      return {
        ok: false,
        missing: [],
        fetchError:
          `${schemaUrl()} returned non-JSON content (content-type: "${contentType}"). ` +
          "This usually means the dev server's proxy isn't forwarding `/schema/*` " +
          "to the backend. Restart `npm start` after changing `vite.config.ts`.",
      }
    }
    const schema = JSON.parse(text) as { paths?: Record<string, unknown> }
    const paths = schema.paths ?? {}
    const missing = REQUIRED_PATHS.filter((p) => !(p in paths))
    return { ok: missing.length === 0, missing, fetchError: null }
  } catch (err) {
    return {
      ok: false,
      missing: [],
      fetchError: err instanceof Error ? err.message : String(err),
    }
  }
}

type Status = "checking" | "starting" | "error" | "ready"

export function BackendStatus({ onReady }: BackendStatusProps) {
  const [status, setStatus] = useState<Status>("checking")
  const [errorMessage, setErrorMessage] = useState<string>("")
  const [errorHint, setErrorHint] = useState<string>("")
  const [attempts, setAttempts] = useState(0)
  const [lastOutcome, setLastOutcome] = useState<string>("")

  const checkBackend = useCallback(async () => {
    const url = healthUrl()
    setStatus("starting")
    setErrorMessage("")
    setErrorHint("")
    setAttempts(0)
    setLastOutcome("")

    const maxRetries = 30
    for (let i = 0; i < maxRetries; i++) {
      const outcome = await pollOnce(url)
      setAttempts(i + 1)

      if (outcome.ok) {
        // Liveness passed. Now verify the running image actually carries
        // the controllers this frontend expects.
        const compat = await checkCompatibility()
        if (compat.ok) {
          setStatus("ready")
          onReady()
          return
        }
        setStatus("error")
        if (compat.fetchError) {
          setErrorMessage(
            `Could not read OpenAPI schema from ${schemaUrl()}: ${compat.fetchError}`,
          )
          setErrorHint(
            "The backend is up but its /schema/openapi.json isn't responding. " +
              "If the docker image is mid-rebuild, retry in a moment; " +
              "otherwise check the rest-api container logs.",
          )
        } else {
          setErrorMessage(
            `Backend image is missing endpoints this frontend depends on: ${compat.missing.join(", ")}.`,
          )
          setErrorHint(
            "The running REST API was built from a backend tree that predates the migration's auth + utils controllers. " +
              "Rebuild against the migration submodule:  " +
              "`docker compose -f docker-compose.yaml up -d --build rest-api` " +
              "from the GEMINI-App repo root. " +
              "If a different docker-compose project is currently running, bring it down first.",
          )
        }
        return
      }

      // 4xx is deterministic — the endpoint isn't there or the
      // request is malformed. No point retry-storming for 60 s.
      if (
        outcome.status !== null &&
        outcome.status >= 400 &&
        outcome.status < 500
      ) {
        setStatus("error")
        setErrorMessage(
          `Backend reachable at ${url} but returned ${outcome.status}.`,
        )
        setErrorHint(
          "The endpoint /healthz isn't mounted on this backend. " +
            "Check that you're running the GEMINIbase REST API at the proxied address (default :7777), " +
            "and that the running image actually contains this branch's code.",
        )
        return
      }

      // Network error or 5xx → keep waiting, surface progress so the
      // user knows what's happening instead of staring at a frozen splash.
      setLastOutcome(outcome.errorMessage ?? "no response")
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    setStatus("error")
    setErrorMessage(
      `Backend at ${url} did not become ready after ${maxRetries} seconds.`,
    )
    setErrorHint(
      "Make sure the docker-compose stack is up (default: REST API on port 7777). " +
        "If it is up, run `docker logs geminibase-rest-api` to see why it isn't answering /healthz.",
    )
  }, [onReady])

  useEffect(() => {
    void checkBackend()
  }, [checkBackend])

  if (status === "checking" || status === "starting") {
    const showLateHint = attempts >= 3
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <h1>Starting GEMI...</h1>
        <p>Initializing backend services...</p>
        <p style={{ fontSize: "12px", color: "#666", marginTop: "20px" }}>
          {attempts === 0
            ? "This may take a few moments on first launch."
            : `Polling ${healthUrl()} (attempt ${attempts}/30)`}
        </p>
        {showLateHint && (
          <p
            style={{
              fontSize: "12px",
              color: "#a16207",
              marginTop: "12px",
              maxWidth: "560px",
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            Still no response from the backend. Check that the GEMINIbase REST
            API is up (default port 7777). Last result: {lastOutcome || "—"}
          </p>
        )}
        <div style={{ marginTop: "20px", fontSize: "32px" }}>...</div>
      </div>
    )
  }

  if (status === "error") {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <h1>Backend Error</h1>
        <p
          style={{
            color: "#d32f2f",
            marginBottom: "12px",
            maxWidth: "640px",
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {errorMessage}
        </p>
        {errorHint && (
          <p
            style={{
              color: "#555",
              fontSize: "13px",
              maxWidth: "640px",
              marginLeft: "auto",
              marginRight: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {errorHint}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            void checkBackend()
          }}
          style={{
            marginTop: "20px",
            padding: "10px 20px",
            fontSize: "16px",
            cursor: "pointer",
            backgroundColor: "#1976d2",
            color: "white",
            border: "none",
            borderRadius: "4px",
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  return null
}
