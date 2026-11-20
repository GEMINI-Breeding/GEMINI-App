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
        title: "Flight Days × Stages",
        description:
          "One row per flight day, one column per stage of the pipeline: a tick is done, “next” is what that day needs, and clicking any cell opens that day at that stage. The header counts how many days have each stage done; older seasons fold. A day flown several times or with several cameras shows counts per stage: open it for a row per run.",
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
          "Explore the measured traits: the Table of every plot by date, Query to compare plot images across the season, one trait at a time, several traits together, and the Map.",
        selector: '[data-onboarding="nav-analyze"]',
        route: "/analyze",
      },
      {
        id: "analyze-table",
        title: "Table",
        description:
          "Every plot's traits on each flight date, a row per plot per date. Filter, sort and download.",
        selector: '[data-testid="analyze-tab-table"]',
        route: "/analyze",
      },
      {
        id: "analyze-query",
        title: "Query",
        description:
          "Find plots by number or accession and see their images across the season, with each date's traits.",
        selector: '[data-testid="analyze-tab-query"]',
        route: "/analyze",
        search: { view: "query" },
      },
      {
        id: "analyze-single",
        title: "Single Trait",
        description:
          "Pick the scope, then a trait measured there, to see it through the season.",
        selector: '[data-testid="analyze-tab-single"]',
        route: "/analyze",
        search: { view: "single" },
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
      id: "pm-intro",
      title: "Plot Marking",
      description:
        "Each plot is a stretch of the rover's track between a start frame and an end frame. Mark them here (or let the app mark the whole track), check them, then save: stitching joins each plot's frames into one image.",
      selector: null,
    },
    {
      id: "pm-keys",
      title: "Keyboard Shortcuts",
      description:
        "← / → move through the frames, S marks the current plot's start, E its end, N starts a new plot, D deletes one, and Ctrl+S saves. Plots per frame (beside it) is for passes that see more than one plot at once, one per band of the frame.",
      selector: '[data-testid="pm-keys"]',
    },
    {
      id: "pm-automark",
      title: "Mark Automatically",
      description:
        "Marks the whole track from the crop rows, using the plots per bed and plot spacing recorded for the run. Review the result plot by plot afterwards. Below it, Mark from drone plot boundaries marks every plot from the boundaries drawn on that date's orthomosaic, when the field was also flown.",
      selector: '[data-testid="pm-automark"]',
    },
    {
      id: "pm-frame",
      title: "The Frame You Are On",
      description:
        "The current frame, with the heading of the rover. Wheel or the buttons zoom, drag moves around. Full size opens the frame on its own.",
      selector: '[data-testid="pm-frame"]',
    },
    {
      id: "pm-marks",
      title: "Mark Start / End",
      description:
        "Mark Start (S) and Mark End (E) set the current plot's first and last frame to the frame shown. The Step setting above skips several frames at a time.",
      selector: '[data-testid="pm-marks"]',
    },
    {
      id: "pm-pager",
      title: "Plot by Plot",
      description:
        "Go to a plot by number, or step through them with the arrows. + adds a plot, the bin deletes the current one.",
      selector: '[data-testid="pm-pager"]',
    },
    {
      id: "pm-strip",
      title: "Every Plot on the Track",
      description:
        "One segment per plot: green is marked, amber needs a check (carried over from another date, or a frame that no longer exists), grey is not marked. Click a segment to go to that plot.",
      selector: '[data-testid="pm-strip"]',
    },
    {
      id: "pm-approve",
      title: "Check a Plot",
      description:
        "The plot's start and end frames side by side. Looks right · next (Y) confirms it and moves on; click Start or End to jump to that frame and fix it.",
      selector: '[data-testid="pm-approve"]',
    },
    {
      id: "pm-direction",
      title: "Stitching Direction",
      description:
        "Which way the images run through the plot when stitched (the rover's travel direction across the frame).",
      selector: '[data-testid="pm-direction"]',
    },
    {
      id: "pm-gps-toggle",
      title: "GPS Map",
      description:
        "Shows the rover's track beside the frame, with the current frame on it: useful to see which pass and bed you are on.",
      selector: '[data-testid="pm-gps-toggle"]',
    },
    {
      id: "pm-version-select",
      title: "Versions",
      description:
        "Saved markings of this track. Loading one restores all its plots; the bin deletes it.",
      selector: '[data-testid="pm-version-select"]',
    },
    {
      id: "pm-save",
      title: "Save",
      description:
        "Saves over the version shown. Stitching uses the saved markings.",
      selector: '[data-testid="pm-save"]',
    },
    {
      id: "pm-save-as",
      title: "Save As",
      description:
        "Saves the markings as a new version and keeps the earlier one.",
      selector: '[data-testid="pm-save-as"]',
    },
    {
      id: "pm-back",
      title: "Back",
      description: "Back to the run. With unsaved changes it asks first.",
      selector: '[data-testid="pm-back"]',
    },
    {
      id: "pm-danger",
      title: "Danger Zone",
      description: "Clear every plot and start the marking again.",
      selector: '[data-testid="pm-danger"]',
    },
  ],
}

TOUR_SECTIONS["/process/gcp"] = {
  label: "GCP Selection",
  steps: [
    {
      id: "gcp-intro",
      title: "Ground Control Points",
      description:
        "Markers on the ground at surveyed positions. Marking them in the drone images ties the orthomosaic to its true position, so maps of different dates line up. ODM needs at least three GCPs marked to use them.",
      selector: null,
    },
    {
      id: "gcp-load-csv",
      title: "Load GCPs from CSV",
      description:
        "A file with each GCP's name, latitude, longitude and elevation. Or add GCPs one at a time from the list and type their coordinates.",
      selector: '[data-testid="gcp-load-csv"]',
    },
    {
      id: "gcp-active-select",
      title: "The GCP You Are Marking",
      description:
        "Pick a GCP. Its coordinates can be edited beside it (Save coords), and the bin deletes it.",
      selector: '[data-testid="gcp-active-select"]',
    },
    {
      id: "gcp-mode",
      title: "Images Near It",
      description:
        "Radius: the images within a distance of the GCP. Map-picker: choose them on the map with a lasso (shift-drag) instead.",
      selector: '[data-testid="gcp-mode-radius"]',
    },
    {
      id: "gcp-map",
      title: "Image Map",
      description:
        "Every image is a dot, coloured by the GCP that claims it; the GCPs are ringed pins. The dots near the active GCP are highlighted.",
      selector: '[data-testid="gcp-map"]',
    },
    {
      id: "gcp-image-slider",
      title: "Step Through the Images",
      description: "The images near the active GCP, one at a time.",
      selector: '[data-testid="gcp-image-slider"]',
    },
    {
      id: "gcp-image-viewer",
      title: "Mark the GCP",
      description:
        "Click the marker's centre. Right-click a mark to remove it; clicking again on the same image moves it. Wheel zooms. Mark each GCP in every photo that shows it: ODM needs at least three GCPs, each in three or more photos.",
      selector: '[data-testid="gcp-image-viewer"]',
    },
    {
      id: "gcp-save-and-complete",
      title: "Save & Complete",
      description:
        "Writes the GCP file the orthomosaic step reads, and completes the step. Skip leaves GCPs out of this run.",
      selector: '[data-testid="gcp-save-and-complete"]',
    },
  ],
}

TOUR_SECTIONS["/process/image-review"] = {
  label: "Image Exclusion",
  steps: [
    {
      id: "ir-map",
      title: "Every Image on the Map",
      description:
        "Each dot is a drone image. Shift-drag a box (or shift-click one dot) to leave images out of the orthomosaic: take-off and landing frames, turns, blurry shots, frames off the field.",
      selector: ".leaflet-container",
    },
    {
      id: "ir-counts",
      title: "Kept and Left Out",
      description: "How many images are kept and how many are left out.",
      selector: '[data-testid="image-review-counts"]',
    },
    {
      id: "ir-save",
      title: "Save & Complete",
      description:
        "Saves the selection and completes the step. Clear selection starts again; Skip keeps every image.",
      selector: '[data-testid="image-review-save"]',
    },
  ],
}

TOUR_SECTIONS["/process/inference"] = {
  label: "Inference",
  steps: [
    {
      id: "inf-results",
      title: "Results on This Run",
      description:
        "Each model run on this date, newest first: how many plots and the mean count per plot. The counts are stored per plot and appear in Analyze too.",
      selector: '[data-testid="inference-results"]',
    },
    {
      id: "inf-run",
      title: "Run a Model",
      description:
        "Try a model on one plot image, or run it on every image of the date. Models come from Roboflow, Hugging Face (including ones that find objects from a description), or weights trained here. Set up models keeps the pipeline's list.",
      selector: '[data-testid="inference-run-open"]',
    },
    {
      id: "inf-label",
      title: "Label & Train",
      description:
        "Correct a model's detections or label from nothing, then train a model of your own on the labelled images. Include several dates so it sees different light and growth stages.",
      selector: '[data-testid="inference-label-menu"]',
    },
    {
      id: "inf-view",
      title: "View Results",
      description:
        "The detections on each plot. Set a confidence threshold, use it in Analyze, sort plots by count to check the extremes, and correct boxes with Label.",
      selector: '[data-testid="inference-show-job"]',
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
    if (step === "image_review") return TOUR_SECTIONS["/process/image-review"]
    if (step === "inference") return TOUR_SECTIONS["/process/inference"]
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
