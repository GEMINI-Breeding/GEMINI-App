/**
 * Genotyping Studies dashboard.
 *
 * Phase 9a: list / create / update / delete + clickable rows that route to
 * the StudyDetail page (`/genotyping/$studyId`). Rows are wrapped in a
 * `Link` so middle-click / cmd-click open in a new tab; per-row Edit and
 * Delete buttons stop click-propagation so they don't navigate.
 */

import { Link } from "@tanstack/react-router"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { idAsString } from "@/features/admin/lib/ids"
import { StudyFormDialog } from "@/features/genotyping/components/StudyFormDialog"
import {
  useCreateGenotypingStudy,
  useDeleteGenotypingStudy,
  useGenotypingStudies,
  useUpdateGenotypingStudy,
} from "@/features/genotyping/hooks/useGenotypingStudies"

function summariseInfo(info: GenotypingStudyOutput["study_info"]): string {
  if (info == null) return ""
  if (typeof info === "string") return info
  try {
    return JSON.stringify(info)
  } catch {
    return String(info)
  }
}

export function StudiesDashboard() {
  const list = useGenotypingStudies()
  const createMut = useCreateGenotypingStudy()
  const updateMut = useUpdateGenotypingStudy()
  const deleteMut = useDeleteGenotypingStudy()

  const [mode, setMode] = useState<"add" | "edit" | null>(null)
  const [editing, setEditing] = useState<GenotypingStudyOutput | null>(null)
  const [deleting, setDeleting] = useState<GenotypingStudyOutput | null>(null)

  function close() {
    setMode(null)
    setEditing(null)
  }

  function handleCreate(input: GenotypingStudyInput) {
    createMut.mutate(input, {
      onSuccess: () => {
        toast.success("Study created")
        close()
      },
      onError: (err: Error) => toast.error(err.message),
    })
  }

  function handleUpdate(
    row: GenotypingStudyOutput,
    input: GenotypingStudyUpdate,
  ) {
    updateMut.mutate(
      { row, input },
      {
        onSuccess: () => {
          toast.success("Study updated")
          close()
        },
        onError: (err: Error) => toast.error(err.message),
      },
    )
  }

  function handleDelete(row: GenotypingStudyOutput) {
    deleteMut.mutate(row, {
      onSuccess: () => {
        toast.success("Study deleted")
        setDeleting(null)
      },
      onError: (err: Error) => toast.error(err.message),
    })
  }

  const rows = list.data ?? []

  return (
    <div className="container max-w-6xl space-y-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Genotyping studies</h1>
          <p className="text-muted-foreground text-sm">
            Containers for genotype matrices and GWAS runs. Open a study to
            ingest records or submit a GWAS job.
          </p>
        </div>
        <Button
          data-testid="genotyping-add-study"
          onClick={() => {
            setEditing(null)
            setMode("add")
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" /> Add study
        </Button>
      </header>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Info</TableHead>
              <TableHead className="w-[120px] text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="text-muted-foreground py-6 text-center text-sm"
                >
                  Loading…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={3}
                  className="text-muted-foreground py-6 text-center text-sm"
                >
                  No studies yet. Click <strong>Add study</strong> to create
                  one.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const id = idAsString(row.id)
                return (
                  <TableRow key={id} data-testid="genotyping-study-row">
                    <TableCell className="font-medium">
                      <Link
                        to="/genotyping/$studyId"
                        params={{ studyId: id }}
                        className="text-primary hover:underline"
                        data-testid="genotyping-study-link"
                      >
                        {row.study_name ?? "(unnamed)"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-md truncate">
                      {summariseInfo(row.study_info)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid="genotyping-study-edit"
                          onClick={() => {
                            setEditing(row)
                            setMode("edit")
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid="genotyping-study-delete"
                          onClick={() => setDeleting(row)}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <StudyFormDialog
        mode={mode}
        editing={editing}
        onClose={close}
        onSubmitCreate={handleCreate}
        onSubmitUpdate={handleUpdate}
        isPending={createMut.isPending || updateMut.isPending}
      />

      <Dialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete study?</DialogTitle>
            <DialogDescription>
              Records and variants attached to this study will become orphaned
              if the backend doesn't cascade. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleting(null)}
              disabled={deleteMut.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              data-testid="genotyping-study-delete-confirm"
              disabled={deleteMut.isPending}
              onClick={() => deleting && handleDelete(deleting)}
            >
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
