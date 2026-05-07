/**
 * ImportOrthoDialog — register a user-uploaded orthomosaic as a Run output.
 *
 * Users can upload an existing GeoTIFF via the Files page (data type
 * "Orthomosaic"), which lands at:
 *   `Raw/{year}/{experiment}/{location}/{population}/{date}/{platform}/{sensor}/Orthomosaic/`
 *
 * This dialog lists those TIFs (plus the matching DEM in the
 * `Orthomosaic-DEM/` sibling directory) and lets the user "register" one
 * as the Run's orthomosaic output without running ODM. The registration
 * writes a metadata entry into runStore + flips the orthomosaic step to
 * completed; downstream steps (plot_boundary_prep, trait_extraction)
 * point at the imported file via the same versions array.
 *
 * Note: GEMINIbase has no /pipeline-runs/use-uploaded-ortho endpoint, so
 * we don't *copy* the file into Processed/ — we just register the Raw/
 * path. Downstream workers handle either prefix.
 */

import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { useState } from "react"

import { type FileMetadata, FilesService } from "@/client"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  type OrthoVersionMeta,
  readOrthoOutputs,
} from "@/features/process/lib/orthoVersions"
import type { AerialScope } from "@/features/process/lib/paths"
import { type Run, setStepState } from "@/features/process/lib/runStore"
import useCustomToast from "@/hooks/useCustomToast"
import { isLoggedIn } from "@/lib/auth"

const DEFAULT_BUCKET = "gemini"

function uploadedOrthosPrefix(scope: AerialScope): string {
  const { year, experiment, location, population, date, platform, sensor } =
    scope
  return `Raw/${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/Orthomosaic/`
}

function uploadedDemsPrefix(scope: AerialScope): string {
  const { year, experiment, location, population, date, platform, sensor } =
    scope
  return `Raw/${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/Orthomosaic-DEM/`
}

function tifFilesIn(
  files: FileMetadata[],
): { filename: string; path: string }[] {
  return files
    .map((f) => f.object_name ?? "")
    .filter((n) => /\.tiff?$/i.test(n))
    .map((p) => ({ filename: p.split("/").pop() ?? p, path: p }))
}

export function ImportOrthoDialog({
  open,
  onClose,
  run,
  scope,
}: {
  open: boolean
  onClose: () => void
  run: Run
  scope: AerialScope | null
}) {
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const [selectedOrtho, setSelectedOrtho] = useState<string>("")
  const [selectedDem, setSelectedDem] = useState<string>("")
  const [name, setName] = useState("")

  const orthosQuery = useQuery<FileMetadata[], Error>({
    queryKey: [
      "files",
      "list",
      scope ? uploadedOrthosPrefix(scope) : null,
      "import-orthos",
    ],
    queryFn: async () => {
      if (!scope) return []
      const res = await FilesService.apiFilesListFilePathListFiles({
        filePath: `${DEFAULT_BUCKET}/${uploadedOrthosPrefix(scope)}`,
      })
      return (res as FileMetadata[] | null) ?? []
    },
    enabled: open && isLoggedIn() && Boolean(scope),
  })

  const demsQuery = useQuery<FileMetadata[], Error>({
    queryKey: [
      "files",
      "list",
      scope ? uploadedDemsPrefix(scope) : null,
      "import-dems",
    ],
    queryFn: async () => {
      if (!scope) return []
      const res = await FilesService.apiFilesListFilePathListFiles({
        filePath: `${DEFAULT_BUCKET}/${uploadedDemsPrefix(scope)}`,
      })
      return (res as FileMetadata[] | null) ?? []
    },
    enabled: open && isLoggedIn() && Boolean(scope),
  })

  const orthos = tifFilesIn(orthosQuery.data ?? [])
  const dems = tifFilesIn(demsQuery.data ?? [])

  function handleImport() {
    if (!selectedOrtho) {
      showErrorToast("Pick an orthomosaic file to import")
      return
    }
    if (!scope) return
    const path = `${DEFAULT_BUCKET}/${uploadedOrthosPrefix(scope)}${selectedOrtho}`
    const meta: OrthoVersionMeta[] = [
      ...readOrthoOutputs(run),
      {
        filename: selectedOrtho,
        path,
        label: name.trim() || undefined,
        source: "imported",
        createdAt: new Date().toISOString(),
      },
    ]
    setStepState(run.id, "orthomosaic", {
      status: "completed",
      completedAt: new Date().toISOString(),
      outputs: {
        ...(run.steps.orthomosaic?.outputs ?? {}),
        versions: meta,
        importedDem: selectedDem || undefined,
      },
    })
    showSuccessToast(`Imported ${selectedOrtho}`)
    setSelectedOrtho("")
    setSelectedDem("")
    setName("")
    onClose()
  }

  const isLoading = orthosQuery.isLoading || demsQuery.isLoading

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import existing orthomosaic</DialogTitle>
          <DialogDescription>
            Use a GeoTIFF you've already uploaded to this scope's
            <code className="bg-muted mx-1 rounded px-1 text-xs">
              Orthomosaic/
            </code>
            folder instead of running ODM.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
          </div>
        ) : orthos.length === 0 ? (
          <p className="text-muted-foreground py-4 text-sm">
            No uploaded orthomosaic files found at this scope. Upload one via
            the Files page first (data type "Orthomosaic").
          </p>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="import-ortho-file">Orthomosaic GeoTIFF</Label>
              <Select value={selectedOrtho} onValueChange={setSelectedOrtho}>
                <SelectTrigger
                  id="import-ortho-file"
                  data-testid="import-ortho-file"
                >
                  <SelectValue placeholder="Pick a file" />
                </SelectTrigger>
                <SelectContent>
                  {orthos.map((f) => (
                    <SelectItem key={f.path} value={f.filename}>
                      {f.filename}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="import-dem-file">DEM (optional)</Label>
              <Select value={selectedDem} onValueChange={setSelectedDem}>
                <SelectTrigger
                  id="import-dem-file"
                  data-testid="import-dem-file"
                >
                  <SelectValue
                    placeholder={
                      dems.length === 0
                        ? "No DEMs uploaded for this scope"
                        : "Pick a DEM (optional)"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {dems.map((f) => (
                    <SelectItem key={f.path} value={f.filename}>
                      {f.filename}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="import-name">Display name (optional)</Label>
              <Input
                id="import-name"
                placeholder="e.g. Pix4D 2cm"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={!selectedOrtho || isLoading || orthos.length === 0}
          >
            Register orthomosaic
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
