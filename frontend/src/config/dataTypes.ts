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

export const dataTypes: Record<string, DataTypeConfig> = {
  "Image Data": {
    fields: [
      "experiment",
      "location",
      "population",
      "date",
      "platform",
      "sensor",
    ],
    fileType: "image/*",
    directory: [
      "Raw",
      "Year",
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
      "location",
      "population",
      "date",
      "platform",
      "sensor",
    ],
    fileType: "*",
    directory: [
      "Raw",
      "Year",
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
      "location",
      "population",
      "date",
      "platform",
      "sensor",
    ],
    fileType: ".csv",
    directory: [
      "Raw",
      "Year",
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
    fields: ["experiment", "location", "population", "date"],
    fileType: "*",
    directory: [
      "Raw",
      "Year",
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
      "location",
      "population",
      "date",
      "platform",
      "sensor",
    ],
    fileType: ".tif",
    directory: [
      "Raw",
      "Year",
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
      "location",
      "population",
      "date",
      "platform",
      "sensor",
    ],
    fileType: ".tif",
    directory: [
      "Raw",
      "Year",
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
    fields: ["experiment", "location", "population", "date"],
    fileType: "*",
    directory: [
      "Raw",
      "Year",
      "Experiment",
      "Location",
      "Population",
      "Date",
      "WeatherData",
    ],
  },
  "Field Design": {
    fields: ["experiment", "location", "population", "date"],
    fileType: ".csv",
    directory: [
      "Raw",
      "Year",
      "Experiment",
      "Location",
      "Population",
      "FieldDesign",
    ],
  },
  "Reference Data": {
    fields: ["name", "experiment", "location", "population", "date"],
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
