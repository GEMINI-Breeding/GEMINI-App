/**
 * The platforms and sensors data can be uploaded as. They decide the
 * processing (for a person and for the agent alike): the platform picks the
 * pipeline (a drone's is aerial — orthomosaic; a rover's or a handheld
 * camera's is ground — plot marking and stitching), and the sensor type what
 * is made of the images (RGB: plot images, cover, models; thermal: canopy
 * temperature). So both come from a fixed list.
 *
 * A sensor is the platform's own camera ("Onboard": the drone's built-in
 * camera, stored as "RGB") or another one mounted on it, named by the person
 * and stored as "RGB-SonyA7R": the type stays readable at the front, and two
 * cameras of one type tested on the same date land in their own folders.
 *
 * Add a sensor type (Multispectral, LiDAR, …) to SENSOR_TYPES when its
 * processing exists.
 */

export const PLATFORMS = ["Drone", "Rover", "Handheld"] as const
export type Platform = (typeof PLATFORMS)[number]

export const SENSOR_TYPES = ["RGB", "Thermal"] as const
export type SensorType = (typeof SENSOR_TYPES)[number]

export const PLATFORM_HINT: Record<Platform, string> = {
  Drone: "aerial pipeline: orthomosaic, plot boundaries, plot images",
  Rover: "ground pipeline: plot marking, stitching",
  Handheld: "ground pipeline: plot photos",
}

/** "SonyA7R" from "Sony A7R" — what can stand in a storage path. */
export function cameraSlug(camera: string): string {
  return camera
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("")
}

/** The stored sensor name: "RGB" for the onboard camera, "RGB-SonyA7R" for another. */
export function sensorName(type: string, camera?: string | null): string {
  const slug = cameraSlug(camera ?? "")
  return slug ? `${type}-${slug}` : type
}

/** A stored sensor name read back: its type (from the list, or null) and camera. */
export function parseSensorName(name: string | null | undefined): {
  type: SensorType | null
  camera: string
} {
  const [head, ...rest] = (name ?? "").trim().split("-")
  const type =
    SENSOR_TYPES.find((t) => t.toLowerCase() === head.trim().toLowerCase()) ??
    null
  return { type, camera: rest.join("-") }
}

/** The platform from the list a stored name stands for (case-insensitive), or null. */
export function platformOf(name: string | null | undefined): Platform | null {
  const n = (name ?? "").trim().toLowerCase()
  return PLATFORMS.find((p) => p.toLowerCase() === n) ?? null
}

/** Makers of drones and drone cameras: their photos suggest the Drone platform. */
const DRONE_MAKERS = [
  "dji",
  "autel",
  "parrot",
  "skydio",
  "sensefly",
  "yuneec",
  "wingtra",
  "freefly",
  "micasense",
  "sentera",
]

/** The platform a photo's camera maker suggests ("DJI" → Drone), if any. */
export function platformFromMaker(
  make: string | null | undefined,
): Platform | null {
  const m = (make ?? "").toLowerCase()
  return DRONE_MAKERS.some((d) => m.includes(d)) ? "Drone" : null
}
