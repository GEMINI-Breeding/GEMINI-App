/**
 * WorkspaceDashboard — Process feature landing page.
 *
 * Mirrors `main`'s wizard-style UI: a Workspace is a name + description,
 * with no experiment binding. Experiment / site / population / date /
 * platform / sensor are all picked at run-creation time from an uploaded
 * dataset (see NewRunDialog). Backed by the local runStore.
 *
 * Card thumbnails: previously fetched from `/api/v1/workspaces/{id}/card-images`
 * which doesn't exist on GEMINIbase. For now cards show a placeholder; once
 * a workspace has runs whose scope resolves to raw images, a follow-up can
 * pull first-N from `/api/files/list/{rawImagesPrefix}`.
 */
import { useNavigate } from "@tanstack/react-router"
import {
  FolderOpen,
  Layers,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  createWorkspace,
  deleteWorkspace,
  updateWorkspace,
  usePipelines,
  useWorkspaceRuns,
  useWorkspaces,
  type Workspace,
} from "@/features/process/lib/runStore"

interface WorkspaceStats {
  aerial: number
  ground: number
}

function useWorkspaceStats(workspaceId: string): WorkspaceStats {
  // Match main's per-workspace "dataset" count semantics: number of
  // *runs* per pipeline type, not number of pipelines.
  const pipelines = usePipelines(workspaceId)
  const runs = useWorkspaceRuns(workspaceId)
  const aerialPipelineIds = new Set(
    pipelines.filter((p) => p.type === "aerial").map((p) => p.id),
  )
  const groundPipelineIds = new Set(
    pipelines.filter((p) => p.type === "ground").map((p) => p.id),
  )
  return {
    aerial: runs.filter((r) => aerialPipelineIds.has(r.pipelineId)).length,
    ground: runs.filter((r) => groundPipelineIds.has(r.pipelineId)).length,
  }
}

function WorkspaceCard({
  workspace,
  onDelete,
  onEdit,
}: {
  workspace: Workspace
  onDelete: (ws: Workspace) => void
  onEdit: (ws: Workspace) => void
}) {
  const navigate = useNavigate()
  const stats = useWorkspaceStats(workspace.id)

  return (
    <div
      className="relative rounded-lg border bg-card cursor-pointer transition-all hover:border-primary/60 hover:shadow-md group overflow-hidden flex flex-col"
      onClick={() =>
        navigate({
          to: "/process/$workspaceId",
          params: { workspaceId: workspace.id },
        })
      }
    >
      <div className="h-28 w-full rounded-t-lg bg-muted flex items-center justify-center">
        <Layers className="h-8 w-8 text-muted-foreground/30" />
      </div>

      <div className="absolute top-2 right-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 bg-black/30 hover:bg-black/50 text-white"
            >
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onClick={() => onEdit(workspace)}>
              <Pencil className="w-4 h-4 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-red-600"
              onClick={() => onDelete(workspace)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="p-4 flex flex-col gap-1.5 flex-1">
        <p className="font-medium text-sm leading-tight truncate pr-6">
          {workspace.name}
        </p>
        {workspace.description && (
          <p className="text-muted-foreground text-xs truncate">
            {workspace.description}
          </p>
        )}
        <div className="mt-1 space-y-0.5">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground/70">
              Aerial Pipeline:
            </span>{" "}
            {stats.aerial} dataset{stats.aerial !== 1 ? "s" : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground/70">
              Ground Pipeline:
            </span>{" "}
            {stats.ground} dataset{stats.ground !== 1 ? "s" : ""}
          </p>
        </div>
      </div>
    </div>
  )
}

export function WorkspaceDashboard() {
  const workspaces = useWorkspaces()

  const [open, setOpen] = useState(false)
  const [newWorkspace, setNewWorkspace] = useState({
    name: "",
    description: "",
  })
  const [editWorkspace, setEditWorkspace] = useState<Workspace | null>(null)
  const [editForm, setEditForm] = useState({ name: "", description: "" })
  const [confirmDelete, setConfirmDelete] = useState<Workspace | null>(null)

  const handleCreate = () => {
    if (!newWorkspace.name.trim()) return
    createWorkspace({
      name: newWorkspace.name.trim(),
      description: newWorkspace.description.trim() || undefined,
    })
    setNewWorkspace({ name: "", description: "" })
    setOpen(false)
  }

  const handleEdit = () => {
    if (!editWorkspace || !editForm.name.trim()) return
    updateWorkspace(editWorkspace.id, {
      name: editForm.name.trim(),
      description: editForm.description.trim() || undefined,
    })
    setEditWorkspace(null)
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 64px)" }}>
      <div className="flex-shrink-0 px-6 pt-5 pb-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Process</h1>
            <p className="text-muted-foreground text-sm">
              Create and manage your phenotyping projects
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button data-onboarding="process-new-workspace">
                  <Plus className="mr-2 h-4 w-4" />
                  New Workspace
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Workspace</DialogTitle>
                  <DialogDescription>
                    Create a workspace to organize your phenotyping projects.
                    You can add aerial and ground processing pipelines inside
                    each workspace.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Workspace Name</Label>
                    <Input
                      id="name"
                      placeholder="e.g., Corn Field Study 2026"
                      value={newWorkspace.name}
                      onChange={(e) =>
                        setNewWorkspace({
                          ...newWorkspace,
                          name: e.target.value,
                        })
                      }
                      onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Input
                      id="description"
                      placeholder="Brief description of your project"
                      value={newWorkspace.description}
                      onChange={(e) =>
                        setNewWorkspace({
                          ...newWorkspace,
                          description: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreate}
                    disabled={!newWorkspace.name.trim()}
                  >
                    Create Workspace
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
        {workspaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
            <FolderOpen className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">
              No workspaces yet. Create one to get started.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((workspace) => (
              <WorkspaceCard
                key={workspace.id}
                workspace={workspace}
                onDelete={setConfirmDelete}
                onEdit={(ws) => {
                  setEditWorkspace(ws)
                  setEditForm({
                    name: ws.name,
                    description: ws.description ?? "",
                  })
                }}
              />
            ))}
          </div>
        )}

        <Dialog
          open={!!editWorkspace}
          onOpenChange={(v) => !v && setEditWorkspace(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Workspace</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Workspace Name</Label>
                <Input
                  id="edit-name"
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm({ ...editForm, name: e.target.value })
                  }
                  onKeyDown={(e) =>
                    e.key === "Enter" && editForm.name.trim() && handleEdit()
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description</Label>
                <Input
                  id="edit-description"
                  placeholder="Brief description of your project"
                  value={editForm.description}
                  onChange={(e) =>
                    setEditForm({ ...editForm, description: e.target.value })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditWorkspace(null)}>
                Cancel
              </Button>
              <Button disabled={!editForm.name.trim()} onClick={handleEdit}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={!!confirmDelete}
          onOpenChange={(v) => !v && setConfirmDelete(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Workspace</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete{" "}
                <strong>{confirmDelete?.name}</strong>? This will permanently
                remove the workspace and all its pipelines and runs.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (confirmDelete) {
                    deleteWorkspace(confirmDelete.id)
                    setConfirmDelete(null)
                  }
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
