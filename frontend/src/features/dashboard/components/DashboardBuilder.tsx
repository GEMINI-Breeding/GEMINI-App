/**
 * DashboardBuilder — top-level layout for the Home page Dashboard.
 *
 * Layout:
 *   ┌──────────┬───────────────────────────────────────────────┐
 *   │ Toolbox  │  Header (tab bar + actions)                   │
 *   │ sidebar  ├───────────────────────────────────────────────┤
 *   │          │  Canvas (drop zone + 12-col widget grid)      │
 *   └──────────┴───────────────────────────────────────────────┘
 */

import { useCallback, useState } from "react"
import { Plus, X, RefreshCw } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { useTraitRecords } from "../hooks/useTraitData"
import { useDrag } from "../hooks/useDrag"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { WidgetToolbox, WIDGET_TEMPLATES } from "./WidgetToolbox"
import { DashboardCanvas } from "./DashboardCanvas"
import { DragGhost } from "./DragGhost"
import { WidgetConfigDialog } from "./WidgetConfigDialog"
import { useDashboardStore } from "../store"
import type { DashboardWidget } from "../types"

// ── Tab bar ───────────────────────────────────────────────────────────────────

interface TabBarProps {
  tabs: { id: string; name: string }[]
  activeTabId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onRename: (id: string) => void
  onDelete: (id: string) => void
}

function TabBar({ tabs, activeTabId, onSelect, onAdd, onRename, onDelete }: TabBarProps) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      {tabs.map((tab) => (
        <div key={tab.id} className="relative group/tab flex-shrink-0">
          <button
            onClick={() => onSelect(tab.id)}
            onDoubleClick={() => onRename(tab.id)}
            title="Double-click to rename"
            className={`px-3 py-1 text-xs font-medium rounded-t border-b-2 transition-colors ${
              activeTabId === tab.id
                ? "border-primary text-primary bg-primary/5"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            {tab.name}
          </button>
          {tabs.length > 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(tab.id) }}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-muted text-muted-foreground hover:bg-destructive hover:text-destructive-foreground items-center justify-center opacity-0 group-hover/tab:opacity-100 transition-opacity hidden group-hover/tab:flex"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      ))}
      <button
        onClick={onAdd}
        className="p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded transition-colors ml-1 flex-shrink-0"
        title="Add tab"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ── Rename dialog ─────────────────────────────────────────────────────────────

function RenameDialog({
  open,
  initial,
  onConfirm,
  onCancel,
}: {
  open: boolean
  initial: string
  onConfirm: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial)

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-sm">Rename Tab</DialogTitle>
        </DialogHeader>
        <Input
          className="h-8 text-xs"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onConfirm(name) }}
          autoFocus
        />
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={() => onConfirm(name)}>Rename</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Add tab dialog ─────────────────────────────────────────────────────────────

function AddTabDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean
  onConfirm: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState("New Tab")

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-sm">Add Tab</DialogTitle>
        </DialogHeader>
        <Input
          className="h-8 text-xs"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onConfirm(name) }}
          autoFocus
        />
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" onClick={() => onConfirm(name)}>Add</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function DashboardBuilder() {
  const store = useDashboardStore()
  const queryClient = useQueryClient()
  const { isFetching: isSyncing } = useTraitRecords()

  const [renameTabId, setRenameTabId] = useState<string | null>(null)
  const [addTabOpen, setAddTabOpen] = useState(false)
  const [pendingConfigWidget, setPendingConfigWidget] = useState<DashboardWidget | null>(null)

  // ── Pointer-based drag (replaces HTML5 DnD which Tauri WebKit drops) ─────────

  function handleDrop(templateId: string) {
    console.log(`[DashboardBuilder] handleDrop templateId: ${templateId} | activeTab: ${store.activeTab.id}`)
    const template = WIDGET_TEMPLATES.find((t) => t.templateId === templateId)
    if (!template) {
      console.warn("[DashboardBuilder] no template found for id:", templateId)
      return
    }

    const instanceId = `widget-${Date.now()}`
    const newWidget = {
      instanceId,
      type: template.type,
      title: template.name,
      span: template.defaultSpan,
      config: { ...template.defaultConfig },
    } as DashboardWidget

    store.addWidget(store.activeTab.id, newWidget)
    setPendingConfigWidget(newWidget)
  }

  const drag = useDrag(handleDrop)

  // ── Widget updates ────────────────────────────────────────────────────────────

  const handleUpdateWidget = useCallback(
    (instanceId: string, updated: DashboardWidget) => {
      store.updateWidget(store.activeTab.id, instanceId, updated)
    },
    [store]
  )

  const handleRemoveWidget = useCallback(
    (instanceId: string) => {
      store.removeWidget(store.activeTab.id, instanceId)
    },
    [store]
  )

  const handleReorderWidget = useCallback(
    (instanceId: string, direction: "left" | "right") => {
      store.reorderWidget(store.activeTab.id, instanceId, direction)
    },
    [store]
  )

  // ── Sync ─────────────────────────────────────────────────────────────────────

  function handleSync() {
    queryClient.invalidateQueries({ queryKey: ["trait-records"] })
    queryClient.invalidateQueries({ queryKey: ["trait-record-geojson"] })
  }

  // ── Tab rename ─────────────────────────────────────────────────────────────

  const renamingTab = store.state.tabs.find((t) => t.id === renameTabId)

  return (
    // Layout now removes padding/max-width for the home route, so we just fill the space.
    <div className="flex flex-1 overflow-hidden min-h-0">
      {/* Left sidebar */}
      <WidgetToolbox
        onDragStart={drag.start}
        draggingTemplateId={drag.draggingId}
      />

      {/* Right side */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="bg-card border-b border-border flex-shrink-0">
          {/* Top bar — h-16 matches the sticky app header and toolbox header */}
          <div className="h-16 px-4 flex items-center justify-between border-b border-border">
            <span className="text-xl font-semibold">Dashboard</span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={handleSync}
                title="Force refresh all data"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="h-9 px-4 flex items-center bg-muted/30">
            <TabBar
              tabs={store.state.tabs}
              activeTabId={store.state.activeTabId}
              onSelect={store.setActiveTab}
              onAdd={() => setAddTabOpen(true)}
              onRename={(id) => setRenameTabId(id)}
              onDelete={(id) => store.deleteTab(id)}
            />
          </div>
        </div>

        {/* Canvas — receives ref for bounds detection */}
        <DashboardCanvas
          ref={drag.canvasRef}
          tab={store.activeTab}
          draggingTemplateId={drag.draggingId}
          isOver={drag.isOverCanvas}
          onUpdateWidget={handleUpdateWidget}
          onRemoveWidget={handleRemoveWidget}
          onReorderWidget={handleReorderWidget}
        />
      </div>

      {/* Floating ghost that follows the cursor while dragging */}
      {drag.isDragging && drag.draggingId && (
        <DragGhost templateId={drag.draggingId} pos={drag.pos} isOverCanvas={drag.isOverCanvas} />
      )}

      {/* Pending config dialog (auto-opens after drop) */}
      {pendingConfigWidget && (
        <WidgetConfigDialog
          widget={pendingConfigWidget}
          open={true}
          onClose={() => setPendingConfigWidget(null)}
          onSave={(updated) => {
            store.updateWidget(store.activeTab.id, updated.instanceId, updated)
            setPendingConfigWidget(null)
          }}
        />
      )}

      {/* Rename dialog */}
      {renameTabId && renamingTab && (
        <RenameDialog
          open={true}
          initial={renamingTab.name}
          onConfirm={(name) => {
            store.renameTab(renameTabId, name.trim() || renamingTab.name)
            setRenameTabId(null)
          }}
          onCancel={() => setRenameTabId(null)}
        />
      )}

      {/* Add tab dialog */}
      {addTabOpen && (
        <AddTabDialog
          open={true}
          onConfirm={(name) => {
            store.addTab(name.trim() || "New Tab")
            setAddTabOpen(false)
          }}
          onCancel={() => setAddTabOpen(false)}
        />
      )}
    </div>
  )
}
