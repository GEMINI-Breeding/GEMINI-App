/**
 * Mirror of the integer enums defined in
 * `backend/gemini/api/enums.py` (GEMINIDataFormat, GEMINISensorType,
 * GEMINIDataType, GEMINIDatasetType, GEMINITraitLevel).
 *
 * The backend persists these as raw integers on `sensor`,
 * `sensor_record`, and `dataset` rows. The /api/sensors/create endpoint
 * accepts the integer directly. Keeping these as plain numeric consts
 * (rather than a TS `enum`) makes them safe to pass through the
 * auto-generated OpenAPI client typings where the field is declared as
 * a stringly-typed primary key. If the backend enums change, update
 * here and re-run the OpenAPI client codegen.
 */

export const SensorType = {
  Default: 0,
  RGB: 1,
  NIR: 2,
  Thermal: 3,
  Multispectral: 4,
  Weather: 5,
  GPS: 6,
  Calibration: 7,
  Depth: 8,
  IMU: 9,
  Disparity: 10,
  Confidence: 11,
} as const

export const DataType = {
  Default: 0,
  Text: 1,
  Web: 2,
  Document: 3,
  Image: 4,
  Audio: 5,
  Video: 6,
  Binary: 7,
  Other: 8,
} as const

export const DataFormat = {
  Default: 0,
  TXT: 1,
  JSON: 2,
  CSV: 3,
  TSV: 4,
  XML: 5,
  HTML: 6,
  PDF: 7,
  JPEG: 8,
  PNG: 9,
  GIF: 10,
  BMP: 11,
  TIFF: 12,
  WAV: 13,
  MP3: 14,
  MPEG: 15,
  AVI: 16,
  MP4: 17,
  OGG: 18,
  WEBM: 19,
  NPY: 20,
} as const

export type SensorTypeId = (typeof SensorType)[keyof typeof SensorType]
export type DataTypeId = (typeof DataType)[keyof typeof DataType]
export type DataFormatId = (typeof DataFormat)[keyof typeof DataFormat]
