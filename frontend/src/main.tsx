import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import ReactDOM from "react-dom/client"
import { OpenAPI } from "./client"
import { StackGate } from "./components/Stack/StackGate"
import { ThemeProvider } from "./components/theme-provider"
import { ConfirmDialogProvider } from "./components/ui/confirm-dialog"
import { Toaster } from "./components/ui/sonner"
import { ProcessProvider } from "./contexts/ProcessContext"
import { OnboardingGate } from "./features/agent/components/Welcome"
import { installAuthInterceptors } from "./lib/auth"
import { announcePlace, applyClusterUrls } from "./lib/stack"
import "./index.css"
import { routeTree } from "./routeTree.gen"

// In the browser and dev builds requests are relative and go through the
// Vite proxy (/api → http://127.0.0.1:7777), which avoids WebKit
// cross-origin issues with localhost:PORT requests. The desktop app's
// StackGate points OpenAPI.BASE at its local stack once that is up.
OpenAPI.BASE = (window as any).__GEMI_BACKEND_URL__ ?? ""
// Desktop app set to use a cluster: the API is the agent service's tunnel.
applyClusterUrls()
// …and tell the agent service, so it talks to the same API.
announcePlace()

// Wire the JWT bearer-token resolver and the 401 interceptor. After this call,
// OpenAPI.TOKEN reads from localStorage on every request and a 401 response
// (except from the login endpoint itself) triggers a logout.
installAuthInterceptors()

// Prevent browser zoom (Ctrl+scroll, Ctrl+/-, pinch) from breaking fixed
// layouts and coordinate calculations in map/canvas tools.
window.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey) e.preventDefault()
  },
  { passive: false },
)
window.addEventListener("keydown", (e) => {
  if (
    (e.ctrlKey || e.metaKey) &&
    (e.key === "+" || e.key === "-" || e.key === "=" || e.key === "0")
  ) {
    e.preventDefault()
  }
})

const queryClient = new QueryClient()

// While a page waits to open (signing in, which on a cluster can take a few
// seconds), say so rather than show an empty window.
function Opening() {
  return (
    <div className="text-muted-foreground flex min-h-screen items-center justify-center text-sm">
      Signing in…
    </div>
  )
}

const router = createRouter({
  routeTree,
  defaultPendingComponent: Opening,
  defaultPendingMs: 300,
})
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <QueryClientProvider client={queryClient}>
        {/* First open: where the work runs and which model the agent uses.
            Skipped entirely once both are answered. */}
        <OnboardingGate>
          {/* Desktop app: nothing below talks to the API before the local
              stack is up and signed in. A no-op in the browser. */}
          <StackGate>
            <ProcessProvider>
              <ConfirmDialogProvider>
                <RouterProvider router={router} />
                <Toaster richColors closeButton />
              </ConfirmDialogProvider>
            </ProcessProvider>
          </StackGate>
        </OnboardingGate>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
