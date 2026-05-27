type DataTypeConfig = {
  fields: string[]
  fileType: string
  directory: string[]
  defaultPlatform?: string
  defaultSensor?: string
  hidden?: true
  /** When true, UploadData renders a custom upload dialog instead of the standard UploadList. */
  customUpload?: true
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
  "Ardupilot Logs": {
    fields: [
      "experiment",
      "season",
      "location",
      "population",
      "date",
      "platform",
      "sensor",
    ],
    fileType: "*",
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
    fields: ["experiment", "season", "location", "population", "date"],
    fileType: "*",
    directory: [
      "Raw",
      "Season",
      "Experiment",
      "Location",
      "Population",
      "Date",
      "Amiga",
      "RGB",
      "Images",
    ],
    defaultPlatform: "Amiga",
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
      "Orthomosaic",
    ],
    hidden: true,
  },
  "Weather Data": {
    fields: ["experiment", "season", "location", "population", "date"],
    fileType: "*",
    directory: [
      "Raw",
      "Season",
      "Experiment",
      "Location",
      "Population",
      "Date",
      "WeatherData",
    ],
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
    fileType: ".csv,.xlsx,.xls",
    directory: ["ReferenceData"],
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
