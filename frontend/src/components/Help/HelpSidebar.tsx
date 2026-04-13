/**
 * HelpSidebar — right-side help panel
 *
 * Shows contextual bullet points for the current route section and links to
 * the full documentation. Also houses the "Start Tour" button that triggers
 * the onboarding spotlight.
 */

import { BookOpen, ExternalLink, PlayCircle, X } from "lucide-react"
import { useLocation } from "@tanstack/react-router"
import { openUrl } from "@/lib/platform"
import { getTourSection } from "./tourSteps"

const DOCS_BASE = "https://gemini-breeding.github.io"

interface Section {
  title: string
  docPath: string
  bullets: string[]
}

const SECTIONS: Record<string, Section> = {
  "/": {
    title: "Dashboard",
    docPath: "/app_guide/dashboard/",
    bullets: [
      "Drag widgets from the left toolbox onto the canvas",
      "Available widgets: KPI cards, charts, tables, and plot viewers",
      "Configure each widget's data source, metric, and chart type",
      "Add multiple tabs to organise different views of your data",
      "Data refreshes automatically — no re-processing needed",
    ],
  },
  "/files": {
    title: "Files — Upload & Manage",
    docPath: "/app_guide/upload/",
    bullets: [
      "Select a data type before uploading (Images, Logs, Reference Data, etc.)",
      "Fill in Experiment, Location, and Population fields consistently",
      "Drone images auto-fill Date, Platform, and Sensor from EXIF metadata",
      "Use Synced Metadata to attach a GPS CSV to images missing location data",
      "Check the Manage tab after uploading to verify file counts and status",
      "Use View Images to perform a quality check on uploaded imagery",
    ],
  },
  "/process": {
    title: "Process — Pipelines",
    docPath: "/app_guide/aerial_pipeline/",
    bullets: [
      "Create a workspace, then add an aerial or ground pipeline",
      "Aerial: sync data → GCP selection → orthomosaic → plot boundaries → trait extraction",
      "Ground: plot marking (S/E/N keys) → stitching → boundary association → inference",
      "Each step can be re-run independently — earlier results are preserved",
      "Inference models (Roboflow) are optional and configured per pipeline",
      "Reference datasets can be associated with a workspace from the workspace detail page",
    ],
  },
  "/analyze": {
    title: "Analyze",
    docPath: "/app_guide/analyze/",
    bullets: [
      "Pipeline Runs tab: browse individual runs, inspect plot images with detection overlays",
      "Master Table: merged view across all pipelines and dates for a workspace",
      "Query tab: search and pin plots for side-by-side comparison",
      "Map tab: spatial overlay of orthomosaics, plot boundaries, and trait values",
      "Use the Color By selector to visualise any trait or reference metric on the map",
      "Click the refresh button (↺) to pick up newly completed pipeline runs",
    ],
  },
}

function getSectionForPath(pathname: string): Section {
  if (pathname.startsWith("/files")) return SECTIONS["/files"]
  if (pathname.startsWith("/process")) return SECTIONS["/process"]
  if (pathname.startsWith("/analyze")) return SECTIONS["/analyze"]
  return SECTIONS["/"]
}

interface HelpSidebarProps {
  open: boolean
  onClose: () => void
  onStartTour: () => void
}

export function HelpSidebar({ open, onClose, onStartTour }: HelpSidebarProps) {
  const location = useLocation()
  const section = getSectionForPath(location.pathname)
  const tourLabel = getTourSection(location.pathname, (location.search as any)?.step).label

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        className="fixed right-0 top-0 h-full w-80 z-50 flex flex-col border-l bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold text-sm">Help</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5">
          {/* Section title */}
          <div>
            <h2 className="font-semibold text-sm mb-3">{section.title}</h2>
            <ul className="space-y-2">
              {section.bullets.map((bullet) => (
                <li key={bullet} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="mt-1 shrink-0 h-1.5 w-1.5 rounded-full bg-primary/60" />
                  {bullet}
                </li>
              ))}
            </ul>
          </div>

          {/* Full docs link */}
          <button
            type="button"
            onClick={() => openUrl(`${DOCS_BASE}${section.docPath}`)}
            className="flex items-center gap-2 text-xs text-primary hover:underline w-fit"
          >
            <ExternalLink className="h-3 w-3" />
            Read full documentation
          </button>

          {/* Divider */}
          <div className="border-t" />

          {/* All sections */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">
              All Sections
            </p>
            <div className="space-y-1">
              {Object.entries(SECTIONS).map(([, sec]) => (
                <button
                  key={sec.docPath}
                  type="button"
                  onClick={() => openUrl(`${DOCS_BASE}${sec.docPath}`)}
                  className="flex items-center justify-between w-full px-2 py-1.5 rounded text-xs text-left hover:bg-muted transition-colors"
                >
                  <span>{sec.title}</span>
                  <ExternalLink className="h-3 w-3 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer — Start Tour */}
        <div className="border-t px-4 py-4">
          <button
            type="button"
            onClick={() => { onClose(); onStartTour() }}
            className="flex items-center justify-center gap-2 w-full rounded-lg border px-3 py-2 text-xs font-medium hover:bg-muted transition-colors"
          >
            <PlayCircle className="h-4 w-4 text-primary" />
            Start {tourLabel} Tour
          </button>
        </div>
      </aside>
    </>
  )
}
