/**
 * Phase 9e step 1: pick (or create) experiment + (when applicable) sensor
 * platform / sensor, plus dataset names. The /import flow lands here when
 * launched without an `initialMetadata` from the Files page; otherwise
 * `WizardShell` skips this step entirely.
 *
 * Ported from `backend/gemini-ui/src/components/import-wizard/step-metadata.tsx`.
 * Adapted to use our `EntitySelectField` primitive (which handles the
 * existing-vs-create-new state internally) and the `useScopeOptions` hook
 * which already wires our SDK + react-query for experiment / platform /
 * sensor lookups.
 */
import { AlertTriangle, Loader2 } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
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
  type EntityChoice,
  EntitySelectField,
} from "@/features/files/components/EntitySelectField"
import { useScopeOptions } from "@/features/files/hooks/useUploadScope"
import { useExistingDatasetNames } from "@/features/import/hooks/useExistingDatasetNames"
import { buildDatasetName } from "@/features/import/lib/datasetName"
import {
  type DetectionResult,
  needsSensorFields,
} from "@/features/import/lib/detection-engine"
import type {
  ImportMetadata,
  SensorClassification,
  ThermalCalibration,
  ThermalCalibrationMode,
} from "@/features/import/lib/types"
import { DataFormat, DataType, SensorType } from "@/lib/geminiEnums"

interface StepMetadataProps {
  detection: DetectionResult
  initial: ImportMetadata | null
  onNext: (metadata: ImportMetadata) => void
  onBack: () => void
}

function initialExperimentChoice(initial: ImportMetadata | null): EntityChoice {
  if (!initial) return { kind: "none" }
  if (initial.createNew.experiment) {
    return { kind: "new", name: initial.experimentName }
  }
  if (initial.experimentId) {
    return {
      kind: "existing",
      id: initial.experimentId,
      name: initial.experimentName,
    }
  }
  return { kind: "none" }
}

function initialNamedChoice(
  isNew: boolean,
  name: string,
  options: { id: string; name: string }[],
): EntityChoice {
  if (isNew) return { kind: "new", name }
  if (!name) return { kind: "none" }
  const match = options.find((o) => o.name === name)
  if (match) return { kind: "existing", id: match.id, name: match.name }
  return { kind: "none" }
}

/**
 * Derive the (sensor_type, data_type, data_format) triple from the
 * detection result. The wizard previously sent (0, 0, 0) for everything,
 * which made it impossible to tell RGB and thermal sensors apart at the
 * DB level — see Phase A.4 of the thermal-support plan.
 *
 * Returns null for non-image categories (tabular, genomic) — those don't
 * create a sensor row and the field stays undefined on metadata.
 */
function deriveSensorClassification(
  detection: DetectionResult,
): SensorClassification | null {
  const categories = detection.dataCategories
  const isThermal = categories.includes("thermal")
  const isDrone = categories.includes("drone_imagery")
  const isElevation = categories.includes("elevation")
  if (!isThermal && !isDrone && !isElevation) return null

  const hasTiff = /TIFF/i.test(detection.suggestedDataFormat)
  const dataFormatId = hasTiff
    ? DataFormat.TIFF
    : isThermal
      ? DataFormat.JPEG
      : DataFormat.JPEG
  const sensorTypeId = isThermal
    ? SensorType.Thermal
    : isElevation
      ? SensorType.Depth
      : SensorType.RGB
  return {
    sensorTypeId,
    dataTypeId: DataType.Image,
    dataFormatId,
  }
}

/**
 * Pick a sensible default calibration mode from the detected file
 * shape. FLIR-One-Pro JPEGs carry Planck constants per file so the
 * worker can compute T(°C) without further input — the wizard
 * pre-selects `flir_one_pro` and disables the dropdown for that case.
 * Boson TIFFs need a user pick because the camera mode isn't recorded
 * anywhere in the file.
 */
function defaultThermalMode(
  detection: DetectionResult,
): ThermalCalibrationMode {
  if (/JPEG/i.test(detection.suggestedDataFormat)) return "flir_one_pro"
  // Boson TIFFs from BosonUSB / farm-ng Amiga emit pixel-as-centikelvin
  // by default; that's the right pre-select for the average user.
  // The two TLinear modes remain selectable.
  return "boson_centikelvin"
}

const THERMAL_MODE_LABELS: Record<ThermalCalibrationMode, string> = {
  flir_one_pro: "FLIR One Pro (auto, per-file Planck)",
  boson_centikelvin: "Boson — centikelvin (T_K = pixel × 0.01)",
  boson_tlinear_high: "Boson TLinear — high-gain (0.04 K/count)",
  boson_tlinear_low: "Boson TLinear — low-gain (0.4 K/count)",
  boson_agc_nonradiometric: "Boson — non-radiometric (AGC, no temperature)",
  user_defined: "User-defined scale + offset",
}

const THERMAL_MODE_ORDER_BOSON: ThermalCalibrationMode[] = [
  "boson_centikelvin",
  "boson_tlinear_high",
  "boson_tlinear_low",
  "boson_agc_nonradiometric",
  "user_defined",
]

const THERMAL_MODE_ORDER_FLIR: ThermalCalibrationMode[] = [
  "flir_one_pro",
  "user_defined",
]

function defaultDatasetNames(detection: DetectionResult): string[] {
  const expName = detection.suggestedExperimentName
  // Pick the first concrete category as the label hint. Mixed uploads
  // fall back to "Mixed" via the lookup in datasetName.ts.
  const category = detection.dataCategories[0] ?? null
  if (detection.fileGroups.length <= 1) {
    return [
      buildDatasetName({
        expName,
        category,
        // Only include the date when we genuinely *detected* one from
        // the file/path. The previous fallback to `today` was the upload
        // date, which is not the collection date — actively misleading.
        collectionDate: detection.detectedDates[0] ?? null,
      }),
    ]
  }
  return detection.fileGroups.map((g) =>
    buildDatasetName({
      expName,
      category,
      collectionDate: g.date ?? null,
    }),
  )
}

export function StepMetadata({
  detection,
  initial,
  onNext,
  onBack,
}: StepMetadataProps) {
  const showSensorFields = needsSensorFields(detection.dataCategories)
  const isThermal = detection.dataCategories.includes("thermal")
  // FLIR JPEGs are self-describing; Boson TIFFs need a user pick. Pre-fill
  // accordingly but always let the user override.
  const thermalDefaultMode = defaultThermalMode(detection)
  const thermalModeOptions = /JPEG/i.test(detection.suggestedDataFormat)
    ? THERMAL_MODE_ORDER_FLIR
    : THERMAL_MODE_ORDER_BOSON
  const scopeOptions = useScopeOptions()

  const [experimentChoice, setExperimentChoice] = useState<EntityChoice>(() =>
    initialExperimentChoice(initial),
  )
  const [platformChoice, setPlatformChoice] = useState<EntityChoice>(() =>
    initialNamedChoice(
      initial?.createNew.sensorPlatform ?? false,
      initial?.sensorPlatformName ?? "",
      scopeOptions.sensorPlatform.options,
    ),
  )
  const [sensorChoice, setSensorChoice] = useState<EntityChoice>(() =>
    initialNamedChoice(
      initial?.createNew.sensor ?? false,
      initial?.sensorName ?? "",
      scopeOptions.sensor.options,
    ),
  )
  const [datasetNames, setDatasetNames] = useState<string[]>(() => {
    if (initial && initial.datasetNames.length > 0) {
      return [...initial.datasetNames]
    }
    return defaultDatasetNames(detection)
  })
  const [thermalMode, setThermalMode] = useState<ThermalCalibrationMode>(
    () => initial?.thermalCalibration?.mode ?? thermalDefaultMode,
  )
  // Free-typed scale/offset for `user_defined` mode. Stored as strings so
  // partial typing ("0.0") doesn't clobber to NaN; parsed on continue.
  const [userScale, setUserScale] = useState<string>(() => {
    const init = initial?.thermalCalibration
    if (init?.mode === "user_defined" && typeof init.scale === "number") {
      return String(init.scale)
    }
    return "0.01"
  })
  const [userOffset, setUserOffset] = useState<string>(() => {
    const init = initial?.thermalCalibration
    if (init?.mode === "user_defined" && typeof init.offset === "number") {
      return String(init.offset)
    }
    return "0"
  })
  // Globally-existing dataset names. Used to warn the user when a typed
  // dataset name would collide with an existing dataset — the DB silently
  // merges trait records into the existing dataset row, which is rarely
  // what users want.
  const existingNames = useExistingDatasetNames()

  const updateDatasetName = (index: number, value: string) => {
    setDatasetNames((prev) => {
      const copy = [...prev]
      copy[index] = value
      return copy
    })
  }

  const isChoiceOk = (c: EntityChoice): boolean => {
    if (c.kind === "existing") return Boolean(c.id && c.name)
    if (c.kind === "new") return c.name.trim().length > 0
    return false
  }

  const userScaleNum = Number.parseFloat(userScale)
  const userOffsetNum = Number.parseFloat(userOffset)
  const userCalibValid =
    Number.isFinite(userScaleNum) &&
    userScaleNum > 0 &&
    Number.isFinite(userOffsetNum)

  const isValid = (): boolean => {
    const datasetsOk = datasetNames.every((n) => n.trim() !== "")
    if (!isChoiceOk(experimentChoice) || !datasetsOk) return false
    if (!showSensorFields) return true
    if (!isChoiceOk(platformChoice) || !isChoiceOk(sensorChoice)) return false
    if (isThermal && thermalMode === "user_defined" && !userCalibValid) {
      return false
    }
    return true
  }

  const handleContinue = () => {
    if (!isValid()) return
    const expIsNew = experimentChoice.kind === "new"
    const expName =
      experimentChoice.kind === "existing"
        ? experimentChoice.name
        : experimentChoice.kind === "new"
          ? experimentChoice.name.trim()
          : ""
    const expId =
      experimentChoice.kind === "existing" ? experimentChoice.id : null

    const platformIsNew = platformChoice.kind === "new"
    const platformName = showSensorFields
      ? platformChoice.kind === "existing"
        ? platformChoice.name
        : platformChoice.kind === "new"
          ? platformChoice.name.trim()
          : ""
      : ""

    const sensorIsNew = sensorChoice.kind === "new"
    const sensorName = showSensorFields
      ? sensorChoice.kind === "existing"
        ? sensorChoice.name
        : sensorChoice.kind === "new"
          ? sensorChoice.name.trim()
          : ""
      : ""

    const sensorClassification = showSensorFields
      ? deriveSensorClassification(detection)
      : null
    const thermalCalibration: ThermalCalibration | null = isThermal
      ? thermalMode === "user_defined"
        ? {
            mode: "user_defined",
            scale: userScaleNum,
            offset: userOffsetNum,
          }
        : { mode: thermalMode }
      : null

    const metadata: ImportMetadata = {
      experimentId: expId,
      experimentName: expName,
      sensorPlatformName: platformName,
      sensorName,
      datasetNames: datasetNames.map((n) => n.trim()),
      createNew: {
        experiment: expIsNew,
        sensorPlatform: showSensorFields ? platformIsNew : false,
        sensor: showSensorFields ? sensorIsNew : false,
      },
      sensorClassification,
      thermalCalibration,
    }
    onNext(metadata)
  }

  return (
    <div className="space-y-6" data-testid="step-metadata">
      <div className="rounded-lg border p-4 space-y-4">
        <div>
          <h3 className="font-medium">Configure Import Metadata</h3>
          <p className="text-muted-foreground text-sm">
            Confirm or edit the detected metadata. Season and site are
            configured per-sheet in the next step.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          {scopeOptions.experiment.isLoading ? (
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading experiments…
            </div>
          ) : (
            <EntitySelectField
              label="Experiment"
              fieldKey="experiment"
              value={experimentChoice}
              onChange={setExperimentChoice}
              options={scopeOptions.experiment.options}
              required
              newNameSuggestion={detection.suggestedExperimentName ?? ""}
            />
          )}

          {showSensorFields && (
            <EntitySelectField
              label="Sensor Platform"
              fieldKey="sensor-platform"
              value={platformChoice}
              onChange={setPlatformChoice}
              options={scopeOptions.sensorPlatform.options}
              isLoading={scopeOptions.sensorPlatform.isLoading}
              required
              newNameSuggestion={detection.suggestedPlatform ?? ""}
            />
          )}

          {showSensorFields && (
            <EntitySelectField
              label="Sensor"
              fieldKey="sensor"
              value={sensorChoice}
              onChange={setSensorChoice}
              options={scopeOptions.sensor.options}
              isLoading={scopeOptions.sensor.isLoading}
              required
              newNameSuggestion={detection.suggestedSensorType ?? ""}
            />
          )}
        </div>

        {isThermal && (
          <div
            className="space-y-3 border-t pt-4"
            data-testid="thermal-calibration"
          >
            <div>
              <h4 className="font-medium text-sm">Thermal Calibration</h4>
              <p className="text-muted-foreground text-xs">
                Boson TIFFs don't record which mode the camera was in;
                pick the matching calibration so the worker can compute
                per-pixel temperatures. FLIR One Pro JPEGs are
                self-describing — pick "FLIR One Pro" for those.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="thermal-mode">Calibration mode</Label>
                <Select
                  value={thermalMode}
                  onValueChange={(v) =>
                    setThermalMode(v as ThermalCalibrationMode)
                  }
                >
                  <SelectTrigger
                    id="thermal-mode"
                    data-testid="thermal-mode-trigger"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {thermalModeOptions.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {THERMAL_MODE_LABELS[opt]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {thermalMode === "user_defined" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="thermal-scale">Scale (K / count)</Label>
                    <Input
                      id="thermal-scale"
                      type="number"
                      step="any"
                      value={userScale}
                      onChange={(e) => setUserScale(e.target.value)}
                      data-testid="thermal-scale"
                      aria-invalid={
                        !Number.isFinite(userScaleNum) || userScaleNum <= 0
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="thermal-offset">Offset (K)</Label>
                    <Input
                      id="thermal-offset"
                      type="number"
                      step="any"
                      value={userOffset}
                      onChange={(e) => setUserOffset(e.target.value)}
                      data-testid="thermal-offset"
                      aria-invalid={!Number.isFinite(userOffsetNum)}
                    />
                  </div>
                </>
              )}
            </div>
            {thermalMode === "user_defined" && !userCalibValid && (
              <p className="text-amber-600 dark:text-amber-500 flex items-start gap-1.5 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Scale must be a positive number and offset must be numeric.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <div>
          <h3 className="font-medium">Dataset Names</h3>
          <p className="text-muted-foreground text-sm">
            A dataset groups records from one collection event (e.g. a field
            visit on a specific day). The default combines the experiment, a
            data-type label, the collection date (when detected from the
            file/path), and a short random tag to keep re-uploads distinct.
            Dataset names are globally unique — if you pick a name that's
            already in use we'll warn you and the new records will be merged
            into the existing dataset.
          </p>
        </div>
        <div className="space-y-3">
          {datasetNames.map((name, i) => {
            const trimmed = name.trim()
            // Conflict: another dataset with this exact name already
            // exists. Non-blocking — we don't disable Continue, since
            // the user may genuinely want to append to that dataset.
            // The warning just makes the silent-merge consequence
            // visible.
            const collides =
              trimmed.length > 0 && existingNames.data?.has(trimmed) === true
            return (
              <div key={i} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Label
                    htmlFor={`dataset-name-${i}`}
                    className="text-muted-foreground w-6 shrink-0 text-sm"
                  >
                    {i + 1}.
                  </Label>
                  <Input
                    id={`dataset-name-${i}`}
                    value={name}
                    onChange={(e) => updateDatasetName(i, e.target.value)}
                    placeholder="Dataset name"
                    data-testid={`dataset-name-${i}`}
                    aria-invalid={collides}
                  />
                  {detection.fileGroups[i]?.date && (
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {detection.fileGroups[i].date}
                    </span>
                  )}
                </div>
                {collides && (
                  <p
                    className="text-amber-600 dark:text-amber-500 flex items-start gap-1.5 pl-8 text-xs"
                    data-testid={`dataset-name-warning-${i}`}
                    role="status"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      A dataset with this name already exists. New records
                      will be merged into the existing dataset — change
                      the name if you want a separate dataset.
                    </span>
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} data-testid="metadata-back">
          Back
        </Button>
        <Button
          onClick={handleContinue}
          disabled={!isValid()}
          data-testid="metadata-continue"
        >
          Continue
        </Button>
      </div>
    </div>
  )
}
