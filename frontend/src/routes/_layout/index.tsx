import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_layout/")({
  component: Dashboard,
  head: () => ({
    meta: [
      {
        title: "Dashboard - FastAPI Cloud",
      },
    ],
  }),
})

function Dashboard() {
  return (
    <div>
      <div>
        <h1 className="text-2xl truncate max-w-sm">
          Hi 👋
        </h1>
        <p className="text-muted-foreground">
          Welcome back, nice to see you again
        </p>
      </div>
    </div>
  )
}
