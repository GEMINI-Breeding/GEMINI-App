/**
 * Add/Edit dialog for a Genotyping Study.
 *
 * Reuses the admin EntityForm primitive so the JSON `study_info` field gets
 * the same parse-on-submit semantics as every other entity that carries an
 * info-blob column.
 *
 * Phase 9a only deals with the three editable fields (study_name,
 * study_info, experiment_name). Records / variants / GWAS submissions live
 * on the StudyDetail page in 9b–9d.
 */
import { useEffect, useState } from "react"

import type {
  GenotypingStudyInput,
  GenotypingStudyOutput,
  GenotypingStudyUpdate,
} from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { EntityForm } from "@/features/admin/components/EntityForm"
import { parseInfoField } from "@/features/admin/lib/ids"
import type { EntityField } from "@/features/admin/lib/types"

const FIELDS: EntityField<GenotypingStudyInput>[] = [
  { key: "study_name", label: "Study name", type: "text", required: true },
  {
    key: "experiment_name",
    label: "Linked experiment (optional)",
    type: "text",
    description:
      "Name of an existing experiment to associate this study with. Leave blank to create the study unlinked.",
  },
  {
    key: "study_info",
    label: "Info (JSON)",
    type: "json",
    description: "Free-form metadata stored alongside the study.",
  },
]

function inputForRow(row: GenotypingStudyOutput | null): GenotypingStudyInput {
  if (!row) return { study_name: "" }
  return {
    study_name: row.study_name ?? "",
    study_info: row.study_info ?? undefined,
    // Output type omits experiment_name; Edit dialog leaves the field blank
    // (omitting it from the PATCH body keeps the existing association).
  }
}

function normalize(input: GenotypingStudyInput): GenotypingStudyInput {
  return {
    ...input,
    study_info: parseInfoField(
      input.study_info,
    ) as GenotypingStudyInput["study_info"],
    experiment_name:
      typeof input.experiment_name === "string" &&
      input.experiment_name.trim() === ""
        ? undefined
        : input.experiment_name,
  }
}

export type StudyFormDialogProps = {
  /** When non-null, dialog is open in Add (editing=null) or Edit mode. */
  mode: "add" | "edit" | null
  editing: GenotypingStudyOutput | null
  onClose: () => void
  onSubmitCreate: (input: GenotypingStudyInput) => void
  onSubmitUpdate: (
    row: GenotypingStudyOutput,
    input: GenotypingStudyUpdate,
  ) => void
  isPending: boolean
}

export function StudyFormDialog({
  mode,
  editing,
  onClose,
  onSubmitCreate,
  onSubmitUpdate,
  isPending,
}: StudyFormDialogProps) {
  const [value, setValue] = useState<GenotypingStudyInput>(() =>
    inputForRow(editing),
  )

  // Re-seed on mode/editing change so the form always reflects the row
  // the user clicked rather than the previous one.
  useEffect(() => {
    if (mode === null) return
    setValue(inputForRow(editing))
  }, [mode, editing])

  const open = mode !== null
  const isEdit = mode === "edit" && editing !== null

  function handleSubmit() {
    const normalized = normalize(value)
    if (isEdit && editing) {
      const update: GenotypingStudyUpdate = {
        study_name: normalized.study_name,
        study_info: normalized.study_info,
      }
      onSubmitUpdate(editing, update)
    } else {
      onSubmitCreate(normalized)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit study" : "Add genotyping study"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the name or info JSON. Clearing 'Linked experiment' is not supported via this form."
              : "Create a new study container. Records and variants are uploaded later from the study's detail page."}
          </DialogDescription>
        </DialogHeader>
        <EntityForm
          id="genotyping-study-form"
          fields={
            isEdit ? FIELDS.filter((f) => f.key !== "experiment_name") : FIELDS
          }
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            form="genotyping-study-form"
            type="submit"
            disabled={isPending}
            data-testid="genotyping-study-save"
          >
            {isPending ? "Saving…" : isEdit ? "Save changes" : "Create study"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
