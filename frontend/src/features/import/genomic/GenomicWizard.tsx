/**
 * Phase 9d orchestrator. WizardShell short-circuits to this when the
 * seeded detection has `dataCategories: ["genomic"]`. Drives a small
 * state machine over `WizardState.genomic` + `state.uploadResults`:
 *
 *   metadata (study picker) → sample-resolve → ingest → confirm
 *
 * Each step is a self-contained component; this file is just routing.
 * The shared StepConfirm (used by the trait flow too) renders the final
 * UploadResults summary.
 */
import { useCallback, useState } from "react"
import { StepConfirm } from "@/features/import/components/StepConfirm"
import { StepIngestGenomic } from "@/features/import/genomic/StepIngestGenomic"
import { StepMetadataGenomic } from "@/features/import/genomic/StepMetadataGenomic"
import { StepSampleResolve } from "@/features/import/genomic/StepSampleResolve"
import type { DetectionResult } from "@/features/import/lib/detection-engine"
import type {
  FileWithPath,
  GenomicWizardState,
  ImportMetadata,
  SampleResolution,
  UploadResults,
} from "@/features/import/lib/types"

interface GenomicWizardProps {
  files: FileWithPath[]
  detection: DetectionResult
  metadata: ImportMetadata | null
  /** Forwarded to the ingest step so the host dialog can lock dismissal
   *  while the wizard has server-side state in flight. */
  onBusyChange?: (busy: boolean) => void
  onClose: () => void
}

type Step = "metadata" | "resolve" | "ingest" | "confirm"

export function GenomicWizard({
  files,
  detection,
  metadata,
  onBusyChange,
  onClose,
}: GenomicWizardProps) {
  const [step, setStep] = useState<Step>("metadata")
  const [genomic, setGenomic] = useState<GenomicWizardState | null>(null)
  const [uploadResults, setUploadResults] = useState<UploadResults | null>(null)

  const file = files[0] ?? detection.genomicFile
  const handleMetadataNext = useCallback((next: GenomicWizardState) => {
    setGenomic(next)
    setStep("resolve")
  }, [])

  const handleResolveNext = useCallback((resolution: SampleResolution) => {
    setGenomic((prev) =>
      prev ? { ...prev, sampleResolution: resolution } : prev,
    )
    setStep("ingest")
  }, [])

  const handleIngestDone = useCallback((results: UploadResults) => {
    setUploadResults(results)
    setStep("confirm")
  }, [])

  if (!file) {
    return (
      <div className="text-destructive p-4 text-sm">
        No genomic file available. Close the dialog and pick a file again.
      </div>
    )
  }

  if (step === "metadata") {
    return (
      <StepMetadataGenomic
        detection={detection}
        initial={genomic}
        onNext={handleMetadataNext}
        onBack={onClose}
      />
    )
  }

  if (step === "resolve" && genomic) {
    return (
      <StepSampleResolve
        detection={detection}
        file={file}
        genomic={genomic}
        experimentId={metadata?.experimentId ?? null}
        initial={genomic.sampleResolution ?? null}
        onNext={handleResolveNext}
        onBack={() => setStep("metadata")}
      />
    )
  }

  if (step === "ingest" && genomic && detection.genomicShape) {
    return (
      <StepIngestGenomic
        file={file}
        shape={detection.genomicShape}
        metadata={
          metadata ?? {
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
          }
        }
        genomic={genomic}
        onBusyChange={onBusyChange}
        onDone={handleIngestDone}
        onBack={() => setStep("resolve")}
      />
    )
  }

  if (step === "confirm" && uploadResults) {
    return <StepConfirm results={uploadResults} onDone={onClose} />
  }

  return null
}
