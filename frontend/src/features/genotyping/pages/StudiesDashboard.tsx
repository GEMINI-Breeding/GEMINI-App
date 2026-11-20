/**
 * Genotyping landing page: one card per study (marker data set), with its
 * latest GWAS results as the picture, like the Process workspaces. A card
 * opens the study; Edit / Delete are in its corner menu.
 */

import { Link } from "@tanstack/react-router"
import { Dna, Plus } from "lucide-react"
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
import { idAsString } from "@/features/admin/lib/ids"
import { StudyCard } from "@/features/genotyping/components/StudyCard"
import { StudyFormDialog } from "@/features/genotyping/components/StudyFormDialog"
import {
  useCreateGenotypingStudy,
  useDeleteGenotypingStudy,
  useGenotypingStudies,
  useUpdateGenotypingStudy,
} from "@/features/genotyping/hooks/useGenotypingStudies"

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
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Genotyping</h1>
          <p className="text-muted-foreground">
            Marker data for your lines, and genome-wide association (GWAS) of
            measured traits against it.
          </p>
        </div>
        <Button
          data-testid="genotyping-add-study"
          onClick={() => {
            setEditing(null)
            setMode("add")
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" /> New study
        </Button>
      </header>

      {list.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-muted h-56 animate-pulse rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-20 text-center">
          <Dna className="text-muted-foreground h-10 w-10" />
          <p className="font-medium">No marker data yet</p>
          <p className="text-muted-foreground max-w-md text-sm">
            Bring a marker file in (HapMap, VCF, CSV or Excel) through{" "}
            <Link to="/files" className="text-primary hover:underline">
              Files → Upload → Genomic Data
            </Link>
            , or ask the agent to import one.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <StudyCard
              key={idAsString(row.id)}
              study={row}
              onEdit={(s) => {
                setEditing(s)
                setMode("edit")
              }}
              onDelete={setDeleting}
            />
          ))}
        </div>
      )}

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
              This removes the study and its marker data from the app. Its GWAS
              runs stay listed until you delete them. This cannot be undone.
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
