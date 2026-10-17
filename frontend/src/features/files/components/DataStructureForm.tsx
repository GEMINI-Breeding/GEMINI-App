import { FolderTree } from "lucide-react"
import { useEffect } from "react"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { dataTypes } from "@/config/dataTypes"
import {
  type EntityChoice,
  EntitySelectField,
} from "@/features/files/components/EntitySelectField"
import { useScopeOptions } from "@/features/files/hooks/useUploadScope"

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Data-structure form: per-entity dropdowns where the user either picks an
 * existing row or chooses "+ Create new…" and types a new name. Mirrors
 * the gemini-ui import-wizard pattern so uploads stay associated with
 * real database entities (not free-text strings baked only into the
 * MinIO path).
 *
 * `date` and `platform`/`sensor` for non-bin uploads still need to land in
 * the path; we render `date` as a real date input. Sensor platform and
 * sensor are entity dropdowns when the data type asks for them.
 */
interface DataStructureFormProps {
  fileType?: string | null
  /** Current entity choices (per scope key). */
  scope: Record<string, EntityChoice>
  /** Plain free-text fields like the date. */
  values: Record<string, string>
  onScopeChange: (key: string, choice: EntityChoice) => void
  onValueChange: (key: string, value: string) => void
}

const ENTITY_FIELDS: Record<
  string,
  { label: string; scopeKey: keyof ReturnType<typeof useScopeOptions> }
> = {
  experiment: { label: "Experiment", scopeKey: "experiment" },
  // Season is the first path segment under Raw/. Until A.1 this was
  // silently derived from the calendar year of the date input, which
  // coupled the season identity to the upload date.
  season: { label: "Season", scopeKey: "season" },
  // The form has historically called it "location" but the entity is
  // a Site row in the DB. Surface both names to avoid surprising users.
  location: { label: "Site (location)", scopeKey: "site" },
  population: { label: "Population", scopeKey: "population" },
  platform: { label: "Sensor platform", scopeKey: "sensorPlatform" },
  sensor: { label: "Sensor", scopeKey: "sensor" },
}

export function DataStructureForm({
  fileType,
  scope,
  values,
  onScopeChange,
  onValueChange,
}: DataStructureFormProps) {
  const options = useScopeOptions()

  const config = fileType
    ? dataTypes[fileType as keyof typeof dataTypes]
    : undefined
  const fields = config?.fields ?? []
  const hasDateField = fields.includes("date")
  // Sensor data collected in the field on a date: the kinds that can come
  // in more than one part per day (several runs, or one per treatment).
  const isFieldCollection =
    fileType === "Image Data" || fileType === "Farm-ng Binary File"
  const diurnal = values.diurnal === "1"

  // The native <input type="date"> shows today's date in the picker even when
  // the underlying value is empty, so users think the field is set. Mirror
  // that into form state on first render so validation accepts it.
  useEffect(() => {
    if (hasDateField && values.date === undefined) {
      onValueChange("date", todayIsoDate())
    }
  }, [hasDateField, values.date, onValueChange])

  if (!fileType) {
    return (
      <div className="border-border bg-card rounded-lg border p-6">
        <p className="text-muted-foreground">Please select a file type.</p>
      </div>
    )
  }

  const experimentChoice: EntityChoice = scope.experiment ?? { kind: "none" }
  const experimentChosen =
    experimentChoice.kind === "existing" ||
    (experimentChoice.kind === "new" && experimentChoice.name.trim().length > 0)

  return (
    <div
      data-onboarding="files-data-structure-form"
      className="border-border bg-card rounded-lg border p-6"
    >
      <div className="mb-4 flex items-center gap-2">
        <FolderTree className="text-card-foreground h-5 w-5" />
        <h2 className="text-foreground">Data Structure</h2>
      </div>

      <div className="space-y-4">
        {fields.map((field) => {
          // Date stays a free-text date input — it's not an entity.
          if (field === "date") {
            return (
              <div key={field} className="space-y-1.5">
                <Label htmlFor="date">
                  Date<span className="ml-0.5 text-destructive">*</span>
                </Label>
                <Input
                  id="date"
                  type="date"
                  value={values.date ?? ""}
                  onChange={(e) => onValueChange("date", e.target.value)}
                />
              </div>
            )
          }

          const entity = ENTITY_FIELDS[field]
          if (!entity) {
            // Unknown / free-text field: fall back to a plain text input so
            // we don't silently drop it.
            return (
              <div key={field} className="space-y-1.5">
                <Label htmlFor={field}>
                  {field.charAt(0).toUpperCase() + field.slice(1)}
                </Label>
                <Input
                  id={field}
                  value={values[field] ?? ""}
                  onChange={(e) => onValueChange(field, e.target.value)}
                />
              </div>
            )
          }

          // Lock all sub-entity dropdowns until an experiment is picked —
          // creates would otherwise need a parent that doesn't exist yet.
          const requiresParent = field !== "experiment"
          const disabled = requiresParent && !experimentChosen
          const opt = options[entity.scopeKey]

          return (
            <EntitySelectField
              key={field}
              label={entity.label}
              fieldKey={entity.scopeKey}
              value={scope[field] ?? { kind: "none" }}
              onChange={(c) => onScopeChange(field, c)}
              options={opt.options}
              isLoading={opt.isLoading}
              required={!config?.optionalFields?.includes(field)}
              disabled={disabled}
              description={
                disabled
                  ? "Pick or create an experiment first."
                  : field === "platform"
                    ? "Decides the processing: rovers and handheld cameras go through the ground pipeline (plot marking, stitching); drones, with built-in or mounted sensors, through the aerial one (orthomosaic)."
                    : undefined
              }
            />
          )
        })}

        {isFieldCollection && (
          <div
            className="border-border space-y-4 border-t pt-4"
            data-testid="upload-batch-labels"
          >
            <div className="space-y-1.5">
              <Label htmlFor="treatment">Treatment (optional)</Label>
              <Input
                id="treatment"
                data-testid="upload-treatment"
                placeholder="e.g. irrigated, drought"
                value={values.treatment ?? ""}
                onChange={(e) => onValueChange("treatment", e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Only if this experiment's data is collected separately per
                treatment. Each treatment is kept as its own upload.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="diurnal"
                  data-testid="upload-diurnal"
                  checked={diurnal}
                  onCheckedChange={(v) => {
                    onValueChange("diurnal", v === true ? "1" : "")
                    if (v !== true) onValueChange("run_of_day", "")
                  }}
                />
                <Label htmlFor="diurnal" className="font-normal">
                  Diurnal data: this field was covered more than once on this
                  date
                </Label>
              </div>
              {diurnal && (
                <div className="space-y-1.5 pl-6">
                  <Label htmlFor="run_of_day">Run of the day</Label>
                  <Input
                    id="run_of_day"
                    data-testid="upload-run-of-day"
                    placeholder="e.g. 1, 2, morning, 14:00"
                    value={values.run_of_day ?? ""}
                    onChange={(e) =>
                      onValueChange("run_of_day", e.target.value)
                    }
                  />
                  <p className="text-muted-foreground text-xs">
                    Which of the day's runs these files are. Each run is kept as
                    its own upload and gets its own pipeline run.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
