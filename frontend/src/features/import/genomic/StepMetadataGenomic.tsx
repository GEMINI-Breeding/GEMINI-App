/**
 * Phase 9d step 1: pick (or create) the genotyping study that the file
 * will ingest into. Experiment is already seeded by `ImportWizardDialog`
 * so this step is study-only.
 *
 * The selected study + name flow into `WizardState.genomic` where the
 * ingest step (9d.3) reads them. If the user picks "+ Create new...",
 * the ingest step calls `useCreateGenotypingStudy` before sending
 * batches; we don't create the study here so a user backing out of the
 * wizard doesn't leave an orphan row in the DB.
 */
import { Loader2 } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { idAsString } from "@/features/admin/lib/ids"
import {
  type EntityChoice,
  EntitySelectField,
} from "@/features/files/components/EntitySelectField"
import { useScopeOptions } from "@/features/files/hooks/useUploadScope"
import { useGenotypingStudies } from "@/features/genotyping/hooks/useGenotypingStudies"
import type { DetectionResult } from "@/features/import/lib/detection-engine"
import type { GenomicWizardState } from "@/features/import/lib/types"

interface StepMetadataGenomicProps {
  detection: DetectionResult
  initial: GenomicWizardState | null
  onNext: (genomic: GenomicWizardState) => void
  onBack: () => void
}

function deriveSuggestedStudyName(detection: DetectionResult): string {
  const file = detection.genomicFile
  if (!file) return ""
  return file.name.replace(/\.[^.]+$/, "")
}

function initialChoice(initial: GenomicWizardState | null): EntityChoice {
  if (!initial) return { kind: "none" }
  if (initial.createNewStudy) return { kind: "new", name: initial.studyName }
  if (initial.studyId) {
    return { kind: "existing", id: initial.studyId, name: initial.studyName }
  }
  return { kind: "none" }
}

/** Map the wizard's current populationName (a plain string) to the
 *  EntityChoice shape the picker uses. We can't know if it points at an
 *  existing row without consulting the options, so we hand back "new"
 *  (= text the user typed) and let the picker re-resolve to "existing"
 *  once the options load and the user's selection matches a name. */
function initialPopulationChoice(
  initial: GenomicWizardState | null,
  options: { id: string; name: string }[],
): EntityChoice {
  const name = initial?.populationName?.trim()
  if (!name) return { kind: "none" }
  const match = options.find((o) => o.name === name)
  if (match) return { kind: "existing", id: match.id, name: match.name }
  return { kind: "new", name }
}

export function StepMetadataGenomic({
  detection,
  initial,
  onNext,
  onBack,
}: StepMetadataGenomicProps) {
  const studiesQuery = useGenotypingStudies()
  const scopeOptions = useScopeOptions()
  const [choice, setChoice] = useState<EntityChoice>(() =>
    initialChoice(initial),
  )
  const [populationChoice, setPopulationChoice] = useState<EntityChoice>(() =>
    initialPopulationChoice(initial, scopeOptions.population.options),
  )

  const options = (studiesQuery.data ?? []).map((s) => ({
    id: idAsString(s.id),
    name: s.study_name ?? "(unnamed)",
  }))

  const shape = detection.genomicShape
  const sampleCount = shape?.sampleHeaders.length ?? 0

  const canContinue =
    choice.kind === "existing"
      ? Boolean(choice.id && choice.name)
      : choice.kind === "new"
        ? choice.name.trim().length > 0
        : false

  const populationName =
    populationChoice.kind === "existing"
      ? populationChoice.name
      : populationChoice.kind === "new"
        ? populationChoice.name.trim()
        : null

  const handleContinue = () => {
    if (!canContinue) return
    if (choice.kind === "existing") {
      onNext({
        studyId: choice.id,
        studyName: choice.name,
        createNewStudy: false,
        populationName: populationName || null,
        sampleResolution: initial?.sampleResolution ?? null,
      })
    } else if (choice.kind === "new") {
      onNext({
        studyId: null,
        studyName: choice.name.trim(),
        createNewStudy: true,
        populationName: populationName || null,
        sampleResolution: initial?.sampleResolution ?? null,
      })
    }
  }

  return (
    <div className="space-y-6" data-testid="step-metadata-genomic">
      {shape && (
        <div
          className="space-y-1 rounded-lg border p-4 text-sm"
          data-testid="genomic-file-summary"
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">File shape</span>
            <span className="text-muted-foreground text-xs uppercase tracking-wide">
              {shape.format}
            </span>
          </div>
          <div className="text-muted-foreground">
            {sampleCount.toLocaleString()} sample
            {sampleCount === 1 ? "" : "s"} detected
          </div>
        </div>
      )}

      {studiesQuery.isLoading ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading studies…
        </div>
      ) : (
        <EntitySelectField
          label="Genotyping Study"
          fieldKey="genotyping-study"
          value={choice}
          onChange={setChoice}
          options={options}
          isLoading={studiesQuery.isLoading}
          required
          newNameSuggestion={deriveSuggestedStudyName(detection)}
          description="Pick an existing study or create a new one to receive these variants."
        />
      )}

      <EntitySelectField
        label="Population"
        fieldKey="genotyping-population"
        value={populationChoice}
        onChange={setPopulationChoice}
        options={scopeOptions.population.options}
        isLoading={scopeOptions.population.isLoading}
        description="Optional. When set, every accession this import creates is grouped under the named population (the same way trait imports do). Leave unspecified if accessions should remain unaffiliated."
      />

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          onClick={handleContinue}
          disabled={!canContinue}
          data-testid="genomic-metadata-continue"
        >
          Continue
        </Button>
      </div>
    </div>
  )
}
