/**
 * Hosts the import wizard inside a Dialog launched from the Files →
 * Upload tab. The user picks "Trait Data" or "Genomic Data" from the
 * type dropdown, drops a file, and this dialog opens with the wizard
 * pre-seeded — bypassing the auto-detect StepDetect because the data
 * kind is already known from the dropdown.
 *
 * Detection still has to *run* on the file even though the kind is
 * known: for genomic we need `genomicShape.sampleHeaders` to feed the
 * sample-resolve step (the same `peekSpreadsheet` / VCF-`#CHROM` /
 * HapMap-`rs#` inspection the auto-detect path uses). We just skip
 * `StepDetect`'s UI; the engine itself is the source of truth.
 */
import { Loader2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { EntityChoice } from "@/features/files/components/EntitySelectField"
import { WizardShell } from "@/features/import/components/WizardShell"
import { buildDatasetName } from "@/features/import/lib/datasetName"
import {
  type DetectionResult,
  detectFiles,
} from "@/features/import/lib/detection-engine"
import type { FileWithPath, ImportMetadata } from "@/features/import/lib/types"

export type ImportDataKind = "trait" | "genomic"

interface ImportWizardDialogProps {
  open: boolean
  dataKind: ImportDataKind
  files: File[]
  /** Per-field entity choices captured by the Files page's
   *  DataStructureForm. Mapped into ImportMetadata before the wizard
   *  starts so the wizard can skip its own metadata step. */
  scope: Record<string, EntityChoice>
  /** Free-text values (currently just `date`) from the form. */
  formValues: Record<string, string>
  onClose: () => void
}

const TITLE: Record<ImportDataKind, string> = {
  trait: "Import trait data",
  genomic: "Import genomic data",
}

const DESCRIPTION: Record<ImportDataKind, string> = {
  trait: "Map columns and confirm metadata for the trait CSV.",
  genomic: "Pick the target study and confirm sample resolution.",
}

/** Decorate raw browser File[] with `path` so downstream consumers that
 *  expect `FileWithPath` keep working. We don't have folder structure
 *  here (single-file dropdown-driven entry) so `path === name`. */
function decorate(files: File[]): FileWithPath[] {
  return files.map((f) => {
    const augmented = f as FileWithPath
    if (!augmented.path) augmented.path = f.name
    return augmented
  })
}

/** Pull a name + id out of an EntityChoice. Returns ["", null] for "none". */
function entity(choice: EntityChoice | undefined): {
  name: string
  id: string | null
  isNew: boolean
} {
  if (!choice || choice.kind === "none") {
    return { name: "", id: null, isNew: false }
  }
  if (choice.kind === "existing") {
    return { name: choice.name, id: choice.id, isNew: false }
  }
  return { name: choice.name, id: null, isNew: true }
}

/** Map the Files-page form state into the wizard's ImportMetadata shape.
 *  Returns undefined if the user hasn't picked an experiment yet — the
 *  wizard will then render its own Metadata step as a fallback. */
function buildInitialMetadata(
  scope: Record<string, EntityChoice>,
  formValues: Record<string, string>,
  dataKind: ImportDataKind,
): ImportMetadata | undefined {
  const experiment = entity(scope.experiment)
  if (!experiment.name) return undefined
  const platform = entity(scope.platform)
  const sensor = entity(scope.sensor)

  // When the wizard launches from the dialog it skips StepMetadata, so
  // we have to fill a sensible default dataset name here. Without it,
  // the trait-record bulk endpoint sees `dataset_name=null` and falls
  // back to `"{trait_name} Dataset None"` (the backend's fallback
  // string interpolation runs before its own collection_date fallback,
  // so the literal "None" lands in the dataset name).
  //
  // Mirrors `defaultDatasetNames` in StepMetadata.tsx for consistency
  // between entry paths. Only treats `formValues.date` as the collection
  // date when the user actually typed one — falling back to "today"
  // would put the upload date in the name, which is misleading.
  const userTypedDate = (formValues.date ?? "").trim() || null
  const category = dataKind === "genomic" ? "genomic" : "csv_tabular"
  const datasetName = buildDatasetName({
    expName: experiment.name,
    category,
    collectionDate: userTypedDate,
  })

  return {
    experimentId: experiment.id,
    experimentName: experiment.name,
    sensorPlatformName: platform.name,
    sensorName: sensor.name,
    datasetNames: [datasetName],
    createNew: {
      experiment: experiment.isNew,
      sensorPlatform: platform.isNew,
      sensor: sensor.isNew,
    },
  }
}

type DetectionState =
  | { phase: "loading" }
  | { phase: "ready"; detection: DetectionResult }
  | { phase: "error"; message: string }

export function ImportWizardDialog({
  open,
  dataKind,
  files,
  scope,
  formValues,
  onClose,
}: ImportWizardDialogProps) {
  const [state, setState] = useState<DetectionState>({ phase: "loading" })
  // Tracked by the wizard's StepIngestGenomic (via onBusyChange) so we
  // can disable overlay-click / ESC dismissal during ingest. Without
  // this, a stray click outside the dialog kills any in-flight POSTs.
  const [isBusy, setIsBusy] = useState(false)
  // Memoise so the effect's deps don't churn on every parent render. The
  // dialog mounts once per file selection so this is just a stable ref.
  const decorated = useMemo(() => decorate(files), [files])
  const initialMetadata = useMemo(
    () => buildInitialMetadata(scope, formValues, dataKind),
    [scope, formValues, dataKind],
  )

  // Run the detection engine on the dropped file. For xlsx, this peeks
  // the first sheet via SheetJS and skips banner rows; for HapMap/VCF
  // it reads the header line. The result populates
  // `genomicShape.sampleHeaders` so the sample-resolve step has real
  // names to pass to the resolver.
  useEffect(() => {
    let cancelled = false
    setState({ phase: "loading" })
    detectFiles(decorated)
      .then((detection) => {
        if (cancelled) return
        // For genomic kind: the engine identified the file but may have
        // tagged it as csv_tabular (e.g., a matrix CSV that didn't pass
        // the IUPAC-ratio threshold). Force the genomic category so
        // WizardShell routes to GenomicWizard. For trait kind, force
        // csv_tabular for the same symmetry.
        const dataCategories =
          dataKind === "genomic"
            ? (["genomic"] as const)
            : (["csv_tabular"] as const)
        // If the engine found no genomic shape (e.g., a malformed xlsx),
        // surface that as an error rather than silently shipping empty
        // sample headers downstream.
        if (dataKind === "genomic" && !detection.genomicShape) {
          setState({
            phase: "error",
            message:
              "Couldn't read the file as a genomic matrix, HapMap, or VCF. Check that the first sheet has a variant-name column plus per-sample columns.",
          })
          return
        }
        setState({
          phase: "ready",
          detection: {
            ...detection,
            dataCategories: [...dataCategories],
            genomicFile:
              dataKind === "genomic"
                ? (detection.genomicFile ?? decorated[0] ?? null)
                : null,
          },
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({
          phase: "error",
          message: err instanceof Error ? err.message : "Detection failed",
        })
      })
    return () => {
      cancelled = true
    }
    // The dropdown selection + the actual File reference determine the
    // run. Depend on the first File (the dialog only handles single-file
    // entries) so re-renders driven by other parent state don't refire
    // detection. The dialog mounts fresh per file selection anyway.
  }, [dataKind, decorated[0]])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent
        // The base DialogContent ships with `sm:max-w-lg` (~512px) +
        // `max-w-[calc(100%-2rem)]`. The `!` modifier wins over both so
        // the wizard's wide tables don't get clipped horizontally.
        className="max-h-[90vh] w-[95vw] !max-w-[95vw] overflow-y-auto"
        data-testid="import-wizard-dialog"
        // The shared `DialogContent` blocks click-outside / Escape
        // dismissal by default; we just pass `busy` so the X-button
        // close prompts the user when ingest is mid-flight.
        busy={isBusy}
      >
        <DialogHeader>
          <DialogTitle>{TITLE[dataKind]}</DialogTitle>
          <p className="text-muted-foreground text-sm">
            {DESCRIPTION[dataKind]}
          </p>
        </DialogHeader>
        {state.phase === "loading" && (
          <div
            className="text-muted-foreground flex items-center gap-2 py-12 text-sm"
            data-testid="import-wizard-detecting"
          >
            <Loader2 className="h-4 w-4 animate-spin" /> Inspecting file…
          </div>
        )}
        {state.phase === "error" && (
          <div
            className="text-destructive py-12 text-sm"
            data-testid="import-wizard-detect-error"
          >
            {state.message}
          </div>
        )}
        {state.phase === "ready" && (
          <WizardShell
            initialFiles={decorated}
            initialDetection={state.detection}
            initialMetadata={initialMetadata}
            onBusyChange={setIsBusy}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
