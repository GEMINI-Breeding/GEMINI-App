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
import { Loader2 } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  type EntityChoice,
  EntitySelectField,
} from "@/features/files/components/EntitySelectField"
import { useScopeOptions } from "@/features/files/hooks/useUploadScope"
import {
  type DetectionResult,
  needsSensorFields,
} from "@/features/import/lib/detection-engine"
import type { ImportMetadata } from "@/features/import/lib/types"

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

function defaultDatasetNames(detection: DetectionResult): string[] {
  const today = new Date().toISOString().slice(0, 10)
  const expName = detection.suggestedExperimentName
  if (detection.fileGroups.length <= 1) {
    const date = detection.detectedDates[0] || today
    const base = expName ? `${expName} - ${date}` : `Collection ${date}`
    return [base]
  }
  return detection.fileGroups.map((g) => {
    const date = g.date || today
    return expName ? `${expName} - ${date}` : `Collection ${date}`
  })
}

export function StepMetadata({
  detection,
  initial,
  onNext,
  onBack,
}: StepMetadataProps) {
  const showSensorFields = needsSensorFields(detection.dataCategories)
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

  const isValid = (): boolean => {
    const datasetsOk = datasetNames.every((n) => n.trim() !== "")
    if (!isChoiceOk(experimentChoice) || !datasetsOk) return false
    if (!showSensorFields) return true
    return isChoiceOk(platformChoice) && isChoiceOk(sensorChoice)
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
      </div>

      <div className="rounded-lg border p-4 space-y-3">
        <div>
          <h3 className="font-medium">Dataset Names</h3>
          <p className="text-muted-foreground text-sm">
            A dataset groups records from one collection event (e.g. a field
            visit on a specific day). The default combines the experiment and
            date — edit if you'd prefer something else.
          </p>
        </div>
        <div className="space-y-2">
          {datasetNames.map((name, i) => (
            <div key={i} className="flex items-center gap-2">
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
              />
              {detection.fileGroups[i]?.date && (
                <span className="text-muted-foreground shrink-0 text-xs">
                  {detection.fileGroups[i].date}
                </span>
              )}
            </div>
          ))}
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
