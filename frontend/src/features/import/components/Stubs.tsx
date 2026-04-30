/**
 * Phase-9c placeholder components for the wizard branches that land in
 * later sub-phases. Each renders a clearly-labeled box explaining where
 * the real flow lands and provides a "Back" / "Cancel" exit so the user
 * isn't stranded on the route.
 *
 * These get replaced one-by-one as 9d (genomic) and 9e (trait) ship.
 */
import { Construction } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { DetectionResult } from "@/features/import/lib/detection-engine"
import type {
  ColumnMapping,
  GermplasmReview,
  ImportMetadata,
  UploadResults,
  WizardState,
} from "@/features/import/lib/types"

function StubBox({
  phase,
  step,
  description,
}: {
  phase: string
  step: string
  description: string
}) {
  return (
    <div
      className="text-muted-foreground space-y-3 rounded-md border border-dashed px-6 py-12 text-center text-sm"
      data-testid={`import-stub-${step}`}
    >
      <Construction className="text-muted-foreground mx-auto h-8 w-8" />
      <p className="text-foreground font-medium">
        {step} step lands in Phase {phase}.
      </p>
      <p>{description}</p>
    </div>
  )
}

export function GenomicWizardStub({
  detection,
  onExit,
}: {
  files: WizardState["files"]
  detection: DetectionResult
  onExit: () => void
}) {
  return (
    <div className="space-y-6">
      <StubBox
        phase="9d"
        step="Genomic wizard"
        description={`Detected as ${detection.suggestedDataFormat}. The genomic ingest flow (study picker → sample resolve → ingest) lands in Phase 9d.`}
      />
      <div className="flex justify-center">
        <Button variant="outline" onClick={onExit}>
          Back to Detect
        </Button>
      </div>
    </div>
  )
}

export function StepMetadataStub({
  onNext,
  onBack,
}: {
  detection: DetectionResult
  initial: ImportMetadata | null
  onNext: (m: ImportMetadata) => void
  onBack: () => void
}) {
  return (
    <div className="space-y-6">
      <StubBox
        phase="9e"
        step="Metadata"
        description="Pickers for experiment / sensor / dataset (use existing or create new) land in Phase 9e."
      />
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          onClick={() =>
            onNext({
              experimentId: null,
              experimentName: "",
              sensorPlatformName: "",
              sensorName: "",
              datasetNames: [],
              createNew: {
                experiment: false,
                sensorPlatform: false,
                sensor: false,
              },
            })
          }
          data-testid="metadata-stub-next"
        >
          Skip (stub)
        </Button>
      </div>
    </div>
  )
}

export function StepColumnMappingStub({
  onNext,
  onBack,
}: {
  files: WizardState["files"]
  initial: ColumnMapping | null
  onNext: (m: ColumnMapping) => void
  onBack: () => void
}) {
  return (
    <div className="space-y-6">
      <StubBox
        phase="9e"
        step="Column mapping"
        description="The per-sheet column-mapping UI (plot number, trait columns, germplasm columns, season/site/timestamp modes) lands in Phase 9e."
      />
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          onClick={() =>
            onNext({ recordType: "trait", sheets: [], sheetConfigs: [] })
          }
          data-testid="mapping-stub-next"
        >
          Skip (stub)
        </Button>
      </div>
    </div>
  )
}

export function StepGermplasmReviewStub({
  onNext,
  onBack,
}: {
  mapping: ColumnMapping
  metadata: ImportMetadata
  initial: GermplasmReview | null
  onNext: (r: GermplasmReview) => void
  onBack: () => void
}) {
  return (
    <div className="space-y-6">
      <StubBox
        phase="9e"
        step="Germplasm review"
        description="The germplasm-resolution UI (auto-resolved vs unresolved per accession/line/alias) lands in Phase 9e."
      />
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          onClick={() => onNext({ allNames: [], resolved: {} })}
          data-testid="germplasm-stub-next"
        >
          Skip (stub)
        </Button>
      </div>
    </div>
  )
}

export function StepUploadStub({
  onNext,
  onBack,
}: {
  files: WizardState["files"]
  detection: DetectionResult
  metadata: ImportMetadata
  columnMapping: ColumnMapping | null
  germplasmReview: GermplasmReview | null
  onNext: (r: UploadResults) => void
  onBack: () => void
}) {
  return (
    <div className="space-y-6">
      <StubBox
        phase="9e"
        step="Upload"
        description="The orchestration step (idempotent get-or-create for every entity, then bulk-POST records) lands in Phase 9e."
      />
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          onClick={() =>
            onNext({
              createdEntities: [],
              uploadedFiles: 0,
              failedFiles: 0,
              experimentId: null,
            })
          }
          data-testid="upload-stub-next"
        >
          Skip (stub)
        </Button>
      </div>
    </div>
  )
}
