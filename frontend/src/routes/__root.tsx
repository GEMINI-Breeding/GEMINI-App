import {
  createRootRoute,
  HeadContent,
  Outlet,
  useRouterState,
} from "@tanstack/react-router"
import { useState } from "react"
import ErrorComponent from "@/components/Common/ErrorComponent"
import NotFound from "@/components/Common/NotFound"
import { BackendStatus } from "@/components/System"

function RootComponent() {
  const [backendReady, setBackendReady] = useState(false)
  // First-run setup has no backend to wait for: that is what it sets up.
  const onSetup = useRouterState({
    select: (st) => st.location.pathname === "/setup",
  })

  if (!backendReady && !onSetup) {
    return <BackendStatus onReady={() => setBackendReady(true)} />
  }

  return (
    <>
      <HeadContent />
      <Outlet />
      {/* {import.meta.env.DEV && (
        <>
          <TanStackRouterDevtools position="bottom-left" />
          <ReactQueryDevtools buttonPosition="bottom-left" />
        </>
      )} */}
    </>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: () => <NotFound />,
  errorComponent: () => <ErrorComponent />,
})
