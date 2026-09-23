/**
 * EditUploadDialog — fix an upload's season, site, population, date,
 * platform or sensor (main's "edit metadata").
 *
 * Here those fields are the upload's storage path, so saving moves the
 * upload's folder (POST /api/datasets/id/{id}/move): nothing at the new
 * location is overwritten, and outputs already built from the old scope
 * (orthomosaics, stitches, traits) stay where they are — the dialog says
 * so when there are any.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { authHeaders } from "@/components/Common/PlotImage"
import { Button } from "@/components/ui/button"
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
import { apiUrl } from "@/features/files/lib/download"
import useCustomToast from "@/hooks/useCustomToast"

const FIELDS = [
  ["season", "Season"],
  ["site", "Site"],
  ["population", "Population"],
  ["date", "Date"],
  ["platform", "Platform"],
  ["sensor", "Sensor"],
] as const
type Field = (typeof FIELDS)[number][0]
type Scope = Record<Field, string>

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok)
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
  return body as T
}

export function EditUploadDialog({
  datasetId,
  datasetName,
  experimentId,
  open,
  onClose,
}: {
  datasetId: string
  datasetName: string
  experimentId: string | null
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToastWithCopy } = useCustomToast()
  const location = useQuery({
    queryKey: ["datasets", datasetId, "location"],
    queryFn: () =>
      call<{ folder: string; scope: Scope }>(
        `/api/datasets/id/${datasetId}/location`,
      ),
    enabled: open,
    retry: false,
  })
  const [form, setForm] = useState<Scope | null>(null)
  useEffect(() => {
    if (open && location.data) setForm(location.data.scope)
  }, [open, location.data])
  const [leftBehind, setLeftBehind] = useState<string[]>([])

  const move = useMutation({
    mutationFn: (to: Scope) =>
      call<{ moved: number; processed_outputs_left: string[] }>(
        `/api/datasets/id/${datasetId}/move`,
        { method: "POST", body: JSON.stringify(to) },
      ),
    onSuccess: (res) => {
      if (experimentId) {
        for (const k of ["datasets", "files"])
          queryClient.invalidateQueries({
            queryKey: ["experiments", experimentId, k],
          })
      }
      queryClient.invalidateQueries({ queryKey: ["datasets", datasetId] })
      queryClient.invalidateQueries({ queryKey: ["files"] })
      showSuccessToast(`Moved ${res.moved} file${res.moved === 1 ? "" : "s"}`)
      if (res.processed_outputs_left.length)
        setLeftBehind(res.processed_outputs_left)
      else onClose()
    },
    onError: (e) =>
      showErrorToastWithCopy(e instanceof Error ? e.message : "Move failed"),
  })

  const unchanged =
    !form ||
    !location.data ||
    FIELDS.every(([k]) => form[k] === location.data.scope[k])

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setLeftBehind([])
          onClose()
        }
      }}
    >
      <DialogContent className="max-w-md" data-testid="edit-upload-dialog">
        <DialogHeader>
          <DialogTitle>Edit upload</DialogTitle>
          <DialogDescription>
            {datasetName}: these fields are where the files are stored, so
            saving moves them. Nothing at the new location is overwritten.
          </DialogDescription>
        </DialogHeader>

        {leftBehind.length > 0 ? (
          <div
            className="space-y-2 text-sm"
            data-testid="edit-upload-left-behind"
          >
            <p>
              Moved. Results already built from the old location stay there —
              re-run those steps on a new run for this location:
            </p>
            <ul className="text-muted-foreground max-h-40 overflow-auto font-mono text-xs">
              {leftBehind.map((p) => (
                <li key={p}>{p.split("/").slice(-2).join("/")}</li>
              ))}
            </ul>
          </div>
        ) : location.isError ? (
          <p className="text-destructive text-sm">
            {(location.error as Error).message}
          </p>
        ) : !form ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map(([key, label]) => (
              <div key={key} className="space-y-1">
                <Label htmlFor={`edit-upload-${key}`}>{label}</Label>
                <Input
                  id={`edit-upload-${key}`}
                  type={key === "date" ? "date" : "text"}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          {leftBehind.length > 0 ? (
            <Button
              onClick={() => {
                setLeftBehind([])
                onClose()
              }}
            >
              Done
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                data-testid="edit-upload-save"
                disabled={unchanged || move.isPending}
                onClick={() => form && move.mutate(form)}
              >
                {move.isPending ? "Moving…" : "Save"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
