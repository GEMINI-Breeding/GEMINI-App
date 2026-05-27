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
import type { EntityChoice } from "../components/EntitySelectField"
import { GeoTiffValidationCard } from "../components/GeoTiffValidationCard"
import {
  type ImportDataKind,
  ImportWizardDialog,
} from "../components/ImportWizardDialog"
import { MsgsSyncedUploadDialog } from "../components/MsgsSyncedUploadDialog"
import { ReferenceDataUploadDialog } from "../components/ReferenceDataUploadDialog"
import { UploadZone } from "../components/UploadZone"
import { useResolveScope } from "../hooks/useUploadScope"
import {
  humanFieldLabel,
  missingFormFields,
} from "../lib/uploadFieldRequirements"

const WIZARD_DATA_KINDS: Record<string, ImportDataKind> = {
  "Trait Data": "trait",
  "Genomic Data": "genomic",
}

function apiUrl(path: string): string {
  const base = (OpenAPI.BASE ?? "").replace(/\/$/, "")
  return base + path
}

// Default MinIO bucket used by the chunk-upload endpoint. The download
// route parses its path as `<bucket>/<object>`, so uploads we want to
// round-trip through the browser have to be fetched through that prefix.
const DEFAULT_BUCKET = "gemini"

/**
 * Read a MinIO-hosted object back to the browser via the new download
 * endpoint. Used to round-trip CSV / reference uploads so the user can
 * edit them in a follow-up dialog.
 */
async function fetchUploadedContent(
  objectPath: string,
): Promise<{ text: string; blob: Blob } | null> {
  const url = apiUrl(`/api/files/download/${DEFAULT_BUCKET}/${objectPath}`)
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
  const [scope, setScope] = useState<Record<string, EntityChoice>>({})
  const [rgbTifPath, setRgbTifPath] = useState<string | null>(null)
  const [demTifPath, setDemTifPath] = useState<string | null>(null)
  const [syncedCsvText, setSyncedCsvText] = useState<string | null>(null)
  const [syncedCsvPath, setSyncedCsvPath] = useState<string | null>(null)
  const [dockerErrorMsg, setDockerErrorMsg] = useState<string | null>(null)
  const [refDataFile, setRefDataFile] = useState<File | null>(null)
  const [wizardFiles, setWizardFiles] = useState<File[] | null>(null)
  const [wizardScopeError, setWizardScopeError] = useState<string | null>(null)

  const wizardKind = selectedFileType
    ? WIZARD_DATA_KINDS[selectedFileType]
    : undefined

  /**
   * Both gates required for any upload affordance on this page:
   *   1. A data type must be selected (so the path builder, dropzone
   *      hint, and wizard kind are all defined).
   *   2. Every field the data type declares (experiment, site,
   *      population, date, sensor platform, sensor — depending on the
   *      type) must be filled. Each entity in this app is scoped to
   *      these; uploads with missing fields get orphaned in MinIO and
   *      the trait/genomic flows produce records that can never be
   *      reached from the UI.
   * The gate is enforced at the dropzone, not at form submit, so the
   * user can't even stage files into an undefined target.
   */
  const missingFields = missingFormFields(selectedFileType, formValues, scope)
  const uploadDisabled = !selectedFileType || missingFields.length > 0
  const uploadDisabledReason = !selectedFileType
    ? "Select a data type to continue."
    : missingFields.length > 0
      ? `Fill in: ${missingFields.map(humanFieldLabel).join(", ")}.`
      : undefined

  const { resolveScope } = useResolveScope()

  /**
   * On wizard-dropzone file drop, materialise any "create new" entries
   * in `scope` (in particular the experiment) so the wizard always
   * sees a real DB-backed `experimentId`. Without this, dropping a
   * file with an unsaved "+ Create new" experiment choice opens the
   * wizard with `experimentId === null`, the create-study POST gets
   * `experiment_name="GEMINI"` but `Experiment.get(name="GEMINI")`
   * returns None, and the study is created with no association — the
   * detail page then says "No experiments associated".
   */
  const handleWizardFilesDropped = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      try {
        const resolved = await resolveScope({
          experiment: scope.experiment,
        })
        if (resolved.experiment) {
          setScope((prev) => ({
            ...prev,
            experiment: {
              kind: "existing",
              id: resolved.experiment!.id,
              name: resolved.experiment!.name,
            },
          }))
        }
        setWizardScopeError(null)
        setWizardFiles(files)
      } catch (err) {
        setWizardScopeError(
          err instanceof Error
            ? err.message
            : "Failed to resolve experiment before opening wizard.",
        )
      }
    },
    [resolveScope, scope.experiment],
  )

  const handleValueChange = (field: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [field]: value }))
  }

  const handleScopeChange = (field: string, choice: EntityChoice) => {
    setScope((prev) => {
      const next = { ...prev, [field]: choice }
      // Clearing or changing the experiment invalidates downstream entity
      // choices that were created against the previous experiment. Reset
      // them so the user re-picks (or re-creates) explicitly rather than
      // accidentally reusing a stale id.
      if (field === "experiment") {
        return { experiment: choice }
      }
      return next
    })
    // Mirror the visible name into formValues so downstream consumers
    // (path builder, ReferenceDataUploadDialog) keep working without
    // having to know about the EntityChoice type.
    const name =
      choice.kind === "existing"
        ? choice.name
        : choice.kind === "new"
          ? choice.name
          : ""
    setFormValues((prev) => {
      const next = { ...prev, [field]: name }
      if (field === "experiment") {
        // Wipe the dependent fields' mirrored names too. Season is
        // experiment-scoped (Season FK includes experiment_id), so it
        // belongs in this list — picking a "+ Create new" season under
        // experiment A then switching to experiment B would otherwise
        // leak the A-scoped name into the B-scoped path.
        for (const k of [
          "season",
          "location",
          "population",
          "platform",
          "sensor",
        ])
          delete next[k]
      }
      return next
    })
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
                setWizardFiles(null)
              }}
            />
            <DataStructureForm
              fileType={selectedFileType}
              scope={scope}
              values={formValues}
              onScopeChange={handleScopeChange}
              onValueChange={handleValueChange}
            />
          </div>

          {selectedFileType === "Orthomosaic" ? (
            <div className="space-y-6">
              <div>
                <UploadList
                  dataType={selectedFileType}
                  formValues={formValues}
                  scope={scope}
                  onFilesSelected={handleFilesSelected}
                  onUploadComplete={handleRgbUploadComplete}
                  label="RGB Orthomosaic (.tif) — required"
                  disabled={uploadDisabled}
                  disabledReason={uploadDisabledReason}
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
                  scope={scope}
                  onUploadComplete={handleDemUploadComplete}
                  label="DEM (.tif) — optional (required for plant height)"
                  disabled={uploadDisabled}
                  disabledReason={uploadDisabledReason}
                />
                {demTifPath && (
                  <GeoTiffValidationCard
                    key={demTifPath}
                    destPath={demTifPath}
                  />
                )}
              </div>
            </div>
          ) : wizardKind ? (
            <div className="space-y-3" data-testid="import-wizard-dropzone">
              <p className="text-muted-foreground text-sm">
                Drop a file to launch the import wizard.
              </p>
              <UploadZone
                onFilesAdded={handleWizardFilesDropped}
                disabled={uploadDisabled}
                disabledReason={uploadDisabledReason}
              />
              {wizardScopeError && (
                <p
                  className="text-destructive text-sm"
                  data-testid="wizard-scope-error"
                >
                  {wizardScopeError}
                </p>
              )}
            </div>
          ) : (
            // Thermal-data detection + calibration picker now lives
            // INSIDE UploadList — it probes file bytes after the user
            // drops a batch, so we don't depend on a manual "this is
            // thermal" toggle here. See UploadList.addFiles().
            <UploadList
              dataType={selectedFileType}
              formValues={formValues}
              scope={scope}
              onFilesSelected={handleFilesSelected}
              onUploadComplete={handleUploadComplete}
              disabled={uploadDisabled}
              disabledReason={uploadDisabledReason}
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

      {wizardKind && wizardFiles && (
        <ImportWizardDialog
          open
          dataKind={wizardKind}
          files={wizardFiles}
          scope={scope}
          formValues={formValues}
          onClose={() => setWizardFiles(null)}
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
                  Extracting{" "}
                  <strong className="text-foreground">.bin files</strong> on
                  Windows requires Docker Desktop to run the extraction tool
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
