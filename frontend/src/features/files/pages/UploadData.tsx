import { useCallback, useState } from "react"

import { FilesService, OpenAPI } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getToken } from "@/lib/auth"
import { openUrl } from "@/lib/platform"
import { DataStructureForm, DataTypes, UploadList } from "../components"
import { GeoTiffValidationCard } from "../components/GeoTiffValidationCard"
import { MsgsSyncedUploadDialog } from "../components/MsgsSyncedUploadDialog"
import { ReferenceDataUploadDialog } from "../components/ReferenceDataUploadDialog"

function apiUrl(path: string): string {
  const base = (OpenAPI.BASE ?? "").replace(/\/$/, "")
  return base + path
}

/**
 * Read a MinIO-hosted object back to the browser via the new download
 * endpoint. Used to round-trip CSV / reference uploads so the user can
 * edit them in a follow-up dialog.
 */
async function fetchUploadedContent(
  objectPath: string,
): Promise<{ text: string; blob: Blob } | null> {
  const url = apiUrl(`/api/files/download/${objectPath}`)
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) return null
  const blob = await res.blob()
  const text = await blob.text()
  return { text, blob }
}

export function UploadData() {
  const [selectedFileType, setSelectedFileType] = useState<string | null>(null)
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [rgbTifPath, setRgbTifPath] = useState<string | null>(null)
  const [demTifPath, setDemTifPath] = useState<string | null>(null)
  const [syncedCsvText, setSyncedCsvText] = useState<string | null>(null)
  const [syncedCsvPath, setSyncedCsvPath] = useState<string | null>(null)
  const [dockerErrorMsg, setDockerErrorMsg] = useState<string | null>(null)
  const [refDataFile, setRefDataFile] = useState<File | null>(null)

  const handleFormChange = (field: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [field]: value }))
  }

  /**
   * On first selection try to pull EXIF date/platform/sensor to pre-fill the
   * form. The extractMetadata endpoint is a throwing stub until Phase 12
   * deletes the legacy-shim runtime augmentation — so this call is
   * intentionally `.catch`ed and never blocks the upload.
   */
  const handleFilesSelected = useCallback(async (files: File[]) => {
    const firstName = files[0]?.name
    if (!firstName) return
    try {
      const meta = (await FilesService.extractMetadata({
        requestBody: { file_name: firstName },
      })) as { date?: string; platform?: string; sensor?: string }
      setFormValues((prev) => {
        const next = { ...prev }
        if (meta.date && !next.date) next.date = meta.date
        if (meta.platform && !next.platform) next.platform = meta.platform
        if (meta.sensor && !next.sensor) next.sensor = meta.sensor
        return next
      })
    } catch {
      // extractMetadata is not implemented upstream — user fills in manually.
    }
  }, [])

  const handleRgbUploadComplete = useCallback((destPaths: string[]) => {
    const tif = destPaths.find((p) => /\.(tif|tiff)$/i.test(p))
    if (tif) setRgbTifPath(tif)
  }, [])

  const handleDemUploadComplete = useCallback((destPaths: string[]) => {
    const tif = destPaths.find((p) => /\.(tif|tiff)$/i.test(p))
    if (tif) setDemTifPath(tif)
  }, [])

  const handleUploadComplete = useCallback(
    async (destPaths: string[]) => {
      if (selectedFileType === "Synced Metadata") {
        const csvPath = destPaths.find((p) => /\.csv$/i.test(p))
        if (!csvPath) return
        const content = await fetchUploadedContent(csvPath)
        if (!content) return
        setSyncedCsvText(content.text)
        setSyncedCsvPath(csvPath)
      } else if (selectedFileType === "Reference Data") {
        const filePath = destPaths[0]
        if (!filePath) return
        const content = await fetchUploadedContent(filePath)
        if (!content) return
        const fileName = filePath.split(/[\\/]/).pop() ?? "reference.csv"
        setRefDataFile(new File([content.blob], fileName))
      }
    },
    [selectedFileType],
  )

  return (
    <div className="bg-background">
      <div className="pt-6">
        <div className="grid grid-cols-2 gap-8 items-start">
          <div className="space-y-6">
            <DataTypes
              onChange={(t) => {
                setSelectedFileType(t)
                setRgbTifPath(null)
                setDemTifPath(null)
              }}
            />
            <DataStructureForm
              fileType={selectedFileType}
              values={formValues}
              onChange={handleFormChange}
            />
          </div>

          {selectedFileType === "Orthomosaic" ? (
            <div className="space-y-6">
              <div>
                <UploadList
                  dataType={selectedFileType}
                  formValues={formValues}
                  onFilesSelected={handleFilesSelected}
                  onUploadComplete={handleRgbUploadComplete}
                  label="RGB Orthomosaic (.tif) — required"
                />
                {rgbTifPath && (
                  <GeoTiffValidationCard
                    key={rgbTifPath}
                    destPath={rgbTifPath}
                  />
                )}
              </div>
              <div className="border-t pt-6">
                <UploadList
                  dataType="Orthomosaic DEM"
                  formValues={formValues}
                  onUploadComplete={handleDemUploadComplete}
                  label="DEM (.tif) — optional (required for plant height)"
                />
                {demTifPath && (
                  <GeoTiffValidationCard
                    key={demTifPath}
                    destPath={demTifPath}
                  />
                )}
              </div>
            </div>
          ) : (
            <UploadList
              dataType={selectedFileType}
              formValues={formValues}
              onFilesSelected={handleFilesSelected}
              onUploadComplete={handleUploadComplete}
            />
          )}
        </div>
      </div>

      {refDataFile && (
        <ReferenceDataUploadDialog
          open
          file={refDataFile}
          formValues={formValues}
          onClose={() => setRefDataFile(null)}
        />
      )}

      {syncedCsvText !== null && (
        <MsgsSyncedUploadDialog
          open
          initialCsvText={syncedCsvText}
          destPath={syncedCsvPath ?? undefined}
          onClose={() => {
            setSyncedCsvText(null)
            setSyncedCsvPath(null)
          }}
          onSaved={() => {
            setSyncedCsvText(null)
            setSyncedCsvPath(null)
          }}
        />
      )}

      <Dialog
        open={dockerErrorMsg !== null}
        onOpenChange={(open) => {
          if (!open) setDockerErrorMsg(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Docker Required</DialogTitle>
            <DialogDescription asChild>
              <div className="text-muted-foreground space-y-3 text-sm">
                <p>
                  Extracting <strong className="text-foreground">.bin files</strong>{" "}
                  on Windows requires Docker Desktop to run the extraction tool
                  inside a Linux container.
                </p>
                {dockerErrorMsg?.toLowerCase().includes("not running") ||
                dockerErrorMsg?.toLowerCase().includes("start docker") ? (
                  <p>
                    Docker Desktop is installed but does not appear to be
                    running. Please start Docker Desktop, wait for it to finish
                    loading, then try uploading again.
                  </p>
                ) : (
                  <p>
                    Docker Desktop was not found on this machine. Install it,
                    then restart GEMI. The extraction tool (~1 GB) will build
                    automatically the first time — no extra setup needed.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setDockerErrorMsg(null)}>
              Close
            </Button>
            <Button
              onClick={() =>
                openUrl("https://www.docker.com/products/docker-desktop/")
              }
            >
              Download Docker Desktop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
