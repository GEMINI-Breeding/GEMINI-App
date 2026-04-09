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
    <div className="flex flex-col" style={{ height: "calc(100vh - 64px)" }}>
      <div className="flex-shrink-0 px-6 pt-5 pb-3 border-b">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-muted-foreground text-sm">Manage your application settings and preferences</p>
      </div>
      <ApplicationSettings />
    </div>
  )
}
