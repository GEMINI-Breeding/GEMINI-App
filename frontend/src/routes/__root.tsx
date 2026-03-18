import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { createRootRoute, HeadContent, Outlet } from "@tanstack/react-router"
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools"
import { useState } from "react"
import ErrorComponent from "@/components/Common/ErrorComponent"
import NotFound from "@/components/Common/NotFound"
import { BackendStatus } from "@/components/System"

function RootComponent() {
  const [backendReady, setBackendReady] = useState(false)

  if (!backendReady) {
    return <BackendStatus onReady={() => setBackendReady(true)} />
  }

  return (
    <>
      <HeadContent />
      <Outlet />
      {import.meta.env.DEV && (
        <>
          <TanStackRouterDevtools position="bottom-left" />
          <ReactQueryDevtools buttonPosition="bottom-left" />
        </>
      )}
    </>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: () => <NotFound />,
  errorComponent: () => <ErrorComponent />,
})
