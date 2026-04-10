/**
 * Dashboard layout persistence via localStorage.
 *
 * useDashboardStore() returns the full state + a set of actions.
 * State is serialised to JSON on every write and loaded once on mount.
 */

import { useState, useCallback } from "react"
import type { DashboardState, DashboardTab, DashboardWidget, WidgetSpan } from "./types"

const STORAGE_KEY = "gemini-dashboard"

function defaultState(): DashboardState {
  return {
    tabs: [{ id: "tab-default", name: "Overview", widgets: [] }],
    activeTabId: "tab-default",
  }
}

/** Inject missing fields added in later versions so old configs keep working. */
function migrateWidget(w: DashboardWidget): DashboardWidget {
  if (w.type === "chart") {
    return {
      ...w,
      config: {
        ...w.config,
        // Inject missing fields added in later schema versions
        sources: (w.config as any).sources ?? [],
        barLayout: (w.config as any).barLayout ?? "grouped",
        groupByField: (w.config as any).groupByField ?? null,
      },
    }
  }
  return w
}

function migrateState(raw: DashboardState): DashboardState {
  return {
    ...raw,
    tabs: raw.tabs.map((tab) => ({
      ...tab,
      widgets: tab.widgets.map(migrateWidget),
    })),
  }
}

function load(): DashboardState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return migrateState(JSON.parse(raw) as DashboardState)
  } catch {
    // corrupted — reset
  }
  return defaultState()
}

function save(state: DashboardState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // storage quota exceeded — silently ignore
  }
}

export function useDashboardStore() {
  const [state, _setState] = useState<DashboardState>(load)

  const setState = useCallback((updater: (prev: DashboardState) => DashboardState) => {
    _setState((prev) => {
      const next = updater(prev)
      save(next)
      return next
    })
  }, [])

  // ── Tab actions ──────────────────────────────────────────────────────────────

  const addTab = useCallback((name: string) => {
    const id = `tab-${Date.now()}`
    setState((s) => ({
      ...s,
      tabs: [...s.tabs, { id, name, widgets: [] }],
      activeTabId: id,
    }))
  }, [setState])

  const renameTab = useCallback((tabId: string, name: string) => {
    setState((s) => ({
      ...s,
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, name } : t)),
    }))
  }, [setState])

  const deleteTab = useCallback((tabId: string) => {
    setState((s) => {
      const remaining = s.tabs.filter((t) => t.id !== tabId)
      if (remaining.length === 0) return s // always keep at least one
      const nextActive = remaining.find((t) => t.id === s.activeTabId) ?? remaining[0]
      return { tabs: remaining, activeTabId: nextActive.id }
    })
  }, [setState])

  const setActiveTab = useCallback((tabId: string) => {
    setState((s) => ({ ...s, activeTabId: tabId }))
  }, [setState])

  // ── Widget actions ───────────────────────────────────────────────────────────

  const addWidget = useCallback((tabId: string, widget: DashboardWidget) => {
    console.log(`[DashboardStore] addWidget tabId: ${tabId} | widget: ${widget.instanceId} type: ${widget.type}`)
    setState((s) => {
      const next = {
        ...s,
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, widgets: [...t.widgets, widget] } : t
        ),
      }
      console.log(`[DashboardStore] widget count on tab: ${next.tabs.find(t => t.id === tabId)?.widgets.length}`)
      return next
    })
  }, [setState])

  const updateWidget = useCallback((tabId: string, instanceId: string, patch: Partial<DashboardWidget>) => {
    setState((s) => ({
      ...s,
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              widgets: t.widgets.map((w) =>
                w.instanceId === instanceId ? ({ ...w, ...patch } as DashboardWidget) : w
              ),
            }
          : t
      ),
    }))
  }, [setState])

  const removeWidget = useCallback((tabId: string, instanceId: string) => {
    setState((s) => ({
      ...s,
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, widgets: t.widgets.filter((w) => w.instanceId !== instanceId) } : t
      ),
    }))
  }, [setState])

  const reorderWidget = useCallback((tabId: string, instanceId: string, direction: "left" | "right") => {
    setState((s) => ({
      ...s,
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t
        const idx = t.widgets.findIndex((w) => w.instanceId === instanceId)
        if (idx === -1) return t
        const next = [...t.widgets]
        const swap = direction === "left" ? idx - 1 : idx + 1
        if (swap < 0 || swap >= next.length) return t
        ;[next[idx], next[swap]] = [next[swap], next[idx]]
        return { ...t, widgets: next }
      }),
    }))
  }, [setState])

  const resizeWidget = useCallback((tabId: string, instanceId: string, span: WidgetSpan) => {
    setState((s) => ({
      ...s,
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              widgets: t.widgets.map((w) =>
                w.instanceId === instanceId ? { ...w, span } : w
              ),
            }
          : t
      ),
    }))
  }, [setState])

  const resetDashboard = useCallback(() => {
    const fresh = defaultState()
    save(fresh)
    _setState(fresh)
  }, [])

  // ── Derived ──────────────────────────────────────────────────────────────────

  const activeTab: DashboardTab =
    state.tabs.find((t) => t.id === state.activeTabId) ?? state.tabs[0]

  return {
    state,
    activeTab,
    addTab,
    renameTab,
    deleteTab,
    setActiveTab,
    addWidget,
    updateWidget,
    removeWidget,
    reorderWidget,
    resizeWidget,
    resetDashboard,
  }
}
