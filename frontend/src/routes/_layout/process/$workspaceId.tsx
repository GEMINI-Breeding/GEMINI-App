import { Outlet, createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_layout/process/$workspaceId")({
  component: () => <Outlet />,
})
