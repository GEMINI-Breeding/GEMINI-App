"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/**
 * The Sonner toaster wrapper renders as a fixed-positioned `<ol>` at
 * `z-index: 999999999` over the entire bottom-right corner of the
 * viewport. By default the wrapper has `pointer-events: auto`, which
 * silently absorbs clicks on any UI element positioned underneath —
 * even when the toaster is empty (height: 0 still has children with
 * negative offsets, so its hit area extends well above its bounding
 * box). This made any post-toast user interaction in the bottom-right
 * (e.g. table-row action buttons) unclickable until the toast queue
 * cleared.
 *
 * Set `pointer-events: none` on the wrapper itself and let individual
 * toast cards keep their default `pointer-events: auto` so dismiss
 * buttons and "Action" / "Cancel" affordances still work. This is the
 * documented Sonner pattern (https://sonner.emilkowal.ski/docs#toaster
 * — see the toastOptions.classNames section) and matches what most
 * Radix-based design systems ship.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group pointer-events-none"
      toastOptions={{
        classNames: {
          toast: "pointer-events-auto",
        },
      }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
