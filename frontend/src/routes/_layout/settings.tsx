import { createFileRoute } from "@tanstack/react-router"

import ApplicationSettings from "@/components/UserSettings/ApplicationSettings"

export const Route = createFileRoute("/_layout/settings")({
  component: UserSettings,
  head: () => ({
    meta: [{ title: "Settings" }],
  }),
})

function UserSettings() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your application settings and preferences
        </p>
      </div>
      <ApplicationSettings />
    </div>
  )
}
