/**
 * Shared confirm/destruction dialog. Use this for every irreversible
 * action: delete, drop, remove, discard. Wraps our `Dialog` primitive
 * (which default-blocks click-outside / Escape dismissal — see
 * `dialog.tsx`) and adds a Cancel/Confirm pair plus optional
 * type-the-name verification for higher-stakes deletes.
 *
 * Two ways to use it:
 *
 *   1. **Controlled.** Pass `open` + `onOpenChange`. Best when the
 *      parent already owns the "what am I about to delete" state.
 *
 *   2. **Imperative via `useConfirm()`.** A hook that returns a
 *      `confirm({ ... })` function returning a Promise<boolean>. Drop-in
 *      replacement for `window.confirm`. The hook mounts a single
 *      `<ConfirmDialog>` once at the top of the tree.
 *
 * Either form will REFUSE click-outside dismissal — closing requires an
 * explicit Cancel or X.
 */
import { AlertTriangle } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { cn } from "@/lib/utils"

export interface ConfirmDialogProps {
  /** Controlled-mode open flag. Omit to render an uncontrolled dialog
   *  (you'd usually wire one up via `useConfirm()` instead). */
  open?: boolean
  /** Controlled-mode open setter. Required when `open` is set. */
  onOpenChange?: (next: boolean) => void

  /** Dialog title. Default: "Are you sure?" */
  title?: React.ReactNode
  /** Body text or rich children. */
  description?: React.ReactNode

  /** Confirm-button label. Default: "Confirm". */
  confirmLabel?: string
  /** Cancel-button label. Default: "Cancel". */
  cancelLabel?: string

  /** Visual + semantic variant. `destructive` (default) renders the
   *  Confirm button red and shows a warning icon. */
  variant?: "destructive" | "default"

  /** When set, the user must type this exact string into a text input
   *  before the Confirm button enables. Use for the highest-stakes
   *  deletes (e.g. drop an entire experiment). */
  requireTypedName?: string

  /** Set true while the underlying mutation is in flight. Disables both
   *  buttons + shows a spinner on Confirm. */
  loading?: boolean

  /** Called when the user clicks Confirm. The dialog stays open until
   *  the parent flips `open` to false (or, in `useConfirm()`, until the
   *  returned promise resolves). */
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title = "Are you sure?",
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "destructive",
  requireTypedName,
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = React.useState("")

  // Clear the typed input every time the dialog opens so a previous
  // typed value doesn't leak across openings.
  React.useEffect(() => {
    if (open) setTyped("")
  }, [open])

  const typedOk = !requireTypedName || typed.trim() === requireTypedName

  const handleConfirm = async () => {
    if (loading) return
    if (!typedOk) return
    await onConfirm()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // Modest cap — confirmation dialogs are short, don't need the
        // wizard's full-width override.
        className="sm:max-w-md"
        data-testid="confirm-dialog"
      >
        <DialogHeader>
          <div className="flex items-start gap-3">
            {variant === "destructive" && (
              <AlertTriangle
                className="text-destructive mt-0.5 h-5 w-5 shrink-0"
                aria-hidden
              />
            )}
            <DialogTitle data-testid="confirm-dialog-title">
              {title}
            </DialogTitle>
          </div>
          {description && (
            <DialogDescription data-testid="confirm-dialog-description">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>

        {requireTypedName && (
          <div className="space-y-2">
            <Label htmlFor="confirm-typed">
              Type{" "}
              <code className="bg-muted rounded px-1 py-0.5 text-xs">
                {requireTypedName}
              </code>{" "}
              to confirm
            </Label>
            <Input
              id="confirm-typed"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={requireTypedName}
              autoComplete="off"
              autoFocus
              disabled={loading}
              data-testid="confirm-dialog-typed"
            />
          </div>
        )}

        <DialogFooter className="mt-2">
          <DialogClose asChild>
            <Button
              variant="outline"
              disabled={loading}
              data-testid="confirm-dialog-cancel"
            >
              {cancelLabel}
            </Button>
          </DialogClose>
          <LoadingButton
            variant={variant === "destructive" ? "destructive" : "default"}
            loading={loading}
            disabled={!typedOk || loading}
            onClick={handleConfirm}
            data-testid="confirm-dialog-confirm"
            className={cn(variant === "destructive" && "")}
          >
            {confirmLabel}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// useConfirm() — imperative API. Returns a `confirm({...})` function that
// resolves to true (user confirmed) or false (user cancelled / closed).
// ---------------------------------------------------------------------------

interface ConfirmRequest
  extends Omit<ConfirmDialogProps, "open" | "onOpenChange" | "onConfirm" | "loading"> {
  /** Optional async work to run after the user clicks Confirm. While
   *  this promise is pending the dialog stays open with the buttons
   *  disabled + a spinner on Confirm. Reject to keep the dialog open
   *  with an error you've toasted yourself. */
  action?: () => void | Promise<void>
}

interface ConfirmContextShape {
  request: (req: ConfirmRequest) => Promise<boolean>
}

const ConfirmContext = React.createContext<ConfirmContextShape | null>(null)

/**
 * Provider. Mount once at the top of the tree (e.g. in `AppProviders`).
 * Every descendant can then `const confirm = useConfirm()` and `await
 * confirm({ title, description, ... })`.
 */
export function ConfirmDialogProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [state, setState] = React.useState<{
    open: boolean
    req: ConfirmRequest | null
    loading: boolean
    resolver: ((v: boolean) => void) | null
  }>({ open: false, req: null, loading: false, resolver: null })

  const request = React.useCallback(
    (req: ConfirmRequest) =>
      new Promise<boolean>((resolve) => {
        setState({ open: true, req, loading: false, resolver: resolve })
      }),
    [],
  )

  const finish = (result: boolean) => {
    setState((s) => {
      s.resolver?.(result)
      return { open: false, req: null, loading: false, resolver: null }
    })
  }

  const handleOpenChange = (next: boolean) => {
    if (next) return // open is only set by `request`
    if (state.loading) return // mid-action, ignore X / Cancel
    finish(false)
  }

  const handleConfirm = async () => {
    if (!state.req) return
    const action = state.req.action
    if (!action) {
      finish(true)
      return
    }
    setState((s) => ({ ...s, loading: true }))
    try {
      await action()
      finish(true)
    } catch {
      // Caller is responsible for surfacing the error (toast, etc.).
      // Close the dialog and resolve false so chained code knows the
      // action didn't go through.
      finish(false)
    }
  }

  return (
    <ConfirmContext.Provider value={{ request }}>
      {children}
      <ConfirmDialog
        open={state.open}
        onOpenChange={handleOpenChange}
        loading={state.loading}
        onConfirm={handleConfirm}
        title={state.req?.title}
        description={state.req?.description}
        confirmLabel={state.req?.confirmLabel}
        cancelLabel={state.req?.cancelLabel}
        variant={state.req?.variant}
        requireTypedName={state.req?.requireTypedName}
      />
    </ConfirmContext.Provider>
  )
}

/**
 * Imperative confirm. Returns a function that opens a confirm dialog
 * and resolves to true/false based on the user's choice.
 *
 *   const confirm = useConfirm()
 *   const ok = await confirm({
 *     title: "Delete experiment?",
 *     description: "This permanently removes the experiment, its plots,
 *       trait records, and uploaded files. This cannot be undone.",
 *     confirmLabel: "Delete experiment",
 *     requireTypedName: experiment.name,
 *   })
 *   if (!ok) return
 */
export function useConfirm(): (req: ConfirmRequest) => Promise<boolean> {
  const ctx = React.useContext(ConfirmContext)
  if (!ctx) {
    throw new Error(
      "useConfirm() must be used inside <ConfirmDialogProvider>",
    )
  }
  return ctx.request
}
