import {
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import ReactDOM from "react-dom/client"
import { OpenAPI } from "./client"
import { ThemeProvider } from "./components/theme-provider"
import { Toaster } from "./components/ui/sonner"
import { ProcessProvider } from "./contexts/ProcessContext"
import "./index.css"
import { routeTree } from "./routeTree.gen"

// In production Tauri builds the sidecar injects __GEMI_BACKEND_URL__ before
// the app loads. In dev mode we use "" so all requests use relative URLs and
// go through the Vite proxy (/api → http://127.0.0.1:8000), which avoids
// WebKit cross-origin issues with localhost:PORT requests.
OpenAPI.BASE = (window as any).__GEMI_BACKEND_URL__ ?? ""

const queryClient = new QueryClient()

const router = createRouter({ routeTree })
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <QueryClientProvider client={queryClient}>
        <ProcessProvider>
          <RouterProvider router={router} />
          <Toaster richColors closeButton />
        </ProcessProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
