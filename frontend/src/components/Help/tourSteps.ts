export interface TourStep {
  id: string
  title: string
  description: string
  /** CSS selector for the element to spotlight. null = centered modal (no highlight). */
  selector: string | null
  /** Navigate to this route before showing the step. */
  route?: string
  /** Search params for that route (e.g. an Analyze tab). */
  search?: Record<string, string>
  /** A run step to bring onto the run page's card first (its key). */
  focus?: string
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
          "Select a pipeline that suits your data extraction needs — Aerial for drone imagery (orthomosaic → traits) or Ground for Amiga rover data (stitching → traits). Click either one to configure and create it (once a workspace has pipelines, this sits at the bottom of the page as “Add another pipeline”).",
        selector: '[data-onboarding="process-pipeline-cards"]',
      },
      {
        id: "process-new-run",
        title: "Add a Run",
        description:
          "Once a pipeline exists, click New Run to start a field data collection run. Each run corresponds to a single date of data — you can have multiple runs per pipeline to track changes over time.",
        selector: '[data-onboarding="process-new-run"]',
      },
      {
        id: "process-run-groups",
        title: "Runs, One Row per Flight Day",
        description:
          "Runs are grouped by date and platform. A day flown with several cameras (RGB and thermal) or several times (diurnal flights, one per treatment) is one row: expand it to see each flight. A thermal flight flown beside an RGB one is folded into the RGB run rather than listed on its own. Click a run to open its steps.",
        selector: '[data-onboarding="process-run-groups"]',
      },
      {
        id: "process-panel",
        title: "What's Running",
        description:
          "Jobs, uploads and copies in progress show in this panel at the bottom right, including work the agent started and copies waiting for a free cluster slot. Expand it to follow or cancel one.",
        selector: '[data-onboarding="process-panel"]',
      },
    ],
  },

  "/process/run": {
    label: "Run",
    steps: [
      {
        id: "run-scope",
        title: "What This Run Is On",
        description:
          "The upload this run processes: place, population, date, platform and sensor, the treatments flown, and how many images were found. The agent card below lets you hand the run to the agent to carry on with.",
        selector: '[data-onboarding="run-scope"]',
      },
      {
        id: "run-cameras",
        title: "Cameras of This Flight",
        description:
          "Every camera flown on this flight, such as thermal beside RGB. One run covers all of them: build an orthomosaic per camera only if you want one. Thermal frames are matched to the RGB frames by time, so plot images and canopy temperature work without a thermal orthomosaic.",
        selector: '[data-onboarding="run-cameras"]',
      },
      {
        id: "run-steps",
        title: "The Processing Steps",
        description:
          "One step at a time: the card shows the step to do next. Pick any step from the list at the top (each shows its status), or use the arrows beside the card. A step unlocks once what it needs is done (Initial Trait Extraction needs only the orthomosaic and plot boundaries, not the plot images); hover a locked arrow to see what is left. A run that starts from an uploaded orthomosaic skips the drone-image steps.",
        selector: '[data-onboarding="run-steps"]',
      },
      {
        id: "run-image-review",
        title: "Image Exclusion and GCPs",
        description:
          "Optional first steps for raw drone images: leave out blurry or off-field images, and mark ground control points for more accurate positions.",
        selector: '[data-testid="step-row-image_review"]',
        focus: "image_review",
      },
      {
        id: "run-orthomosaic",
        title: "Orthomosaic",
        description:
          "Stitches the images into one map of the field, with a DEM for plant height. Pick a quality: a quick one is enough to place plot boundaries and cut plot images from the raw frames.",
        selector: '[data-testid="step-row-orthomosaic"]',
        focus: "orthomosaic",
      },
      {
        id: "run-boundaries",
        title: "Plot Boundaries",
        description:
          "Draw or generate the plot grid over the orthomosaic and attach the field design. Boundaries saved on another date can be imported and shifted to fit this one.",
        selector: '[data-testid="step-row-plot_boundary_prep"]',
        focus: "plot_boundary_prep",
      },
      {
        id: "run-plot-images",
        title: "Plot Images",
        description:
          "One image per plot, cut from the orthomosaic or, for sharper views, from the raw frames. Raw frames also give the other cameras' views of each plot (thermal) and their canopy temperature.",
        selector: '[data-testid="step-row-split_orthomosaic"]',
        focus: "split_orthomosaic",
      },
      {
        id: "run-traits",
        title: "Traits",
        description:
          "Measures each plot: canopy cover, vegetation indices, plant height from the DEM, and temperature from thermal. The results are stored per plot and appear in Analyze.",
        selector: '[data-testid="step-row-trait_extraction"]',
        focus: "trait_extraction",
      },
      {
        id: "run-inference",
        title: "Inference",
        description:
          "Runs a trained model on the plot images, for example to count or detect plant organs, and stores its results as traits too.",
        selector: '[data-testid="step-row-inference"]',
        focus: "inference",
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
      {
        id: "analyze-single",
        title: "Single Trait",
        description:
          "Pick a trait to chart its values across dates, sites and genotypes.",
        selector: '[data-testid="analyze-tab-single"]',
        route: "/analyze",
      },
      {
        id: "analyze-multi",
        title: "Multivariate",
        description:
          "Compare several traits at once, to see how they relate across plots.",
        selector: '[data-testid="analyze-tab-multivariate"]',
        route: "/analyze",
        search: { view: "multi" },
      },
      {
        id: "analyze-map",
        title: "Map",
        description:
          "Each date's orthomosaic with its plots coloured by a trait, labelled by treatment.",
        selector: '[data-testid="analyze-tab-map"]',
        route: "/analyze",
        search: { view: "map" },
      },
      {
        id: "analyze-table",
        title: "Table",
        description: "Every trait record in one table, to filter and download.",
        selector: '[data-testid="analyze-tab-table"]',
        route: "/analyze",
        search: { view: "table" },
      },
    ],
  },

  "/console": {
    label: "Console",
    steps: [
      {
        id: "console",
        title: "Console",
        description:
          "The log of what the app, the agent and the jobs are doing. Look here when something seems stuck.",
        selector: '[data-onboarding="nav-console"]',
        route: "/console",
      },
      {
        id: "console-source",
        title: "Filter by Source",
        description:
          "Show only one source's lines, such as the jobs on the cluster or the agent.",
        selector: '[data-testid="console-source-filter"]',
        route: "/console",
      },
    ],
  },

  "/settings": {
    label: "Settings",
    steps: [
      {
        id: "settings",
        title: "Settings",
        description: "How GEMI is set up on this computer.",
        selector: '[data-onboarding="nav-settings"]',
        route: "/settings",
      },
      {
        id: "settings-home",
        title: "Home",
        description:
          "Choose what Home shows: the dashboard, the agent, or both as tabs.",
        selector: '[data-onboarding="files-tab-home"]',
        route: "/settings",
      },
      {
        id: "settings-data",
        title: "Data & Services",
        description:
          "Where the data is stored and which services the app talks to.",
        selector: '[data-onboarding="files-tab-data"]',
        route: "/settings",
      },
      {
        id: "settings-compute",
        title: "Compute",
        description:
          "Where the heavy work runs: this computer or a cluster, and the workers started there for each kind of job.",
        selector: '[data-onboarding="files-tab-compute"]',
        route: "/settings",
      },
      {
        id: "settings-signin",
        title: "Sign-in",
        description: "Your account, and the people you share experiments with.",
        selector: '[data-onboarding="files-tab-signin"]',
        route: "/settings",
      },
    ],
  },

  "/": {
    label: "App",
    steps: [
      {
        id: "app",
        title: "Welcome to GEMI",
        description:
          "GEMI takes field data from upload to traits in four stages: Files (upload), Process (orthomosaics, plot boundaries, plot images, traits), Analyze (charts and maps), and Home (your dashboard and the agent). This tour visits each one. Every page also has its own tour under Help.",
        selector: null,
      },
      {
        id: "home",
        title: "Home — Dashboard and Agent",
        description:
          "Build a dashboard of cards, charts, tables and plot viewers from your processed data. Beside it, the agent can upload, process and check data for you; ask it in plain words.",
        selector: '[data-onboarding="nav-home"]',
        route: "/",
      },
      {
        id: "app-files",
        title: "1. Files — Upload",
        description:
          "Add drone, rover or handheld data, from this computer, a cluster folder or online storage. The date is read from the file names; you confirm it before anything is uploaded. Manage lists everything stored.",
        selector: '[data-onboarding="nav-files"]',
        route: "/files",
      },
      {
        id: "app-process",
        title: "2. Process — Workspaces",
        description:
          "A workspace holds one field experiment's pipelines. Each upload becomes a run, one row per flight day, with RGB and thermal together.",
        selector: '[data-onboarding="nav-process"]',
        route: "/process",
      },
      {
        id: "app-workspaces",
        title: "Your Workspaces",
        description:
          "Each card shows a preview of the latest run and how many runs need you. Open one, then open a run to see its steps: orthomosaic → plot boundaries → plot images → traits → inference. Start the Run tour there for each step.",
        selector: '[data-testid^="workspace-card-"]',
        route: "/process",
      },
      {
        id: "app-analyze",
        title: "3. Analyze — Results",
        description:
          "Chart one trait or several, map plots over each date's orthomosaic, or browse every record in a table.",
        selector: '[data-onboarding="nav-analyze"]',
        route: "/analyze",
      },
      {
        id: "app-console",
        title: "Console",
        description:
          "The running log of the app, the agent and the jobs, for when something seems stuck.",
        selector: '[data-onboarding="nav-console"]',
        route: "/console",
      },
      {
        id: "app-settings",
        title: "Settings",
        description:
          "Where work runs (this computer or a cluster), where data is stored, your sign-in, and what Home shows.",
        selector: '[data-onboarding="nav-settings"]',
        route: "/settings",
      },
      {
        id: "app-where",
        title: "Where Your Data Is",
        description:
          "Everything the app shows, and every job it runs, is in one place: this computer or a cluster session (yours, or one your group shares). This shows which, and whether it is answering; in the desktop app, click it to switch. Each place keeps its own experiments: switching moves nothing.",
        selector: '[data-testid="where-current"]',
      },
      {
        id: "app-help",
        title: "Help Is Always Here",
        description:
          "Open Help on any page for what it does and a tour of that page. Jobs in progress show in a panel at the bottom right.",
        selector: null,
        route: "/",
      },
    ],
  },
}

TOUR_SECTIONS["/process/plot-boundary-prep"] = {
  label: "Plot Boundary Prep",
  steps: [
    {
      id: "pbp-overview",
      title: "Plot Boundary Prep",
      description:
        "Put one outline on the orthomosaic for every plot, then save them as a version. Plot images and traits are cut from the active version. The arrow beside the title goes back to the run.",
      selector: '[data-testid="boundary-title"]',
    },
    {
      id: "pbp-map",
      title: "The map",
      description:
        "Draw the outer field boundary with the rectangle or polygon tool (top left of the map); the grid settings fill it with plots. Click a plot to select it: Shift-click adds, Cmd/Ctrl-click toggles, Cmd/Ctrl-A selects every plot. Shift + drag turns the view; the compass goes back to north up.",
      selector: ".gemi-map",
    },
    {
      id: "pbp-move",
      title: "Moving plots",
      description:
        "Drag any selected plot to move the whole selection, or use the arrow keys to move it by the step in the selection bar (Shift: ten steps). The bar under the map also rotates, flips, renames and deletes the selection. Cmd/Ctrl-Z undoes, Cmd/Ctrl-Shift-Z redoes.",
      selector: '[data-testid="selection-action-bar"]',
    },
    {
      id: "pbp-toolbar",
      title: "Map tools",
      description:
        "Select an area: drag a box to select the plots inside it (Shift adds); it switches off once plots are selected, so the next drag moves them. Add a plot draws one more plot in the selected block. Plots and Opacity show or fade the overlay.",
      selector: '[data-testid="boundary-map-toolbar"]',
    },
    {
      id: "pbp-view",
      title: "Turning the view",
      description:
        "Turn the map 15° at a time, type an angle, or Align with plots so the plot rows run across the screen. North up turns it back. Only the view turns: the plots stay where they are on the field.",
      selector: '[data-testid="boundary-view-rotation"]',
    },
    {
      id: "pbp-quick-save",
      title: "Quick save",
      description:
        "Saves and activates the plots without opening the version menu. If a version already has that name, it asks for another name or whether to overwrite it. The eye icon tucks it into the corner.",
      selector: '[data-testid="quick-save"]',
    },
    {
      id: "pbp-grid",
      title: "Grid settings",
      description:
        "Under the map: the rows, columns, plot size, gaps and angle the grid is laid out with, or a field design (CSV) that names every plot with its row, column and genotype.",
      selector: '[data-testid="boundary-grid-settings"]',
    },
    {
      id: "pbp-version-menu",
      title: "Version menu",
      description:
        "Hide version menu gives the map the full width; Version menu brings it back.",
      selector: '[data-testid="boundary-panel-toggle"]',
    },
    {
      id: "pbp-versions",
      title: "Versions & saving",
      description:
        "Save & complete step saves a version, makes it the active one and finishes the step; Save without activating keeps the current one active. The Versions list loads, compares and activates earlier versions.",
      selector: '[data-testid="boundary-versions-save"]',
    },
    {
      id: "pbp-import",
      title: "Import from another date",
      description:
        "Boundaries saved for another date of the same experiment, site and population, nearest date first. Show other experiments, sites and populations lists the rest. Imported plots are unsaved until you save; aligning moves them onto this date's orthomosaic.",
      selector: '[data-testid="boundary-import-tab"]',
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
    if (step === "plot_boundary_prep")
      return TOUR_SECTIONS["/process/plot-boundary-prep"]
    if (step === "plot_marking") return TOUR_SECTIONS["/process/plot-marking"]
    return TOUR_SECTIONS["/process/gcp"]
  }
  if (/^\/process\/[^/]+\/run\//.test(pathname))
    return TOUR_SECTIONS["/process/run"]
  // Workspace detail pages (/process/{id}) get a different tour than the workspace list
  if (/^\/process\/[^/]+/.test(pathname))
    return TOUR_SECTIONS["/process/workspace"]
  if (pathname.startsWith("/process")) return TOUR_SECTIONS["/process"]
  if (pathname.startsWith("/analyze")) return TOUR_SECTIONS["/analyze"]
  if (pathname.startsWith("/console")) return TOUR_SECTIONS["/console"]
  if (pathname.startsWith("/settings")) return TOUR_SECTIONS["/settings"]
  return TOUR_SECTIONS["/"]
}

/** The tour of the whole app, stage by stage (offered on first open). */
export function appTour(): TourSection {
  return TOUR_SECTIONS["/"]
}
