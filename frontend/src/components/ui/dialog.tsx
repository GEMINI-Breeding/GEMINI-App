import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Workaround for radix-ui/primitives#1241: Dialog leaks `pointer-events:
 * none` and `data-scroll-locked` on `<body>` when it closes (especially
 * mid-animation, or when multiple modals interact). The leak makes the
 * page unclickable until the next user interaction unsticks it.
 *
 * `useDialogBodyUnlock` watches the dialog's `open` prop and, on every
 * close, schedules a body-style restore after the close animation
 * settles. We do this from the Dialog wrapper so every consumer of this
 * primitive (AddUser, EditUser, DeleteUser, ReferenceDataUploadDialog,
 * etc.) gets the fix without code changes.
 *
 * The check is conservative: we only clear if no other Radix modal is
 * still open (matched by `body[data-scroll-locked]` plus any element
 * with `data-state="open"` and `role="dialog"`).
 */
function useDialogBodyUnlock(
  open: boolean | undefined,
  defaultOpen: boolean | undefined,
) {
  const wasOpenRef = React.useRef(open ?? defaultOpen ?? false)
  React.useEffect(() => {
    const wasOpen = wasOpenRef.current
    const isOpen = open ?? wasOpen
    // Update before any early-return so subsequent transitions see the
    // current state.
    wasOpenRef.current = isOpen
    if (!wasOpen || isOpen) return // act only on open → closed transitions

    let cancelled = false
    const cleanup = () => {
      if (cancelled) return
      // Don't fight a still-open modal. Radix sometimes nests dialogs;
      // restore only when nothing else is asking the body to be locked.
      const stillOpen = document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-state="open"][data-radix-popper-content-wrapper]',
      )
      if (stillOpen) return
      const body = document.body
      if (body.style.pointerEvents === "none") {
        body.style.pointerEvents = ""
      }
      if (body.dataset.scrollLocked != null) {
        delete body.dataset.scrollLocked
      }
    }
    // Run twice: once after Radix's animation duration, again on the next
    // frame in case the cleanup fires after our timer.
    const t1 = setTimeout(cleanup, 250)
    const t2 = setTimeout(cleanup, 600)
    return () => {
      cancelled = true
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [open])
}

function Dialog({
  open,
  defaultOpen,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  useDialogBodyUnlock(open, defaultOpen)
  return (
    <DialogPrimitive.Root
      data-slot="dialog"
      open={open}
      defaultOpen={defaultOpen}
      {...props}
    />
  )
}

/**
 * Shared safety policy for any modal that hosts non-trivial work
 * (forms, multi-step wizards, in-flight uploads). Click-outside +
 * Escape are SUPPRESSED by default — the dialog can only be dismissed
 * via its explicit "X" close button (or a programmatic close).
 *
 * Two opt-outs:
 *   - Pass `dismissOnOutsideClick` to allow click-outside / Escape
 *     dismissal (e.g. tooltip-style popovers — rare for our usage).
 *   - Pass `busy` to additionally guard the "X" button: a click while
 *     busy=true triggers a `window.confirm("…")` and dismisses only on
 *     OK. Use for dialogs that have in-flight work the user could
 *     unintentionally orphan (uploads, imports, ingest steps).
 *
 * Note: this changes the default UX globally. Consumers that
 * previously relied on click-outside dismissal must explicitly opt in
 * via `dismissOnOutsideClick`.
 */
const BUSY_CLOSE_MESSAGE =
  "An operation is still in progress. Closing now may leave it partially complete. Close anyway?"

interface DialogPolicyContextShape {
  busy: boolean
}
const DialogPolicyContext = React.createContext<DialogPolicyContextShape>({
  busy: false,
})

export function useDialogBusyConfirm(): (intent: () => void) => void {
  const { busy } = React.useContext(DialogPolicyContext)
  return React.useCallback(
    (intent) => {
      if (busy && !window.confirm(BUSY_CLOSE_MESSAGE)) return
      intent()
    },
    [busy],
  )
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

interface DialogContentExtras {
  showCloseButton?: boolean
  /** Allow click-outside / Escape to dismiss the dialog. Default false:
   *  the dialog can only be closed via the X button or programmatically.
   *  Set true for tooltip-style popovers that should auto-dismiss. */
  dismissOnOutsideClick?: boolean
  /** When true, the X button click (and any future programmatic-close
   *  routed through `useDialogBusyConfirm`) prompts the user before
   *  closing. Use while in-flight work is happening that the user
   *  could orphan by closing the dialog. */
  busy?: boolean
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  dismissOnOutsideClick = false,
  busy = false,
  onPointerDownOutside,
  onEscapeKeyDown,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> &
  DialogContentExtras) {
  const handlePointerDownOutside: React.ComponentProps<
    typeof DialogPrimitive.Content
  >["onPointerDownOutside"] = (e) => {
    if (!dismissOnOutsideClick) {
      e.preventDefault()
      return
    }
    onPointerDownOutside?.(e)
  }
  const handleEscapeKeyDown: React.ComponentProps<
    typeof DialogPrimitive.Content
  >["onEscapeKeyDown"] = (e) => {
    if (!dismissOnOutsideClick) {
      e.preventDefault()
      return
    }
    onEscapeKeyDown?.(e)
  }
  const handleInteractOutside: React.ComponentProps<
    typeof DialogPrimitive.Content
  >["onInteractOutside"] = (e) => {
    if (!dismissOnOutsideClick) {
      e.preventDefault()
      return
    }
    onInteractOutside?.(e)
  }

  return (
    <DialogPolicyContext.Provider value={{ busy }}>
      <DialogPortal data-slot="dialog-portal">
        <DialogOverlay />
        <DialogPrimitive.Content
          data-slot="dialog-content"
          onPointerDownOutside={handlePointerDownOutside}
          onEscapeKeyDown={handleEscapeKeyDown}
          onInteractOutside={handleInteractOutside}
          className={cn(
            "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
            className,
          )}
          {...props}
        >
          {children}
          {showCloseButton && <BusyAwareCloseButton busy={busy} />}
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPolicyContext.Provider>
  )
}

/** The X button. Stops the default close path when `busy=true` and the
 *  user declines the confirm prompt; otherwise lets Radix's <Close>
 *  propagate normally so controlled + uncontrolled dialogs both work. */
function BusyAwareCloseButton({ busy }: { busy: boolean }) {
  return (
    <DialogPrimitive.Close
      data-slot="dialog-close"
      onClick={(e) => {
        if (busy && !window.confirm(BUSY_CLOSE_MESSAGE)) {
          // Cancel the close: the user said "no, keep working".
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
    >
      <XIcon />
      <span className="sr-only">Close</span>
    </DialogPrimitive.Close>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
