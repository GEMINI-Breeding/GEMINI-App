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

import { StepConfirm } from "@/features/import/components/StepConfirm"
import { StepDetect } from "@/features/import/components/StepDetect"
import {
  GenomicWizardStub,
  StepColumnMappingStub,
  StepGermplasmReviewStub,
  StepMetadataStub,
  StepUploadStub,
} from "@/features/import/components/Stubs"
import type {
  ColumnMapping,
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

export type GermplasmMappingMode =
  | "none"
  | "accession-only"
  | "line-only"
  | "ambiguous"

/** Classify germplasm columns across active sheets. Same rules as the
 *  reference UI: any alias column → ambiguous; both accession and line
 *  columns → ambiguous; only one kind → that kind; none → none. */
export function germplasmMappingMode(
  mapping: ColumnMapping | null,
): GermplasmMappingMode {
  if (!mapping) return "none"
  let sawAccession = false
  let sawLine = false
  let sawAlias = false
  for (const c of mapping.sheetConfigs) {
    if (c.skipped) continue
    if (c.accessionNameColumn) sawAccession = true
    if (c.lineNameColumn) sawLine = true
    if (c.aliasColumn) sawAlias = true
  }
  if (!sawAccession && !sawLine && !sawAlias) return "none"
  if (sawAlias) return "ambiguous"
  if (sawAccession && sawLine) return "ambiguous"
  if (sawAccession) return "accession-only"
  return "line-only"
}

export function WizardShell() {
  const [step, setStep] = useState(0)
  const [state, setState] = useState<WizardState>({
    files: [],
    detection: null,
    metadata: null,
    columnMapping: null,
    germplasmReview: null,
    uploadResults: null,
  })

  const needsMapping =
    state.detection?.dataCategories.some((c) => c === "csv_tabular") ?? false
  const needsGermplasm =
    needsMapping && germplasmMappingMode(state.columnMapping) === "ambiguous"

  const steps = useMemo(() => {
    const s: { label: string; icon: typeof Search }[] = [
      BASE_STEPS[0],
      BASE_STEPS[1],
    ]
    if (needsMapping) s.push(MAPPING_STEP)
    if (needsGermplasm) s.push(GERMPLASM_STEP)
    s.push(BASE_STEPS[2], BASE_STEPS[3])
    return s
  }, [needsMapping, needsGermplasm])

  // Step indices. Base layout: 0 Detect, 1 Metadata, then optional Mapping,
  // optional Germplasm, then Upload, Confirm.
  const mappingStepIndex = 2
  const germplasmStepIndex = needsMapping ? 3 : -1
  const uploadStepIndex = (needsMapping ? 1 : 0) + (needsGermplasm ? 1 : 0) + 2
  const confirmStepIndex = uploadStepIndex + 1

  const handleDetectNext = useCallback<
    React.ComponentProps<typeof StepDetect>["onNext"]
  >((files, detection) => {
    setState((prev) => ({ ...prev, files, detection }))
    setStep(1)
  }, [])

  const handleMetadataNext = useCallback((metadata: ImportMetadata) => {
    setState((prev) => ({ ...prev, metadata }))
    setStep(2)
  }, [])

  const handleMappingNext = useCallback((mapping: ColumnMapping) => {
    setState((prev) => ({
      ...prev,
      columnMapping: mapping,
      germplasmReview: null,
    }))
    // Step 3 is either germplasm review or upload depending on whether
    // the mapping's germplasm columns are ambiguous.
    setStep(3)
  }, [])

  const handleGermplasmNext = useCallback((review: GermplasmReview) => {
    setState((prev) => ({ ...prev, germplasmReview: review }))
    setStep(4)
  }, [])

  const handleUploadNext = useCallback(
    (results: UploadResults) => {
      setState((prev) => ({ ...prev, uploadResults: results }))
      setStep(confirmStepIndex)
    },
    [confirmStepIndex],
  )

  const reset = useCallback(() => {
    setState({
      files: [],
      detection: null,
      metadata: null,
      columnMapping: null,
      germplasmReview: null,
      uploadResults: null,
    })
    setStep(0)
  }, [])

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
      <GenomicWizardStub
        files={state.files}
        detection={state.detection}
        onExit={reset}
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

      {step === 0 && <StepDetect onNext={handleDetectNext} />}

      {step === 1 && state.detection && (
        <StepMetadataStub
          detection={state.detection}
          initial={state.metadata}
          onNext={handleMetadataNext}
          onBack={() => handleBack(0)}
        />
      )}

      {needsMapping &&
        step === mappingStepIndex &&
        state.detection &&
        state.metadata && (
          <StepColumnMappingStub
            files={state.files}
            initial={state.columnMapping}
            onNext={handleMappingNext}
            onBack={() => handleBack(1)}
          />
        )}

      {needsGermplasm &&
        step === germplasmStepIndex &&
        state.columnMapping &&
        state.metadata && (
          <StepGermplasmReviewStub
            mapping={state.columnMapping}
            metadata={state.metadata}
            initial={state.germplasmReview}
            onNext={handleGermplasmNext}
            onBack={() => handleBack(mappingStepIndex)}
          />
        )}

      {step === uploadStepIndex && state.detection && state.metadata && (
        <StepUploadStub
          files={state.files}
          detection={state.detection}
          metadata={state.metadata}
          columnMapping={state.columnMapping}
          germplasmReview={state.germplasmReview}
          onNext={handleUploadNext}
          onBack={() =>
            handleBack(
              needsGermplasm
                ? germplasmStepIndex
                : needsMapping
                  ? mappingStepIndex
                  : 1,
            )
          }
        />
      )}

      {step === confirmStepIndex && state.uploadResults && (
        <StepConfirm results={state.uploadResults} onDone={reset} />
      )}
    </div>
  )
}
