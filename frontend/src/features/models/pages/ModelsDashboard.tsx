/**
 * ModelsDashboard — list / create / edit / delete Roboflow model registrations.
 *
 * Each row stores Roboflow auth in `model_info.roboflow_model_id` and the
 * task type. The actual API key lives on the user (UserSettings → Roboflow);
 * keeping it off the Model row means a model registry can be shared without
 * leaking credentials.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Edit, Plus, Star, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"

import { type ModelInput, type ModelOutput } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import {
  modelInfo,
  useCreateModel,
  useDeleteModel,
  useModels,
  useUpdateModel,
  type ModelInfo,
} from "@/features/models/hooks/useModels"
import useCustomToast from "@/hooks/useCustomToast"

const TASK_TYPES = [
  "object-detection",
  "instance-segmentation",
  "classification",
  "semantic-segmentation",
] as const

type FormState = {
  model_name: string
  model_url: string
  roboflow_model_id: string
  task_type: string
  description: string
}

const EMPTY_FORM: FormState = {
  model_name: "",
  model_url: "",
  roboflow_model_id: "",
  task_type: "object-detection",
  description: "",
}

function buildModelInput(form: FormState): ModelInput {
  const info: ModelInfo = {
    roboflow_model_id: form.roboflow_model_id || undefined,
    task_type: form.task_type || undefined,
    description: form.description || undefined,
  }
  return {
    model_name: form.model_name,
    model_url: form.model_url || undefined,
    model_info: info as ModelInput["model_info"],
  }
}

function rowToForm(row: ModelOutput): FormState {
  const info = modelInfo(row)
  return {
    model_name: row.model_name ?? "",
    model_url: row.model_url ?? "",
    roboflow_model_id: info.roboflow_model_id ?? "",
    task_type: info.task_type ?? "object-detection",
    description: info.description ?? "",
  }
}

export function ModelsDashboard() {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const qc = useQueryClient()
  const list = useModels()
  const createModel = useCreateModel()
  const updateModel = useUpdateModel()
  const deleteModel = useDeleteModel()

  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editing, setEditing] = useState<ModelOutput | null>(null)
  const [deleting, setDeleting] = useState<ModelOutput | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const promoteBest = useMutation<unknown, Error, ModelOutput>({
    mutationFn: async (row) => {
      const info = modelInfo(row)
      // Toggle: if already best, clear; otherwise mark.
      const next: ModelInfo = { ...info, best_model_path: info.best_model_path ? undefined : (row.model_url ?? row.model_name ?? undefined) }
      return updateModel.mutateAsync({
        modelId: String(row.id ?? ""),
        data: { model_info: next as ModelInput["model_info"] },
      })
    },
    onSuccess: () => {
      showSuccessToast("Model updated")
      qc.invalidateQueries({ queryKey: ["models"] })
    },
    onError: (err) => showErrorToast(err.message),
  })

  const rows = useMemo(() => list.data ?? [], [list.data])

  function openAdd() {
    setForm(EMPTY_FORM)
    setIsAddOpen(true)
  }

  function openEdit(row: ModelOutput) {
    setForm(rowToForm(row))
    setEditing(row)
  }

  async function handleCreate() {
    if (!form.model_name) {
      showErrorToast("Model name is required")
      return
    }
    try {
      await createModel.mutateAsync(buildModelInput(form))
      showSuccessToast("Model created")
      setIsAddOpen(false)
      setForm(EMPTY_FORM)
    } catch (err) {
      showErrorToast((err as Error).message)
    }
  }

  async function handleUpdate() {
    if (!editing) return
    try {
      await updateModel.mutateAsync({
        modelId: String(editing.id ?? ""),
        data: buildModelInput(form),
      })
      showSuccessToast("Model updated")
      setEditing(null)
    } catch (err) {
      showErrorToast((err as Error).message)
    }
  }

  async function handleDelete() {
    if (!deleting) return
    try {
      await deleteModel.mutateAsync(String(deleting.id ?? ""))
      showSuccessToast("Model deleted")
      setDeleting(null)
    } catch (err) {
      showErrorToast((err as Error).message)
    }
  }

  return (
    <div className="container max-w-6xl space-y-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Models</h1>
          <p className="text-muted-foreground text-sm">
            Roboflow models registered for plant-locating + trait inference.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/models/train">Train new</Link>
          </Button>
          <Button data-testid="model-add" onClick={openAdd}>
            <Plus className="mr-1.5 h-4 w-4" /> Add model
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Registered models</CardTitle>
          <CardDescription>
            The "best" badge indicates the model that LOCATE_PLANTS / EXTRACT_TRAITS
            jobs will pick by default.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Roboflow model id</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground text-sm">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground text-sm">
                      No models yet. Add one to get started.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => {
                    const info = modelInfo(row)
                    const isBest = Boolean(info.best_model_path)
                    return (
                      <TableRow key={String(row.id)} data-testid="model-row">
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{row.model_name}</span>
                            {isBest && (
                              <Badge variant="secondary" className="gap-1">
                                <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                                best
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {info.roboflow_model_id ?? "—"}
                        </TableCell>
                        <TableCell>{info.task_type ?? "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                          {row.model_url ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              data-testid="model-promote"
                              title={isBest ? "Unmark as best" : "Mark as best"}
                              onClick={() => promoteBest.mutate(row)}
                            >
                              <Star className={`h-4 w-4 ${isBest ? "fill-amber-500 text-amber-500" : ""}`} />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              data-testid="model-edit"
                              onClick={() => openEdit(row)}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              data-testid="model-delete"
                              onClick={() => setDeleting(row)}
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add model</DialogTitle>
            <DialogDescription>
              Register a Roboflow model so it can be invoked from the Inference tool.
            </DialogDescription>
          </DialogHeader>
          <ModelFormBody form={form} setForm={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
            <Button
              data-testid="model-add-save"
              onClick={handleCreate}
              disabled={createModel.isPending}
            >
              {createModel.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit model</DialogTitle>
          </DialogHeader>
          <ModelFormBody form={form} setForm={setForm} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              data-testid="model-edit-save"
              onClick={handleUpdate}
              disabled={updateModel.isPending}
            >
              {updateModel.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete model?</DialogTitle>
            <DialogDescription>
              This removes <span className="font-medium">{deleting?.model_name}</span> from the registry. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="destructive"
              data-testid="model-delete-confirm"
              onClick={handleDelete}
              disabled={deleteModel.isPending}
            >
              {deleteModel.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ModelFormBody({
  form,
  setForm,
}: {
  form: FormState
  setForm: (next: FormState) => void
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="model_name">Name *</Label>
        <Input
          id="model_name"
          data-testid="model-field-name"
          value={form.model_name}
          onChange={(e) => setForm({ ...form, model_name: e.target.value })}
          placeholder="e.g. Almonds-2024-locate"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="roboflow_model_id">Roboflow model id</Label>
        <Input
          id="roboflow_model_id"
          data-testid="model-field-roboflow-id"
          value={form.roboflow_model_id}
          onChange={(e) => setForm({ ...form, roboflow_model_id: e.target.value })}
          placeholder="workspace/project/version"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="task_type">Task type</Label>
        <Select
          value={form.task_type}
          onValueChange={(v) => setForm({ ...form, task_type: v })}
        >
          <SelectTrigger id="task_type" data-testid="model-field-task-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TASK_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="model_url">Model URL (optional)</Label>
        <Input
          id="model_url"
          data-testid="model-field-url"
          value={form.model_url}
          onChange={(e) => setForm({ ...form, model_url: e.target.value })}
          placeholder="https://detect.roboflow.com/..."
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          data-testid="model-field-description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={3}
        />
      </div>
    </div>
  )
}
