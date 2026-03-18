import { Plus, FolderOpen, MoreVertical, Trash2, RefreshCw, Layers, Pencil } from "lucide-react"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
import { WorkspacesService, type WorkspacePublic } from "@/client"
import useCustomToast from "@/hooks/useCustomToast"

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? import.meta.env.VITE_API_URL ?? ""
  return base ? `${base}${path}` : path
}

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("access_token") || ""}` }
}

interface WorkspaceStats {
  aerial: number
  ground: number
}

interface CardImage {
  url: string
  type: "aerial" | "ground"
}

// ── Per-card image strip ───────────────────────────────────────────────────

function WorkspaceCardImages({ workspaceId }: { workspaceId: string }) {
  const { data: images = [] } = useQuery<CardImage[]>({
    queryKey: ["workspace-card-images", workspaceId],
    queryFn: () =>
      fetch(apiUrl(`/api/v1/workspaces/${workspaceId}/card-images`), {
        headers: authHeaders(),
      }).then((r) => r.json()),
    staleTime: 5 * 60_000,
  })

  if (images.length === 0) {
    return (
      <div className="h-28 w-full rounded-t-lg bg-muted flex items-center justify-center">
        <Layers className="h-8 w-8 text-muted-foreground/30" />
      </div>
    )
  }

  return (
    <div className="h-28 w-full rounded-t-lg overflow-hidden flex">
      {images.map((img, i) => (
        <img
          key={i}
          src={apiUrl(img.url)}
          alt={`${img.type} preview`}
          className="h-full flex-1 object-cover"
          style={{ width: `${100 / images.length}%` }}
          draggable={false}
        />
      ))}
    </div>
  )
}

// ── Workspace card ─────────────────────────────────────────────────────────

function WorkspaceCard({
  workspace,
  stats,
  onDelete,
  onEdit,
}: {
  workspace: WorkspacePublic
  stats: WorkspaceStats | undefined
  onDelete: (ws: WorkspacePublic) => void
  onEdit: (ws: WorkspacePublic) => void
}) {
  const navigate = useNavigate()

  return (
    <div
      className="relative rounded-lg border bg-card cursor-pointer transition-all hover:border-primary/60 hover:shadow-md group overflow-hidden flex flex-col"
      onClick={() =>
        navigate({ to: "/process/$workspaceId", params: { workspaceId: workspace.id } })
      }
    >
      {/* Image strip */}
      <WorkspaceCardImages workspaceId={workspace.id} />

      {/* Three-dot menu — over the image */}
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
            <DropdownMenuItem className="text-red-600" onClick={() => onDelete(workspace)}>
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col gap-1.5 flex-1">
        <p className="font-medium text-sm leading-tight truncate pr-6">{workspace.name}</p>
        {workspace.description && (
          <p className="text-muted-foreground text-xs truncate">{workspace.description}</p>
        )}

        {/* Pipeline stats */}
        <div className="mt-1 space-y-0.5">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground/70">Aerial Pipeline:</span>{" "}
            {stats ? `${stats.aerial} dataset${stats.aerial !== 1 ? "s" : ""}` : "—"}
          </p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground/70">Ground Pipeline:</span>{" "}
            {stats ? `${stats.ground} dataset${stats.ground !== 1 ? "s" : ""}` : "—"}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export function WorkspaceDashboard() {
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const [newWorkspace, setNewWorkspace] = useState({ name: "", description: "" })

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => WorkspacesService.readAll(),
  })

  const [editWorkspace, setEditWorkspace] = useState<WorkspacePublic | null>(null)
  const [editForm, setEditForm] = useState({ name: "", description: "" })

  const editMutation = useMutation({
    mutationFn: ({ id, name, description }: { id: string; name: string; description: string }) =>
      WorkspacesService.update({ id, requestBody: { name, description } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] })
      setEditWorkspace(null)
    },
    onError: () => showErrorToast("Failed to update workspace"),
  })

  const { data: statsMap = {} } = useQuery<Record<string, WorkspaceStats>>({
    queryKey: ["workspace-stats"],
    queryFn: () =>
      fetch(apiUrl("/api/v1/workspaces/stats"), { headers: authHeaders() }).then((r) => r.json()),
    staleTime: 60_000,
  })

  const workspaces = data?.data ?? []

  const createMutation = useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      WorkspacesService.create({ requestBody: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] })
      queryClient.invalidateQueries({ queryKey: ["workspace-stats"] })
      setNewWorkspace({ name: "", description: "" })
      setOpen(false)
    },
    onError: () => showErrorToast("Failed to create workspace"),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => WorkspacesService.delete({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] })
      queryClient.invalidateQueries({ queryKey: ["workspace-stats"] })
    },
    onError: () => showErrorToast("Failed to delete workspace"),
  })

  const [confirmDelete, setConfirmDelete] = useState<WorkspacePublic | null>(null)

  const handleCreate = () => {
    if (newWorkspace.name.trim()) createMutation.mutate(newWorkspace)
  }

  return (
    <div className="bg-background min-h-screen">
      <div className="mx-auto max-w-5xl p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl">Process</h2>
            <p className="text-muted-foreground text-sm">
              Create and manage your phenotyping projects
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => refetch()}
              disabled={isFetching}
              title="Refresh workspaces"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  New Workspace
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create New Workspace</DialogTitle>
                  <DialogDescription>
                    Create a workspace to organize your phenotyping projects. You can add aerial
                    and ground-based processing pipelines within each workspace.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Workspace Name</Label>
                    <Input
                      id="name"
                      placeholder="e.g., Corn Field Study 2026"
                      value={newWorkspace.name}
                      onChange={(e) => setNewWorkspace({ ...newWorkspace, name: e.target.value })}
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
                        setNewWorkspace({ ...newWorkspace, description: e.target.value })
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
                    disabled={!newWorkspace.name.trim() || createMutation.isPending}
                  >
                    Create Workspace
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {isLoading ? (
          <div className="text-muted-foreground text-sm">Loading workspaces…</div>
        ) : workspaces.length === 0 ? (
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
                stats={statsMap[workspace.id]}
                onDelete={setConfirmDelete}
                onEdit={(ws) => {
                  setEditWorkspace(ws)
                  setEditForm({ name: ws.name, description: ws.description ?? "" })
                }}
              />
            ))}
          </div>
        )}

        {/* Edit dialog */}
        <Dialog open={!!editWorkspace} onOpenChange={(v) => !v && setEditWorkspace(null)}>
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
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  onKeyDown={(e) =>
                    e.key === "Enter" &&
                    editForm.name.trim() &&
                    editMutation.mutate({ id: editWorkspace!.id, ...editForm })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description</Label>
                <Input
                  id="edit-description"
                  placeholder="Brief description of your project"
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditWorkspace(null)}>
                Cancel
              </Button>
              <Button
                disabled={!editForm.name.trim() || editMutation.isPending}
                onClick={() =>
                  editMutation.mutate({ id: editWorkspace!.id, ...editForm })
                }
              >
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Workspace</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete <strong>{confirmDelete?.name}</strong>? This will
                permanently remove the workspace and all its pipelines and runs.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (confirmDelete)
                    deleteMutation.mutate(confirmDelete.id, {
                      onSuccess: () => setConfirmDelete(null),
                    })
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
