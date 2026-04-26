/**
 * AdminTabs — sticky strip of links across the top of every /admin page.
 *
 * Rendered by each route component; not a layout because Phase-5's user-
 * settings admin route is a flat page (no Outlet). Cheaper to render a
 * shared component on each page than to refactor the existing Admin
 * suspense scaffolding.
 */
import { Link, useRouterState } from "@tanstack/react-router"

import { cn } from "@/lib/utils"

const TABS: Array<{ to: string; label: string }> = [
  { to: "/admin", label: "Users" },
  { to: "/admin/data-types", label: "Data types" },
  { to: "/admin/data-formats", label: "Data formats" },
  { to: "/admin/dataset-types", label: "Dataset types" },
  { to: "/admin/sensor-types", label: "Sensor types" },
  { to: "/admin/sensor-platforms", label: "Sensor platforms" },
  { to: "/admin/sensors", label: "Sensors" },
  { to: "/admin/trait-levels", label: "Trait levels" },
  { to: "/admin/traits", label: "Traits" },
  { to: "/admin/sites", label: "Sites" },
  { to: "/admin/seasons", label: "Seasons" },
  { to: "/admin/populations", label: "Populations" },
  { to: "/admin/lines", label: "Lines" },
  { to: "/admin/accessions", label: "Accessions" },
]

export function AdminTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <nav className="border-b">
      <div className="container max-w-6xl overflow-x-auto px-4">
        <ul className="flex flex-nowrap gap-1 py-1">
          {TABS.map((t) => {
            const active = pathname === t.to
            return (
              <li key={t.to}>
                <Link
                  to={t.to as never}
                  className={cn(
                    "block rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {t.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </nav>
  )
}
