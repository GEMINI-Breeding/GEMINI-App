import { createFileRoute } from "@tanstack/react-router"
import { Bot, LayoutDashboard } from "lucide-react"

import { AgentHome } from "@/features/agent/pages/AgentHome"
import { DashboardBuilder } from "@/features/dashboard/components/DashboardBuilder"
import { useBackendUp } from "@/lib/connection"
import { setHomePrefs, useHomePrefs } from "@/lib/homePrefs"

/**
 * Home: the dashboard (generated from the data) and the agent, side by side
 * as two tabs. Either can be turned off in Settings → Home; with only one on
 * there is no tab row. Without a processing stack the agent's set-up mode
 * is shown, since connecting compute is the only thing to do.
 */
function Home() {
  const up = useBackendUp()
  const prefs = useHomePrefs()
  if (up === false) return <AgentHome setup inLayout />
  const both = prefs.agent && prefs.dashboard
  const view = both ? prefs.view : prefs.agent ? "agent" : "dashboard"
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {both && (
        <div
          className="flex h-10 shrink-0 items-center gap-1 px-4"
          role="tablist"
          data-testid="home-tabs"
        >
          {(
            [
              ["dashboard", "Dashboard", LayoutDashboard],
              ["agent", "Agent", Bot],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              data-testid={`home-tab-${id}`}
              onClick={() => setHomePrefs({ view: id })}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-sm transition-colors ${
                view === id
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      )}
      {view === "agent" ? (
        <AgentHome
          inLayout
          height={both ? "h-[calc(100vh-8.5rem)]" : undefined}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col border-t">
          <DashboardBuilder embedded />
        </div>
      )}
    </div>
  )
}

export const Route = createFileRoute("/_layout/")({
  component: Home,
  head: () => ({
    meta: [{ title: "Home - GEMINI" }],
  }),
})
