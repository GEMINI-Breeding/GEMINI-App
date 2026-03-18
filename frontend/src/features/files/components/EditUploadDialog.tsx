import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FilesService, type FileUploadPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { dataTypes } from "@/config/dataTypes"
import useCustomToast from "@/hooks/useCustomToast"

interface EditUploadDialogProps {
  upload: FileUploadPublic
  open: boolean
  onClose: () => void
}

export function EditUploadDialog({ upload, open, onClose }: EditUploadDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [form, setForm] = useState({
    experiment: upload.experiment ?? "",
    location: upload.location ?? "",
    population: upload.population ?? "",
    date: upload.date ?? "",
    platform: upload.platform ?? "",
    sensor: upload.sensor ?? "",
  })

  // Reset when upload changes
  useEffect(() => {
    setForm({
      experiment: upload.experiment ?? "",
      location: upload.location ?? "",
      population: upload.population ?? "",
      date: upload.date ?? "",
      platform: upload.platform ?? "",
      sensor: upload.sensor ?? "",
    })
  }, [upload])

  const config = dataTypes[upload.data_type as keyof typeof dataTypes]
  const fields: string[] = config?.fields ?? ["experiment", "location", "population", "date"]

  const saveMutation = useMutation({
    mutationFn: () =>
      FilesService.updateFile({
        id: upload.id,
        requestBody: {
          experiment: form.experiment || undefined,
          location: form.location || undefined,
          population: form.population || undefined,
          date: form.date || undefined,
          platform: form.platform || undefined,
          sensor: form.sensor || undefined,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["files"] })
      showSuccessToast("Upload updated")
      onClose()
    },
    onError: () => showErrorToast("Failed to update upload"),
  })

  function fieldLabel(f: string) {
    return f.charAt(0).toUpperCase() + f.slice(1)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit Upload</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          {fields.map((f) => (
            <div key={f}>
              <Label className="text-xs">{fieldLabel(f)}</Label>
              <Input
                className="mt-0.5 h-8 text-sm"
                value={form[f as keyof typeof form]}
                onChange={(e) => setForm({ ...form, [f]: e.target.value })}
              />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
