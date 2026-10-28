import {
  createFileRoute,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router"
import { CircleHelp } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { Footer } from "@/components/Common/Footer"
import { HelpSidebar, OnboardingTour } from "@/components/Help"
import {
  appTour,
  getTourSection,
  type TourStep,
} from "@/components/Help/tourSteps"
import { ProcessPanel } from "@/components/ProcessPanel"
import AppSidebar from "@/components/Sidebar/AppSidebar"
import { ConnectionNotice } from "@/components/System/ConnectionNotice"
import { WorkersNotice } from "@/components/System/WorkersNotice"
import { Button } from "@/components/ui/button"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { hydrateRunStore } from "@/features/process/lib/runStore"
import { isLoggedIn } from "@/hooks/useAuth"
import { useUpdateChecker } from "@/hooks/useUpdateChecker"
import { onLogout } from "@/lib/auth"
import { autoSignIn } from "@/lib/autoSignIn"
import { checkBackend } from "@/lib/connection"
import { openUrl } from "@/lib/platform"

export const Route = createFileRoute("/_layout")({
  component: Layout,
  // Unauthenticated visitors land on /login. Any child route under
  // /_layout inherits this guard, so the sidebar, dashboards, and all
  // feature pages are gated behind a valid JWT. When auth is disabled
  // on the backend (GEMINI_JWT_SECRET empty) we still redirect only when
  // the caller has no stored token — which is the same condition as
  // "never logged in," so the flow stays consistent.
  //
  // By default there is no login step: the app signs in with this
  // computer's own account (lib/autoSignIn.ts). The login page is only
  // reached when that is switched off in Settings, or is not available.
  //
  // With no processing stack reachable there is nothing to sign in to: the
  // app opens anyway (home page, compute, model settings work) and the
  // ConnectionNotice says what to do.
  beforeLoad: async () => {
    if (!isLoggedIn() && !(await autoSignIn())) {
      if (!(await checkBackend())) return
      throw redirect({ to: "/login" })
    }
  },
})

function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const FULL_HEIGHT_PREFIXES = ["/files", "/analyze", "/settings", "/process"]
  const isFullHeight =
    location.pathname === "/" ||
    FULL_HEIGHT_PREFIXES.some((p) => location.pathname.startsWith(p))

  // Follow the 401 interceptor's logout event out of this layout. Without
  // this the user would remain on a data-dependent page after the token
  // was cleared, trying to re-render against stale React Query caches.
  // Process workspaces / runs live on the server; load them (and start
  // syncing) once we're inside the signed-in shell.
  useEffect(() => {
    void hydrateRunStore()
  }, [])

  useEffect(() => {
    const off = onLogout(() => {
      // An expired session signs straight back in; only a deliberate
      // sign-out (or required sign-in) shows the login page.
      void autoSignIn().then(async (ok) => {
        if (ok) window.location.reload()
        // Stack unreachable: there is no login to go to; stay, the notice explains.
        else if (await checkBackend()) navigate({ to: "/login" })
      })
    })
    return off
  }, [navigate])

  const [helpOpen, setHelpOpen] = useState(false)
  const [tourSteps, setTourSteps] = useState<TourStep[] | null>(null)
  const [tourStep, setTourStep] = useState<number>(0)

  // The page's own tour, or (whole) the tour of every stage of the app.
  const startTour = useCallback(
    (whole?: boolean) => {
      const section =
        whole === true
          ? appTour()
          : getTourSection(location.pathname, (location.search as any)?.step)
      setTourSteps(section.steps)
      setTourStep(0)
    },
    [location.pathname, location.search],
  )
  const closeTour = useCallback(() => setTourSteps(null), [])
  // First open: offer the guided tour once (it also stays under Help).
  const TOUR_OFFERED = "gemini.tour.offered"
  const [tourInvite, setTourInvite] = useState(() => {
    try {
      return localStorage.getItem(TOUR_OFFERED) !== "1"
    } catch {
      return false
    }
  })
  const answerInvite = (take: boolean) => {
    try {
      localStorage.setItem(TOUR_OFFERED, "1")
    } catch {
      // no storage: it is offered again next time
    }
    setTourInvite(false)
    if (take) startTour(true)
  }
  const nextTourStep = useCallback(
    () =>
      setTourStep((s) =>
        tourSteps !== null && s < tourSteps.length - 1 ? s + 1 : s,
      ),
    [tourSteps],
  )
  const prevTourStep = useCallback(
    () => setTourStep((s) => (s > 0 ? s - 1 : s)),
    [],
  )

  const handleUpdateAvailable = useCallback(
    (version: string, downloadUrl: string) => {
      toast.info(`GEMI ${version} is available`, {
        description:
          "Download the latest release from GitHub for your platform (macOS, Windows, Linux).",
        duration: Infinity,
        action: {
          label: "Download",
          onClick: () => {
            localStorage.setItem("gemi_dismissed_version", version)
            openUrl(downloadUrl)
          },
        },
        onDismiss: () => {
          localStorage.setItem("gemi_dismissed_version", version)
        },
      })
    },
    [],
  )

  useUpdateChecker({ onUpdateAvailable: handleUpdateAvailable })

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <header className="bg-background sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1 text-muted-foreground" />
          <div className="ml-auto">
            <button
              type="button"
              title="Help"
              onClick={() => setHelpOpen((v) => !v)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <CircleHelp className="h-5 w-5" />
            </button>
          </div>
        </header>
        {isFullHeight ? (
          // Dashboard: no padding, no max-width — fills remaining height exactly
          <main className="flex flex-col flex-1 min-h-0 overflow-y-auto">
            <Outlet />
          </main>
        ) : (
          // All other pages: standard padded + centered layout. The extra
          // bottom padding lets a page's last controls scroll clear of the
          // fixed process panel / its pill in the bottom-right corner.
          <main className="min-w-0 flex-1 p-6 pb-24 md:p-8 md:pb-24">
            <div className="mx-auto max-w-7xl min-w-0">
              <Outlet />
            </div>
          </main>
        )}
        {!isFullHeight && <Footer />}
      </SidebarInset>
      <ProcessPanel />
      <ConnectionNotice />
      <WorkersNotice />

      <HelpSidebar
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        onStartTour={startTour}
      />

      {tourInvite && tourSteps === null && (
        <div
          className="bg-background fixed right-6 bottom-20 z-50 w-80 rounded-lg border p-4 shadow-lg"
          data-testid="tour-invite"
          role="dialog"
          aria-label="Take the tour"
        >
          <p className="font-medium">New to GEMI?</p>
          <p className="text-muted-foreground mt-1 text-sm">
            A short tour shows where things are on this page. It is always under
            Help (?) later.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => answerInvite(false)}
            >
              Not now
            </Button>
            <Button size="sm" onClick={() => answerInvite(true)}>
              Take the tour
            </Button>
          </div>
        </div>
      )}

      {tourSteps !== null && (
        <OnboardingTour
          steps={tourSteps}
          step={tourStep}
          onNext={nextTourStep}
          onBack={prevTourStep}
          onClose={closeTour}
        />
      )}
    </SidebarProvider>
  )
}

export default Layout
