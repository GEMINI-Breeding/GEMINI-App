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

export function getTourSection(pathname: string): TourSection {
  if (pathname.startsWith("/files")) return TOUR_SECTIONS["/files"]
  if (pathname.startsWith("/process")) return TOUR_SECTIONS["/process"]
  if (pathname.startsWith("/analyze")) return TOUR_SECTIONS["/analyze"]
  return TOUR_SECTIONS["/"]
}
