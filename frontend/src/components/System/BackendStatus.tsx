import { useEffect, useState } from "react"

interface BackendStatusProps {
  onReady: () => void
}

export function BackendStatus({ onReady }: BackendStatusProps) {
  const [status, setStatus] = useState<
    "checking" | "error" | "starting" | "ready"
  >("checking")
  const [error, setError] = useState<string>("")

  const waitForBackend = async () => {
    // Production Tauri: Rust setup already confirmed backend is healthy.
    if ((window as any).__GEMI_BACKEND_URL__) {
      return
    }

    // Dev mode: use relative URL so it goes through the Vite proxy
    // (/api → http://127.0.0.1:8000), avoiding WebKit cross-origin issues.
    const maxRetries = 60
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch("/api/v1/utils/health-check/")
        if (response.ok) {
          return
        }
      } catch (_e) {
        // Still waiting...
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    throw new Error("Backend failed to start after 60 seconds")
  }

  const checkBackend = async () => {
    try {
      setStatus("starting")
      await waitForBackend()
      setStatus("ready")
      onReady()
    } catch (err) {
      setStatus("error")
      setError(err as string)
    }
  }

  useEffect(() => {
    checkBackend()
  }, [])

  if (status === "checking" || status === "starting") {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <h1>Starting GEMI...</h1>
        <p>Initializing backend services...</p>
        <p style={{ fontSize: "12px", color: "#666", marginTop: "20px" }}>
          This may take a few seconds on first launch
        </p>
        <div style={{ marginTop: "20px", fontSize: "32px" }}>...</div>
      </div>
    )
  }

  if (status === "error") {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <h1>Backend Error</h1>
        <p style={{ color: "#d32f2f", marginBottom: "20px" }}>{error}</p>

        <button
          onClick={checkBackend}
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

  return null // Ready state - parent will show main app
}
