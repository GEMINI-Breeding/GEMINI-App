export interface TourStep {
  id: string
  title: string
  description: string
  /** CSS selector for the element to spotlight. null = centered modal (no highlight). */
  selector: string | null
  /** Navigate to this route before showing the step. */
  route?: string
}

export interface TourSection {
  label: string
  steps: TourStep[]
}

export const TOUR_SECTIONS: Record<string, TourSection> = {
  "/files": {
    label: "Files",
    steps: [
      {
        id: "files",
        title: "Files — Upload & Manage",
        description:
          "This section covers uploading and managing your data. Use the Upload tab to add new files and the Manage tab to verify what's been stored.",
        selector: '[data-onboarding="nav-files"]',
        route: "/files",
      },
      {
        id: "files-upload-tab",
        title: "Upload Tab",
        description:
          "The Upload tab is where you add new data. You'll see a file type selector, a metadata form, and a file drop zone.",
        selector: '[data-onboarding="files-tab-upload"]',
        route: "/files",
      },
      {
        id: "files-data-type",
        title: "1. Select a File Type",
        description:
          "Always pick a data type first — Images, Amiga Logs, Orthomosaic, Reference Data, etc. The form fields and allowed file extensions update automatically based on your selection.",
        selector: '[data-onboarding="files-data-type-selector"]',
        route: "/files",
      },
      {
        id: "files-data-structure",
        title: "2. Fill in the Metadata",
        description:
          "Enter Experiment, Location, Population, and Date to organise your data. Use consistent names across uploads — these become your filter keys in Analyze and the Dashboard. Drone images auto-fill Date, Platform, and Sensor from EXIF.",
        selector: '[data-onboarding="files-data-structure-form"]',
        route: "/files",
      },
      {
        id: "files-upload-zone",
        title: "3. Select & Upload Files",
        description:
          "Drag files onto the drop zone or click to browse. Selected files appear in a collapsible list — preview any file before uploading. Click Upload to copy files into the GEMI data store.",
        selector: '[data-onboarding="files-upload-zone"]',
        route: "/files",
      },
      {
        id: "files-manage-tab",
        title: "Manage Tab — Verify Uploads",
        description:
          "Switch to Manage to see all uploaded files in a table. Filter by data type, search by name, and click Refresh to sync with the server after background uploads complete.",
        selector: '[data-onboarding="files-tab-manage"]',
        route: "/files",
      },
    ],
  },

  "/process": {
    label: "Process",
    steps: [
      {
        id: "process",
        title: "Process — Pipelines",
        description:
          "This section covers creating workspaces and running aerial or ground pipelines on your uploaded data.",
        selector: '[data-onboarding="nav-process"]',
        route: "/process",
      },
      {
        id: "process-new-workspace",
        title: "Create a Workspace",
        description:
          "A workspace groups all the pipelines for a single field experiment — aerial and ground runs, plot boundaries, and trait extractions all live under one workspace. Click here to create your first one.",
        selector: '[data-onboarding="process-new-workspace"]',
        route: "/process",
      },
    ],
  },

  "/process/workspace": {
    label: "Process",
    steps: [
      {
        id: "process-workspace-pipelines",
        title: "Create a New Pipeline",
        description:
          "Select a pipeline that suits your data extraction needs — Aerial for drone imagery (orthomosaic → traits) or Ground for Amiga rover data (stitching → traits). Click either card to configure and create it.",
        selector: '[data-onboarding="process-pipeline-cards"]',
      },
      {
        id: "process-new-run",
        title: "Add a Run",
        description:
          "Once a pipeline exists, click New Run to start a field data collection run. Each run corresponds to a single date of data — you can have multiple runs per pipeline to track changes over time.",
        selector: '[data-onboarding="process-new-run"]',
      },
    ],
  },

  "/analyze": {
    label: "Analyze",
    steps: [
      {
        id: "analyze",
        title: "Analyze — View Results",
        description:
          "This section covers exploring processed data. Pipeline Runs shows individual runs, Master Table merges all pipelines, Query lets you compare plots side-by-side, and Map shows spatial overlays.",
        selector: '[data-onboarding="nav-analyze"]',
        route: "/analyze",
      },
    ],
  },

  "/": {
    label: "Dashboard",
    steps: [
      {
        id: "home",
        title: "Home — Dashboard",
        description:
          "Build a custom dashboard with KPI cards, charts, tables, and plot viewers — all pulling from your processed data without re-running any pipelines.",
        selector: '[data-onboarding="nav-home"]',
        route: "/",
      },
    ],
  },
}

TOUR_SECTIONS["/process/plot-boundary-prep"] = {
  label: "Plot Boundary Prep",
  steps: [
    {
      id: "pbp-field-design",
      title: "Field Design",
      description:
        "Upload your field design CSV here. It maps row/column coordinates to plot IDs and accession labels — required before you can generate the plot grid. Once loaded, it shows a row × column count.",
      selector: '[data-onboarding="pbp-field-design"]',
    },
    {
      id: "pbp-instructions",
      title: "Instructions",
      description:
        "Expand this panel for a step-by-step guide and a keyboard shortcut reference. Covers drawing the boundary, generating the grid, adjusting positions, and saving.",
      selector: '[data-onboarding="pbp-instructions"]',
    },
    {
      id: "pbp-map",
      title: "Map — Draw the Field Boundary",
      description:
        "Use the polygon tool (⬠) in the top-left toolbar to draw the outer boundary of your field. Click to add vertices, double-click to finish. The plot grid is generated inside this boundary.",
      selector: '[data-onboarding="pbp-map"]',
    },
    {
      id: "pbp-grid-inputs",
      title: "Plot Dimensions",
      description:
        "Set the width, length, row count, column count, and spacing for each plot. These values define the shape and layout of the auto-generated grid.",
      selector: '[data-onboarding="pbp-grid-inputs"]',
    },
    {
      id: "pbp-angle",
      title: "Grid Angle",
      description:
        "Rotate the entire plot grid to match the orientation of your field rows. Use the slider for coarse adjustment or type an exact value in degrees.",
      selector: '[data-onboarding="pbp-angle"]',
    },
    {
      id: "pbp-generate-grid",
      title: "Generate Grid",
      description:
        "Fills the field boundary with a plot grid using the current dimension settings. Click Regenerate Grid any time you change the settings to update the preview.",
      selector: '[data-onboarding="pbp-generate-grid"]',
    },
    {
      id: "pbp-mode-buttons",
      title: "Select / Move Mode",
      description:
        "Select mode lets you click or drag-select individual plots. Move mode lets you drag selected plots to fine-tune their positions. Switch between them with the S and M keys.",
      selector: '[data-onboarding="pbp-mode-buttons"]',
    },
    {
      id: "pbp-select-tools",
      title: "Select All / Clear / Delete",
      description:
        "In Select mode: All selects every plot, Clear deselects, and Delete removes the highlighted plots permanently. Use this to remove edge plots that fall outside the field.",
      selector: '[data-onboarding="pbp-select-tools"]',
    },
    {
      id: "pbp-undo",
      title: "Undo",
      description:
        "Undo the last boundary or plot edit. Also available with Ctrl+Z.",
      selector: '[data-onboarding="pbp-undo"]',
    },
    {
      id: "pbp-redo",
      title: "Redo",
      description:
        "Redo a previously undone action. Also available with Ctrl+Y.",
      selector: '[data-onboarding="pbp-redo"]',
    },
    {
      id: "pbp-toggle-grid",
      title: "Show / Hide Grid",
      description:
        "Toggle the plot grid overlay on or off. Hiding the grid makes it easier to redraw or edit the field boundary without the plots getting in the way.",
      selector: '[data-onboarding="pbp-toggle-grid"]',
    },
    {
      id: "pbp-version-selectors",
      title: "Background Image & Boundary Version",
      description:
        "Switch between orthomosaic or stitching versions used as the map background, and load a previously saved boundary version to compare or continue editing.",
      selector: '[data-onboarding="pbp-version-selectors"]',
    },
    {
      id: "pbp-save",
      title: "Save",
      description:
        "Saves the current plot boundaries, overwriting the active version. The boundary file is used by all downstream steps — trait extraction, inference, and association.",
      selector: '[data-onboarding="pbp-save"]',
    },
    {
      id: "pbp-save-as",
      title: "Save As",
      description:
        "Saves the current boundaries as a new named version, keeping the previous version intact. Useful for testing different grid layouts before committing.",
      selector: '[data-onboarding="pbp-save-as"]',
    },
    {
      id: "pbp-cancel",
      title: "Cancel",
      description:
        "Exit the boundary editor without saving. If you have unsaved changes, you'll be prompted to confirm.",
      selector: '[data-onboarding="pbp-cancel"]',
    },
    {
      id: "pbp-clear-all",
      title: "Clear All Plots",
      description:
        "Removes every plot from the grid so you can start fresh — found under the Danger zone toggle at the bottom of the Plot Settings panel. Only appears when plots exist.",
      selector: '[data-onboarding="pbp-clear-all"]',
    },
  ],
}

TOUR_SECTIONS["/process/plot-marking"] = {
  label: "Plot Marking",
  steps: [
    {
      id: "pm-keyboard-hints",
      title: "Keyboard Shortcuts",
      description:
        "Quick reference for all keyboard shortcuts — S marks the start of a plot, E marks the end, N skips to the next unfinished plot, and arrow keys navigate between images. Keep this visible while you work.",
      selector: '[data-onboarding="pm-keyboard-hints"]',
    },
    {
      id: "pm-image-viewer",
      title: "Image Viewer",
      description:
        "The main image panel. Click to mark a start (S key) or end (E key) point for the current plot. Zoom in for precise placement — drag to pan when zoomed in, double-click to reset the view.",
      selector: '[data-onboarding="pm-image-viewer"]',
    },
    {
      id: "pm-nav-images",
      title: "Image Navigation",
      description:
        "Step through images with the ← / → arrows. The counter shows the current image index out of the total. Click the counter to jump to a specific image number.",
      selector: '[data-onboarding="pm-nav-images"]',
    },
    {
      id: "pm-mark-buttons",
      title: "Mark Start / End",
      description:
        "Click Mark Start (or press S) to record the start frame for the current plot, and Mark End (or press E) to record the end frame. Both marks are required before moving to the next plot.",
      selector: '[data-onboarding="pm-mark-buttons"]',
    },
    {
      id: "pm-plot-nav",
      title: "Plot Navigation",
      description:
        "Move between plots with the ← / → arrows or press N to jump to the next unmarked plot. The counter shows which plot you're on out of the total count.",
      selector: '[data-onboarding="pm-plot-nav"]',
    },
    {
      id: "pm-plot-pager",
      title: "Plot Progress Card",
      description:
        "Shows the current plot's start and end frame assignments alongside its plot ID. Completed plots are indicated by both frames being set.",
      selector: '[data-onboarding="pm-plot-pager"]',
    },
    {
      id: "pm-plot-start-end",
      title: "Start / End Labels",
      description:
        "Displays the image numbers assigned as the start and end frames for the current plot. Tap a label to jump directly to that image in the viewer.",
      selector: '[data-onboarding="pm-plot-start-end"]',
    },
    {
      id: "pm-direction",
      title: "Row Direction",
      description:
        "Set which direction the Amiga rover was travelling through this plot row — Left-to-Right or Right-to-Left. Direction must be set on every plot before saving.",
      selector: '[data-onboarding="pm-direction"]',
    },
    {
      id: "pm-dot-strip",
      title: "Progress Strip",
      description:
        "A colour-coded dot for every plot. Green = both start and end marked; amber = only one mark; grey = unmarked. Click any dot to jump directly to that plot.",
      selector: '[data-onboarding="pm-dot-strip"]',
    },
    {
      id: "pm-gps-toggle",
      title: "GPS Map Toggle",
      description:
        "Show or hide the GPS map panel. When visible, the map plots the rover's GPS track and highlights the image position for each frame as you navigate, helping you orient the field.",
      selector: '[data-onboarding="pm-gps-toggle"]',
    },
    {
      id: "pm-gps-map",
      title: "GPS Map",
      description:
        "Displays the rover's GPS track for this run. The current image position is highlighted as you step through frames — useful for confirming which part of the field each image covers.",
      selector: '[data-onboarding="pm-gps-map"]',
    },
    {
      id: "pm-version-selector",
      title: "Version Selector",
      description:
        "Switch between previously saved plot marking versions. Loading an earlier version restores all its start/end frame assignments so you can compare or continue from a prior state.",
      selector: '[data-onboarding="pm-version-selector"]',
    },
    {
      id: "pm-back",
      title: "Back",
      description:
        "Exit the plot marking tool and return to the pipeline steps. If you have unsaved changes, you'll be prompted to confirm before leaving.",
      selector: '[data-onboarding="pm-back"]',
    },
    {
      id: "pm-save",
      title: "Save",
      description:
        "Saves the current start/end assignments, overwriting the active version. The saved data is used by the stitching step to assemble plot video clips.",
      selector: '[data-onboarding="pm-save"]',
    },
    {
      id: "pm-save-as",
      title: "Save As",
      description:
        "Saves the current assignments as a new named version, keeping the previous version intact. Useful for experimenting with different mark positions before committing.",
      selector: '[data-onboarding="pm-save-as"]',
    },
    {
      id: "pm-clear-all",
      title: "Clear All Plots",
      description:
        "Resets all plots to a single empty entry so you can start the marking process fresh. Found inside the Danger zone toggle — only appears when plots exist.",
      selector: '[data-onboarding="pm-clear-all"]',
    },
  ],
}

TOUR_SECTIONS["/process/gcp"] = {
  label: "GCP Selection",
  steps: [
    {
      id: "gcp-select",
      title: "Select a GCP",
      description:
        "Pick which ground control point you want to mark from this dropdown. Each GCP corresponds to a physical marker in the field with known GPS coordinates. A coloured dot fills in once you've marked at least one image for it.",
      selector: '[data-onboarding="gcp-select"]',
    },
    {
      id: "gcp-nav-marks",
      title: "Navigate Marked Images",
      description:
        "Jump back and forth between images that already have a mark for the active GCP. The counter shows how many images have been marked so far.",
      selector: '[data-onboarding="gcp-nav-marks"]',
    },
    {
      id: "gcp-nav-images",
      title: "Browse All Images",
      description:
        "Step through every image with the ← / → arrows. Click the number counter to type in an image number and jump directly to it.",
      selector: '[data-onboarding="gcp-nav-images"]',
    },
    {
      id: "gcp-filter",
      title: "Filter by GCP Proximity",
      description:
        "When on, only images taken near a GCP are shown (based on GPS distance). Turn it off to see all images — useful if your drone images lack GPS data.",
      selector: '[data-onboarding="gcp-filter"]',
    },
    {
      id: "gcp-viewer",
      title: "Image Viewer — Mark the GCP",
      description:
        "Left-click anywhere on the image to drop a crosshair at that pixel for the active GCP. Right-click an existing mark to remove it. Drag to pan when zoomed in, double-click to reset the view.",
      selector: '[data-onboarding="gcp-viewer"]',
    },
    {
      id: "gcp-zoom",
      title: "Zoom Controls",
      description:
        "Zoom in for precise mark placement — the crosshair stays locked to the pixel you clicked regardless of zoom level. A Reset button appears when zoomed in.",
      selector: '[data-onboarding="gcp-zoom"]',
    },
    {
      id: "gcp-slider",
      title: "Image Slider",
      description:
        "Drag the slider to scrub through all images quickly. Coloured diamonds on the track show every marked image across all GCPs — hover a diamond to see which GCP it belongs to.",
      selector: '[data-onboarding="gcp-slider"]',
    },
    {
      id: "gcp-save",
      title: "Save GCPs",
      description:
        "Saves all marks and writes the GCP pixel-coordinate file used by OpenDroneMap. The button enables once every GCP has at least one image marked.",
      selector: '[data-onboarding="gcp-save"]',
    },
    {
      id: "gcp-done",
      title: "Done",
      description:
        "Exit the GCP tool and return to the pipeline steps. You can come back and re-mark GCPs at any time before running the orthomosaic step.",
      selector: '[data-onboarding="gcp-done"]',
    },
    {
      id: "gcp-replace-file",
      title: "Replace GCP File",
      description:
        "Swap the GCP locations CSV with a new file — useful if you updated field marker coordinates or loaded the wrong file. Existing marks will be cleared.",
      selector: '[data-onboarding="gcp-replace-file"]',
    },
    {
      id: "gcp-clear",
      title: "Clear All GCPs",
      description:
        "Removes every pixel mark across all GCPs and lets you start over. Only appears once at least one mark has been placed.",
      selector: '[data-onboarding="gcp-clear"]',
    },
  ],
}

export function getTourSection(pathname: string, step?: string): TourSection {
  if (pathname.startsWith("/files")) return TOUR_SECTIONS["/files"]
  // Tool pages (/process/{id}/tool) — differentiate by step search param
  if (/^\/process\/[^/]+\/tool/.test(pathname)) {
    if (step === "plot_boundary_prep") return TOUR_SECTIONS["/process/plot-boundary-prep"]
    if (step === "plot_marking") return TOUR_SECTIONS["/process/plot-marking"]
    return TOUR_SECTIONS["/process/gcp"]
  }
  // Workspace detail pages (/process/{id}) get a different tour than the workspace list
  if (/^\/process\/[^/]+/.test(pathname)) return TOUR_SECTIONS["/process/workspace"]
  if (pathname.startsWith("/process")) return TOUR_SECTIONS["/process"]
  if (pathname.startsWith("/analyze")) return TOUR_SECTIONS["/analyze"]
  return TOUR_SECTIONS["/"]
}
