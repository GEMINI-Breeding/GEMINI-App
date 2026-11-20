/**
 * AdminEntityPage — generic CRUD page driven by an EntityConfig.
 *
 * Renders:
 *   - a header with "Add {singular}" trigger,
 *   - a TanStack Table over `config.list()`,
 *   - per-row Edit / Delete buttons,
 *   - shared Add/Edit dialog (EntityForm),
 *   - a delete-confirm dialog.
 *
 * This is the only page that knows how to talk to the table + dialogs;
 * each of the 12+ Phase-11 entities reduces to a single `<AdminEntityPage
 * config={...} />` instance.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { useMemo, useState } from "react"

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
import { EntityForm } from "@/features/admin/components/EntityForm"
import type { EntityConfig, EntityField } from "@/features/admin/lib/types"
import useCustomToast from "@/hooks/useCustomToast"

function defaultFormatCell(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

export function AdminEntityPage<
  TOutput extends object,
  TInput extends Record<string, unknown>,
>({ config }: { config: EntityConfig<TOutput, TInput> }) {
  const qc = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const list = useQuery<TOutput[], Error>({
    queryKey: config.queryKey,
    queryFn: config.list,
  })

  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editing, setEditing] = useState<TOutput | null>(null)
  const [deleting, setDeleting] = useState<TOutput | null>(null)
  const [formValue, setFormValue] = useState<TInput>(() => config.emptyInput())

  // Resolve any optionsHook once at the page level so the form sees a flat
  // options array.
  const fieldsResolved: EntityField<TInput>[] = config.fields.map((f) => {
    if (f.type !== "select" || !f.optionsHook) return f
    return { ...f, options: f.optionsHook(), optionsHook: undefined }
  })

  const createMutation = useMutation({
    mutationFn: (input: TInput) => config.create(input),
    onSuccess: () => {
      showSuccessToast(`${config.singular} created`)
      setIsAddOpen(false)
      setFormValue(config.emptyInput())
      qc.invalidateQueries({ queryKey: config.queryKey })
    },
    onError: (err: Error) => showErrorToast(err.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ row, input }: { row: TOutput; input: TInput }) =>
      config.update(row, input),
    onSuccess: () => {
      showSuccessToast(`${config.singular} updated`)
      setEditing(null)
      qc.invalidateQueries({ queryKey: config.queryKey })
    },
    onError: (err: Error) => showErrorToast(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (row: TOutput) => config.delete(row),
    onSuccess: () => {
      showSuccessToast(`${config.singular} deleted`)
      setDeleting(null)
      qc.invalidateQueries({ queryKey: config.queryKey })
    },
    onError: (err: Error) => showErrorToast(err.message),
  })

  const columns = useMemo<ColumnDef<TOutput>[]>(() => {
    const fieldCols: ColumnDef<TOutput>[] = config.fields
      .filter((f) => !f.tableHidden)
      .map((f) => ({
        id: f.key,
        header: f.label,
        accessorFn: (row: TOutput) => (row as Record<string, unknown>)[f.key],
        cell: ({ getValue }) =>
          (f.formatCell ?? defaultFormatCell)(getValue() as unknown),
      }))
    const actionsCol: ColumnDef<TOutput> = {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            data-testid="entity-edit"
            onClick={() => {
              setEditing(row.original)
              setFormValue(config.toInput(row.original))
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            data-testid="entity-delete"
            onClick={() => setDeleting(row.original)}
          >
            <Trash2 className="h-4 w-4 text-red-600" />
          </Button>
        </div>
      ),
    }
    return [...fieldCols, actionsCol]
  }, [config])

  const table = useReactTable({
    data: list.data ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: 50 } },
  })

  return (
    <div className="container max-w-6xl space-y-4 px-4 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{config.plural}</h1>
          <p className="text-muted-foreground text-sm">
            Create, edit, and delete {config.plural.toLowerCase()}.
          </p>
        </div>
        <Button
          data-testid="entity-add"
          onClick={() => {
            setFormValue(config.emptyInput())
            setIsAddOpen(true)
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" /> Add{" "}
          {config.singular.toLowerCase()}
        </Button>
      </header>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {h.isPlaceholder
                      ? null
                      : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {list.isLoading ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-muted-foreground py-6 text-center text-sm"
                >
                  Loading…
                </TableCell>
              </TableRow>
            ) : (list.data ?? []).length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-muted-foreground py-6 text-center text-sm"
                >
                  No {config.plural.toLowerCase()} yet.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add {config.singular.toLowerCase()}</DialogTitle>
            <DialogDescription>
              Fill in the fields below. Required fields are marked with *.
            </DialogDescription>
          </DialogHeader>
          <EntityForm
            id="entity-add-form"
            fields={fieldsResolved}
            value={formValue}
            onChange={setFormValue}
            onSubmit={() => createMutation.mutate(formValue)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>
              Cancel
            </Button>
            <Button
              form="entity-add-form"
              type="submit"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {config.singular.toLowerCase()}</DialogTitle>
          </DialogHeader>
          {editing !== null && (
            <EntityForm
              id="entity-edit-form"
              fields={fieldsResolved}
              value={formValue}
              onChange={setFormValue}
              onSubmit={() =>
                updateMutation.mutate({ row: editing, input: formValue })
              }
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              form="entity-edit-form"
              type="submit"
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {config.singular.toLowerCase()}?</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              data-testid="entity-delete-confirm"
              disabled={deleteMutation.isPending}
              onClick={() => deleting && deleteMutation.mutate(deleting)}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
