/**
 * EXPAND UTILITY — Reusable fullscreen expand capability for any section.
 *
 * Use this throughout the app whenever a section needs an "expand to fullscreen" button.
 * Import from "@/components/Common/ExpandableSection".
 *
 * Exports:
 *   useExpandable()       → { isExpanded, open, close }
 *   <ExpandButton />      → small icon button with the Expand icon
 *   <FullscreenModal />   → full-viewport overlay rendered via React portal
 *
 * Quick usage:
 *   const exp = useExpandable()
 *   <>
 *     <ExpandButton onClick={exp.open} />
 *     <FullscreenModal open={exp.isExpanded} onClose={exp.close} title="Section Name">
 *       <MyContent />
 *     </FullscreenModal>
 *   </>
 *
 * The modal renders its children via createPortal into document.body so it is
 * always on top of everything (z-50). Children still belong to the same React
 * component tree, so they share state with the parent component.
 */

import { useState } from "react"
import { createPortal } from "react-dom"
import { Expand, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useExpandable() {
  const [isExpanded, setIsExpanded] = useState(false)
  return {
    isExpanded,
    open: () => setIsExpanded(true),
    close: () => setIsExpanded(false),
  }
}

// ── Expand button ─────────────────────────────────────────────────────────────

interface ExpandButtonProps {
  onClick: () => void
  title?: string
  className?: string
}

export function ExpandButton({ onClick, title = "Expand to fullscreen", className }: ExpandButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-7 w-7", className)}
      onClick={onClick}
      title={title}
    >
      <Expand className="h-4 w-4" />
    </Button>
  )
}

// ── Fullscreen modal ──────────────────────────────────────────────────────────

interface FullscreenModalProps {
  open: boolean
  onClose: () => void
  /** Optional title shown in the modal header bar */
  title?: string
  children: React.ReactNode
  /** Extra content rendered to the right of the title (e.g. action buttons) */
  headerExtra?: React.ReactNode
}

export function FullscreenModal({
  open,
  onClose,
  title,
  children,
  headerExtra,
}: FullscreenModalProps) {
  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-background flex flex-col"
      role="dialog"
      aria-modal="true"
    >
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b flex-shrink-0">
        {title && <h2 className="text-sm font-semibold">{title}</h2>}
        {headerExtra && <div className="flex-1 min-w-0">{headerExtra}</div>}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 ml-auto shrink-0"
          onClick={onClose}
          title="Close fullscreen"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 min-h-0 overflow-auto">
        {children}
      </div>
    </div>,
    document.body,
  )
}
