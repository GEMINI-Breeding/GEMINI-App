/**
 * NavSidebar — vertical navigation sidebar matching the WidgetToolbox aesthetic.
 *
 * Supports optional group headers (like WidgetToolbox categories).
 * Two modes:
 *   collapsed  w-10   icons only, tooltips on hover
 *   normal     w-44   icon + label, group headers visible
 *
 * Usage:
 *   <NavSidebar
 *     groups={[
 *       { label: "Table", items: [{ id, label, icon }, ...] },
 *       { items: [{ id, label, icon }, ...] },
 *     ]}
 *     activeId={id}
 *     onSelect={setId}
 *   />
 */

import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { LucideIcon } from "lucide-react"

export interface NavItem {
  id: string
  label: string
  icon: LucideIcon
}

export interface NavGroup {
  /** Optional section header shown above items (hidden when collapsed) */
  label?: string
  items: readonly NavItem[]
}

interface NavSidebarProps {
  groups: readonly NavGroup[]
  activeId: string
  onSelect: (id: string) => void
}

export function NavSidebar({ groups, activeId, onSelect }: NavSidebarProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={`${collapsed ? "w-10" : "w-44"} bg-card border-r border-border flex flex-col flex-shrink-0 transition-[width] duration-200 z-10`}
    >
      {/* Toggle */}
      <div className={`h-10 border-b border-border flex items-center flex-shrink-0 ${collapsed ? "justify-center" : "justify-end px-2"}`}>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed
            ? <ChevronRight className="w-3.5 h-3.5" />
            : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Groups */}
      <nav className={`flex-1 overflow-y-auto ${collapsed ? "p-1" : "p-2"} space-y-3`}>
        {groups.map((group, gi) => (
          <div key={gi}>
            {/* Group label (hidden when collapsed) */}
            {!collapsed && group.label && (
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">
                {group.label}
              </p>
            )}
            {/* Separator between groups in collapsed mode */}
            {collapsed && gi > 0 && (
              <div className="h-px bg-border/50 my-1 mx-1" />
            )}

            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const isActive = item.id === activeId

                const btn = (
                  <button
                    key={item.id}
                    onClick={() => onSelect(item.id)}
                    data-onboarding={`files-tab-${item.id}`}
                    className={`w-full flex items-center gap-2 rounded-md select-none transition-colors
                      ${collapsed ? "justify-center p-1.5" : "px-2 py-1.5"}
                      ${isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {!collapsed && (
                      <span className="text-sm font-medium truncate">{item.label}</span>
                    )}
                  </button>
                )

                if (collapsed) {
                  return (
                    <Tooltip key={item.id}>
                      <TooltipTrigger asChild>{btn}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  )
                }

                return btn
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )
}
