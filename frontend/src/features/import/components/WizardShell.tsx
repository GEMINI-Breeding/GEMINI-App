/**
 * Top-level orchestrator for /import. Ported from
 * `backend/gemini-ui/src/components/import-wizard/wizard-shell.tsx`.
 *
 * Phase 9c lands the state machine + shared steps (Detect, Confirm) +
 * conditional stub branches for Genomic (9d) and Trait (9e). The flat
 * `WizardState` shape and step-index arithmetic are kept identical to
 * the reference UI so step components ported in 9d/9e can drop in
 * without touching this file.
 */

import {
  CheckCircle,
  FileText,
  Search,
  TableProperties,
  Upload,
  Users,
} from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import { StepColumnMapping } from "@/features/import/components/StepColumnMapping"
import { StepConfirm } from "@/features/import/components/StepConfirm"
import { StepDetect } from "@/features/import/components/StepDetect"
import { StepGermplasmReview } from "@/features/import/components/StepGermplasmReview"
import { StepMetadata } from "@/features/import/components/StepMetadata"
import { StepUpload } from "@/features/import/components/StepUpload"
import { GenomicWizard } from "@/features/import/genomic/GenomicWizard"
import type { DetectionResult } from "@/features/import/lib/detection-engine"
import type {
  ColumnMapping,
  FileWithPath,
  GermplasmReview,
  ImportMetadata,
  UploadResults,
  WizardState,
} from "@/features/import/lib/types"
import { cn } from "@/lib/utils"

const BASE_STEPS = [
  { label: "Detect", icon: Search },
  { label: "Metadata", icon: FileText },
  { label: "Upload", icon: Upload },
  { label: "Confirm", icon: CheckCircle },
] as const

const MAPPING_STEP = { label: "Map Columns", icon: TableProperties } as const
const GERMPLASM_STEP = { label: "Review Germplasm", icon: Users } as const

// `germplasmMappingMode` lives in `../lib/germplasmMode.ts` so non-React
// helpers (recordBuilder, etc.) can reuse it without pulling lucide/React.
// Re-export the classification + type from the lib so existing imports
// from `WizardShell` keep working.
export {
  type GermplasmMappingMode,
  germplasmMappingMode,
} from "@/features/import/lib/germplasmMode"

import { germplasmMappingMode as germplasmMappingModeFn } from "@/features/import/lib/germplasmMode"

export interface WizardShellProps {
  /** When provided, the wizard skips StepDetect (the Files page already
   *  picked the data kind from a dropdown). When omitted, falls back to
   *  the auto-detect entry — kept for the future unification task. */
  initialFiles?: FileWithPath[]
  initialDetection?: DetectionResult
  /** When provided alongside initialDetection, the wizard also skips its
   *  own Metadata step — metadata was collected by the Files page's
   *  DataStructureForm before the file was dropped. */
  initialMetadata?: ImportMetadata
  /** Optional close handler — when present, exposed via the GenomicWizardStub
   *  exit and replaces the trait-flow "Done" reset behavior so the host
   *  dialog can dismiss. */
  onClose?: () => void
  /** Forwarded to GenomicWizard / StepIngestGenomic so the host can lock
   *  dialog dismissal while ingest is mid-flight. */
  onBusyChange?: (busy: boolean) => void
}

export function WizardShell({
  initialFiles,
  initialDetection,
  initialMetadata,
  onClose,
  onBusyChange,
}: WizardShellProps = {}) {
  const skipDetect =
    initialFiles !== undefined && initialDetection !== undefined
  const skipMetadata = skipDetect && initialMetadata !== undefined

  // Step layout: leading [Detect, Metadata] (each may be skipped),
  // optional [Mapping, Germplasm], trailing [Upload, Confirm].
  const detectStepIndex = skipDetect ? -1 : 0
  const metadataStepIndex = skipMetadata ? -1 : skipDetect ? 0 : 1
  const mappingStepIndex = (skipDetect ? 0 : 1) + (skipMetadata ? 0 : 1)

  const [state, setState] = useState<WizardState>({
    files: initialFiles ?? [],
    detection: initialDetection ?? null,
    metadata: initialMetadata ?? null,
    columnMapping: null,
    germplasmReview: null,
    uploadResults: null,
    genomic: null,
  })
  const [step, setStep] = useState(
    skipMetadata ? mappingStepIndex : skipDetect ? metadataStepIndex : 0,
  )

  const needsMapping =
    state.detection?.dataCategories.some((c) => c === "csv_tabular") ?? false
  const needsGermplasm =
    needsMapping && germplasmMappingModeFn(state.columnMapping) === "ambiguous"

  const steps = useMemo(() => {
    const s: { label: string; icon: typeof Search }[] = []
    if (!skipDetect) s.push(BASE_STEPS[0])
    if (!skipMetadata) s.push(BASE_STEPS[1])
    if (needsMapping) s.push(MAPPING_STEP)
    if (needsGermplasm) s.push(GERMPLASM_STEP)
    s.push(BASE_STEPS[2], BASE_STEPS[3])
    return s
  }, [needsMapping, needsGermplasm, skipDetect, skipMetadata])

  const germplasmStepIndex = needsMapping ? mappingStepIndex + 1 : -1
  const uploadStepIndex =
    mappingStepIndex + (needsMapping ? 1 : 0) + (needsGermplasm ? 1 : 0)
  const confirmStepIndex = uploadStepIndex + 1

  const handleDetectNext = useCallback<
    React.ComponentProps<typeof StepDetect>["onNext"]
  >(
    (files, detection) => {
      setState((prev) => ({ ...prev, files, detection }))
      setStep(metadataStepIndex)
    },
    [metadataStepIndex],
  )

  const handleMetadataNext = useCallback(
    (metadata: ImportMetadata) => {
      setState((prev) => ({ ...prev, metadata }))
      setStep(mappingStepIndex)
    },
    [mappingStepIndex],
  )

  const handleMappingNext = useCallback(
    (mapping: ColumnMapping) => {
      setState((prev) => ({
        ...prev,
        columnMapping: mapping,
        germplasmReview: null,
      }))
      // Lands on germplasm review if columns are ambiguous, otherwise jumps
      // straight to upload — both indices are computed dynamically.
      setStep(needsGermplasm ? germplasmStepIndex : uploadStepIndex)
    },
    [needsGermplasm, germplasmStepIndex, uploadStepIndex],
  )

  const handleGermplasmNext = useCallback(
    (review: GermplasmReview) => {
      setState((prev) => ({ ...prev, germplasmReview: review }))
      setStep(uploadStepIndex)
    },
    [uploadStepIndex],
  )

  const handleUploadNext = useCallback(
    (results: UploadResults) => {
      setState((prev) => ({ ...prev, uploadResults: results }))
      setStep(confirmStepIndex)
    },
    [confirmStepIndex],
  )

  const reset = useCallback(() => {
    if (onClose) {
      onClose()
      return
    }
    setState({
      files: [],
      detection: null,
      metadata: null,
      columnMapping: null,
      germplasmReview: null,
      uploadResults: null,
      genomic: null,
    })
    setStep(0)
  }, [onClose])

  const handleBack = useCallback((toStep: number) => {
    setStep(toStep)
  }, [])

  // Genomic detection short-circuits the linear wizard. The early return
  // MUST come after every hook call above — otherwise re-renders produce
  // a different hook count and React throws.
  const isGenomic =
    state.detection?.dataCategories.includes("genomic") &&
    state.detection.genomicShape != null &&
    state.detection.genomicFile != null

  if (isGenomic && state.detection) {
    return (
      <GenomicWizard
        files={state.files}
        detection={state.detection}
        metadata={state.metadata}
        onBusyChange={onBusyChange}
        onClose={reset}
      />
    )
  }

  return (
    <div className="space-y-6" data-testid="import-wizard">
      <nav
        className="flex items-center justify-center gap-2"
        data-testid="import-stepper"
      >
        {steps.map((s, i) => {
          const Icon = s.icon
          const isActive = i === step
          const isComplete = i < step
          return (
            <div key={s.label} className="flex items-center">
              {i > 0 && (
                <div
                  className={cn(
                    "mx-2 h-px w-12",
                    isComplete ? "bg-primary" : "bg-border",
                  )}
                />
              )}
              <div
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                  isActive && "bg-primary text-primary-foreground",
                  isComplete && "bg-primary/10 text-primary",
                  !isActive && !isComplete && "text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{s.label}</span>
                <span className="sm:hidden">{i + 1}</span>
              </div>
            </div>
          )
        })}
      </nav>

      {step === detectStepIndex && <StepDetect onNext={handleDetectNext} />}

      {step === metadataStepIndex && state.detection && (
        <StepMetadata
          detection={state.detection}
          initial={state.metadata}
          onNext={handleMetadataNext}
          onBack={() => handleBack(detectStepIndex)}
        />
      )}

      {needsMapping &&
        step === mappingStepIndex &&
        state.detection &&
        state.metadata && (
          <StepColumnMapping
            files={state.files}
            initial={state.columnMapping}
            onNext={handleMappingNext}
            onBack={() => handleBack(metadataStepIndex)}
          />
        )}

      {needsGermplasm &&
        step === germplasmStepIndex &&
        state.columnMapping &&
        state.metadata && (
          <StepGermplasmReview
            mapping={state.columnMapping}
            metadata={state.metadata}
            initial={state.germplasmReview}
            onNext={handleGermplasmNext}
            onBack={() => handleBack(mappingStepIndex)}
          />
        )}

      {step === uploadStepIndex && state.detection && state.metadata && (
        <StepUpload
          files={state.files}
          metadata={state.metadata}
          columnMapping={state.columnMapping}
          germplasmReview={state.germplasmReview}
          onBusyChange={onBusyChange}
          onNext={handleUploadNext}
          onBack={() =>
            handleBack(
              needsGermplasm
                ? germplasmStepIndex
                : needsMapping
                  ? mappingStepIndex
                  : metadataStepIndex,
            )
          }
        />
      )}

      {step === confirmStepIndex && state.uploadResults && (
        <StepConfirm
          results={state.uploadResults}
          onDone={reset}
          onFinish={onClose}
        />
      )}
    </div>
  )
}
