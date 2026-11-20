type DataTypeConfig = {
  fields: string[]
  /** Fields shown in the form that may be left empty. */
  optionalFields?: string[]
  fileType: string
  directory: string[]
  defaultPlatform?: string
  defaultSensor?: string
  hidden?: true
  /** When true, UploadData renders a custom upload dialog instead of the standard UploadList. */
  customUpload?: true
  /** One line under the type in the picker: what it is and what it is for. */
  hint?: string
}

// Path segment templates use literal placeholders ("Season", "Experiment",
// etc.) that `buildTargetRootDir` lower-cases and looks up in the form
// values. Historically the first path slot was "Year" and silently
// derived from the calendar year of the date input; that coupled season
// identity to the upload date and broke whenever the two diverged (e.g.
// uploading 2022 archival data in 2026, or a Northern-Hemisphere winter
// wheat season that spans two years). The slot is now "Season" and the
// user picks/creates the season explicitly, just like every other entity.
export const dataTypes: Record<string, DataTypeConfig> = {
  "Image Data": {
    hint: "Photos from a drone, a rover's camera or a handheld camera (phone, monopod)",
    fields: [
      "experiment",
      "season",
      "location",
      "population",
      "date",
      "platform",
      "sensor",
    ],
    fileType: "image/*",
    directory: [
      "Raw",
      "Season",
      "Experiment",
      "Location",
      "Population",
      "Date",
      "Platform",
      "Sensor",
      "Images",
    ],
  },
  // GPS tracks matched to photos by capture time in Data Sync: a drone's
  // ArduPilot log, or the GPS a person carried on a handheld pass. Stored in
  // the photos' Metadata/ folder, so the experiment, date, platform and
  // sensor must be the photos' own.
  "GPS Logs": {
    hint: "A GPS track for photos of the same date and camera: ArduPilot, GPX, NMEA, CSV or RTK .pos",
    fields: [
      "experiment",
      "season",
      "location",
      "population",
      "date",
      "platform",
      "sensor",
    ],
    fileType: ".bin,.log,.tlog,.gpx,.nmea,.pos,.csv,.txt",
    directory: [
      "Raw",
      "Season",
      "Experiment",
      "Location",
      "Population",
      "Date",
      "Platform",
      "Sensor",
      "Metadata",
    ],
  },
  "Synced Metadata": {
    hint: "A table of each photo's position (image, time, lat, lon) when the photos have none",
    fields: [
      "experiment",
      "season",
      "location",
      "population",
      "date",
      "platform",
      "sensor",
    ],
    fileType: ".csv",
    directory: [
      "Raw",
      "Season",
      "Experiment",
      "Location",
      "Population",
      "Date",
      "Platform",
      "Sensor",
      "Metadata",
    ],
  },
  "Farm-ng Binary File": {
    hint: "Amiga rover logs (.bin): frames and GPS are extracted",
    fields: ["experiment", "season", "location", "population", "date"],
    fileType: "*",
    directory: [
      "Raw",
      "Season",
      "Experiment",
      "Location",
      "Population",
      "Date",
      "Rover",
      "RGB",
      "Images",
    ],
    defaultPlatform: "Rover",
    defaultSensor: "RGB",
  },
  Orthomosaic: {
    fields: [
      "experiment",
      "season",
      "location",
      "population",
      "date",
      "platform",
      "sensor",
    ],
    fileType: ".tif",
    directory: [
      "Raw",
      "Season",
      "Experiment",
      "Location",
      "Population",
      "Date",
      "Platform",
      "Sensor",
      "Orthomosaic",
    ],
  },
  "Orthomosaic DEM": {
    fields: [
      "experiment",
      "season",
      "location",
      "population",
      "date",
      "platform",
      "sensor",
    ],
    fileType: ".tif",
    directory: [
      "Raw",
      "Season",
      "Experiment",
      "Location",
      "Population",
      "Date",
      "Platform",
      "Sensor",
      // Its own folder: ImportOrthoDialog lists DEMs from Orthomosaic-DEM/,
      // and a DEM beside the RGB in Orthomosaic/ was offered as an ortho.
      "Orthomosaic-DEM",
    ],
    hidden: true,
  },
  "Field Design": {
    fields: ["experiment", "season", "location", "population", "date"],
    fileType: ".csv",
    directory: [
      "Raw",
      "Season",
      "Experiment",
      "Location",
      "Population",
      "FieldDesign",
    ],
  },
  "Reference Data": {
    fields: ["name", "experiment", "season", "location", "population", "date"],
    // A dataset with no population applies to every population at its site
    // (see analyze/lib/referenceJoin). Requiring one forced users to invent
    // a population the trait data doesn't carry. The name defaults to the
    // file name.
    optionalFields: ["name", "population"],
    fileType: ".csv,.xlsx,.xls",
    // Scoped so two experiments' "lai.csv" don't overwrite each other.
    directory: ["ReferenceData", "Experiment", "Location", "Population"],
  },
  "Weather Data": {
    // Weather station files (Campbell TOA5 .dat, or CSV): the originals are
    // kept here, then the weather dialog maps their columns and saves one
    // tidy file per station under Processed/…/Weather/.
    fields: ["experiment", "season", "location"],
    fileType: ".dat,.csv,.txt",
    directory: ["Raw", "Season", "Experiment", "Location", "Weather"],
  },
  "Trait Data": {
    // Only experiment lives at the page level — site, season, population,
    // and collection date can be invariant for the file or come from per-
    // sheet columns. Those decisions are made in the wizard's Map Columns
    // step (`SheetMapping.{siteMode,seasonMode,collectionDateMode}`), not
    // here.
    fields: ["experiment"],
    fileType: ".csv,.tsv,.xlsx,.xls",
    directory: ["Traits"],
    customUpload: true,
  },
  "Genomic Data": {
    fields: ["experiment"],
    fileType: ".csv,.tsv,.txt,.vcf,.hmp,.hapmap",
    directory: ["Genotyping"],
    customUpload: true,
  },
}
