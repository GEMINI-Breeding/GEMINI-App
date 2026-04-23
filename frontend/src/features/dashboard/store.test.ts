import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { useDashboardStore } from "./store"
import type { ChartWidgetDef, KpiWidgetDef } from "./types"

function kpiWidget(instanceId: string, title = "KPI"): KpiWidgetDef {
  return {
    instanceId,
    title,
    span: "sm",
    type: "kpi",
    config: {
      traitRecordId: null,
      metric: null,
      aggregation: "avg",
      compareRecordId: null,
      filters: {},
    },
  }
}

function chartWidget(instanceId: string): ChartWidgetDef {
  return {
    instanceId,
    title: "Chart",
    span: "md",
    type: "chart",
    config: {
      mode: "spatial",
      chartType: "bar",
      traitRecordId: null,
      xAxis: null,
      yAxis: null,
      yAxes: [],
      dualAxis: false,
      yAxesAggregation: {},
      showErrorBand: false,
      errorBandType: "std",
      groupBy: null,
      pipelineId: null,
      temporalRecordIds: [],
      filters: {},
      sources: [],
    },
  }
}

describe("useDashboardStore", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it("starts with a single default tab when localStorage is empty", () => {
    const { result } = renderHook(() => useDashboardStore())
    expect(result.current.state.tabs).toHaveLength(1)
    expect(result.current.activeTab.id).toBe("tab-default")
    expect(result.current.activeTab.widgets).toEqual([])
  })

  it("loads previously saved state from localStorage", () => {
    localStorage.setItem(
      "gemini-dashboard",
      JSON.stringify({
        tabs: [
          { id: "t1", name: "Saved", widgets: [kpiWidget("w1")] },
        ],
        activeTabId: "t1",
      }),
    )
    const { result } = renderHook(() => useDashboardStore())
    expect(result.current.state.tabs).toHaveLength(1)
    expect(result.current.activeTab.name).toBe("Saved")
    expect(result.current.activeTab.widgets[0].instanceId).toBe("w1")
  })

  it("falls back to default state when the saved JSON is corrupted", () => {
    localStorage.setItem("gemini-dashboard", "{not json")
    const { result } = renderHook(() => useDashboardStore())
    expect(result.current.activeTab.id).toBe("tab-default")
  })

  it("migrateWidget backfills the chart sources/barLayout/groupByField fields", () => {
    localStorage.setItem(
      "gemini-dashboard",
      JSON.stringify({
        tabs: [
          {
            id: "t1",
            name: "X",
            widgets: [
              {
                instanceId: "w1",
                title: "Chart",
                span: "md",
                type: "chart",
                // Intentionally missing sources / barLayout / groupByField
                config: { mode: "spatial" },
              },
            ],
          },
        ],
        activeTabId: "t1",
      }),
    )
    const { result } = renderHook(() => useDashboardStore())
    const w = result.current.activeTab.widgets[0] as ChartWidgetDef
    expect(w.config.sources).toEqual([])
    expect(w.config.barLayout).toBe("grouped")
    expect(w.config.groupByField).toBeNull()
  })

  it("addTab creates and activates a new tab", () => {
    const { result } = renderHook(() => useDashboardStore())
    act(() => result.current.addTab("Analysis"))
    expect(result.current.state.tabs).toHaveLength(2)
    expect(result.current.activeTab.name).toBe("Analysis")
  })

  it("renameTab updates only the target tab", () => {
    const { result } = renderHook(() => useDashboardStore())
    act(() => result.current.addTab("Analysis"))
    const newId = result.current.activeTab.id
    act(() => result.current.renameTab(newId, "Renamed"))
    expect(result.current.state.tabs.find((t) => t.id === newId)?.name).toBe("Renamed")
  })

  it("deleteTab drops the tab and falls back to the first remaining one", () => {
    const { result } = renderHook(() => useDashboardStore())
    act(() => result.current.addTab("Analysis"))
    const analysisId = result.current.activeTab.id
    act(() => result.current.deleteTab("tab-default"))
    expect(result.current.state.tabs).toHaveLength(1)
    expect(result.current.activeTab.id).toBe(analysisId)
  })

  it("deleteTab refuses to remove the last remaining tab", () => {
    const { result } = renderHook(() => useDashboardStore())
    act(() => result.current.deleteTab("tab-default"))
    expect(result.current.state.tabs).toHaveLength(1)
  })

  it("setActiveTab switches which tab is surfaced via activeTab", () => {
    const { result } = renderHook(() => useDashboardStore())
    act(() => result.current.addTab("Analysis"))
    act(() => result.current.setActiveTab("tab-default"))
    expect(result.current.activeTab.id).toBe("tab-default")
  })

  it("addWidget appends to the named tab", () => {
    const { result } = renderHook(() => useDashboardStore())
    act(() => result.current.addWidget("tab-default", kpiWidget("w1")))
    act(() => result.current.addWidget("tab-default", chartWidget("w2")))
    expect(result.current.activeTab.widgets.map((w) => w.instanceId)).toEqual([
      "w1",
      "w2",
    ])
  })

  it("updateWidget applies the patch to the matching widget", () => {
    const { result } = renderHook(() => useDashboardStore())
    act(() => result.current.addWidget("tab-default", kpiWidget("w1")))
    act(() =>
      result.current.updateWidget("tab-default", "w1", { title: "Renamed" }),
    )
    expect(result.current.activeTab.widgets[0].title).toBe("Renamed")
  })

  it("removeWidget drops only the targeted widget", () => {
    const { result } = renderHook(() => useDashboardStore())
    act(() => result.current.addWidget("tab-default", kpiWidget("w1")))
    act(() => result.current.addWidget("tab-default", kpiWidget("w2")))
    act(() => result.current.removeWidget("tab-default", "w1"))
    expect(result.current.activeTab.widgets.map((w) => w.instanceId)).toEqual(["w2"])
  })

  it("reorderWidget swaps adjacent widgets; ignores out-of-range moves", () => {
    const { result } = renderHook(() => useDashboardStore())
    act(() => result.current.addWidget("tab-default", kpiWidget("a")))
    act(() => result.current.addWidget("tab-default", kpiWidget("b")))
    act(() => result.current.addWidget("tab-default", kpiWidget("c")))

    act(() => result.current.reorderWidget("tab-default", "b", "left"))
    expect(result.current.activeTab.widgets.map((w) => w.instanceId)).toEqual([
      "b",
      "a",
      "c",
    ])

    // 'b' is now at idx 0 — moving it further left is a no-op
    act(() => result.current.reorderWidget("tab-default", "b", "left"))
    expect(result.current.activeTab.widgets[0].instanceId).toBe("b")

    // Unknown instanceId is a no-op
    act(() => result.current.reorderWidget("tab-default", "missing", "right"))
    expect(result.current.activeTab.widgets.map((w) => w.instanceId)).toEqual([
      "b",
      "a",
      "c",
    ])
  })

  it("resizeWidget updates the span only on the matching widget", () => {
    const { result } = renderHook(() => useDashboardStore())
    act(() => result.current.addWidget("tab-default", kpiWidget("w1")))
    act(() => result.current.resizeWidget("tab-default", "w1", "full"))
    expect(result.current.activeTab.widgets[0].span).toBe("full")
  })

  it("resetDashboard wipes tabs back to the default single-tab state", () => {
    const { result } = renderHook(() => useDashboardStore())
    act(() => result.current.addTab("Analysis"))
    act(() => result.current.addWidget("tab-default", kpiWidget("w1")))
    act(() => result.current.resetDashboard())
    expect(result.current.state.tabs).toHaveLength(1)
    expect(result.current.activeTab.id).toBe("tab-default")
    expect(result.current.activeTab.widgets).toEqual([])
  })

  it("persists every mutation back to localStorage", () => {
    const { result } = renderHook(() => useDashboardStore())
    act(() => result.current.addTab("Analysis"))
    const stored = JSON.parse(localStorage.getItem("gemini-dashboard")!)
    expect(stored.tabs).toHaveLength(2)
  })
})
