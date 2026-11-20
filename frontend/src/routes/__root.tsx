import { createRootRoute, HeadContent, Outlet } from "@tanstack/react-router"
import ErrorComponent from "@/components/Common/ErrorComponent"
import NotFound from "@/components/Common/NotFound"

function RootComponent() {
  // The app opens whether or not the processing stack answers: the layout's
  // ConnectionNotice says what is missing and how to fix it.
  return (
    <>
      <HeadContent />
      <Outlet />
    </>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: () => <NotFound />,
  errorComponent: () => <ErrorComponent />,
})
