import { useCallback } from "react"
import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router"
import { toast } from "sonner"

import { Footer } from "@/components/Common/Footer"
import { ProcessPanel } from "@/components/ProcessPanel"
import AppSidebar from "@/components/Sidebar/AppSidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { useUpdateChecker } from "@/hooks/useUpdateChecker"

export const Route = createFileRoute("/_layout")({
  component: Layout,
})

function Layout() {
  const location = useLocation()
  const isFullHeight = location.pathname === "/"

  const handleUpdateAvailable = useCallback((version: string, downloadUrl: string) => {
    toast.info(`Update available: ${version}`, {
      description: "A new version of GEMI is ready to download.",
      duration: Infinity,
      action: {
        label: "Download",
        onClick: () => {
          // Store dismissed so we don't re-show for this version
          localStorage.setItem("gemi_dismissed_version", version)
          window.open(downloadUrl, "_blank")
        },
      },
      onDismiss: () => {
        localStorage.setItem("gemi_dismissed_version", version)
      },
    })
  }, [])

  useUpdateChecker({ onUpdateAvailable: handleUpdateAvailable })

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1 text-muted-foreground" />
        </header>
        {isFullHeight ? (
          // Dashboard: no padding, no max-width — fills remaining height exactly
          <main className="flex flex-col flex-1 overflow-hidden">
            <Outlet />
          </main>
        ) : (
          // All other pages: standard padded + centered layout
          <main className="flex-1 p-6 md:p-8">
            <div className="mx-auto max-w-7xl">
              <Outlet />
            </div>
          </main>
        )}
        {!isFullHeight && <Footer />}
      </SidebarInset>
      <ProcessPanel />
    </SidebarProvider>
  )
}

export default Layout
