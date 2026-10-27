/**
 * A labelled set: objects the person drew or confirmed on plot images, for
 * training or fine-tuning a model later. Kept as versions next to the plot
 * images (…/labels/{name}), exported as COCO JSON.
 */

/** One labelled object. Coordinates in image pixels. */
export interface Ann {
  id: string
  cls: string
  /** [x1, y1, x2, y2] */
  box: [number, number, number, number]
  /** Mask outline, when there is one. */
  points?: [number, number][]
  /** Proposed by a model and not yet confirmed, or kept. */
  status: "proposed" | "kept"
  source: "model" | "similar" | "sam" | "hand"
  confidence?: number
}

export interface LabelledImage {
  width: number
  height: number
  annotations: Ann[]
  /** The person has looked at this image and saved it. */
  done: boolean
}

export interface LabelSet {
  classes: string[]
  images: Record<string, LabelledImage>
}

export const newId = () => Math.random().toString(36).slice(2, 10)

/** The app's prediction shape (centre + size) → a box annotation. */
export function fromPrediction(
  p: {
    class: string
    confidence?: number
    x?: number
    y?: number
    width?: number
    height?: number
    points?: { x: number; y: number }[]
  },
  status: Ann["status"],
  source: Ann["source"],
): Ann | null {
  if (
    typeof p.x !== "number" ||
    typeof p.y !== "number" ||
    typeof p.width !== "number" ||
    typeof p.height !== "number"
  )
    return null
  return {
    id: newId(),
    cls: p.class,
    box: [
      p.x - p.width / 2,
      p.y - p.height / 2,
      p.x + p.width / 2,
      p.y + p.height / 2,
    ],
    points: p.points?.length
      ? p.points.map((q) => [q.x, q.y] as [number, number])
      : undefined,
    status,
    source,
    confidence: p.confidence,
  }
}

export function iou(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const x1 = Math.max(a[0], b[0])
  const y1 = Math.max(a[1], b[1])
  const x2 = Math.min(a[2], b[2])
  const y2 = Math.min(a[3], b[3])
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const area = (r: typeof a) => (r[2] - r[0]) * (r[3] - r[1])
  const u = area(a) + area(b) - inter
  return u > 0 ? inter / u : 0
}

/** Proposals not already covered by an object on the image. */
export function newProposals(existing: Ann[], proposed: Ann[]): Ann[] {
  return proposed.filter((p) => !existing.some((e) => iou(e.box, p.box) > 0.5))
}

/** COCO JSON of the kept objects on the images the person saved. */
export function toCoco(set: LabelSet): object {
  const categories = set.classes.map((name, i) => ({ id: i + 1, name }))
  const catId = new Map(set.classes.map((c, i) => [c, i + 1]))
  const images: object[] = []
  const annotations: object[] = []
  let imgId = 0
  let annId = 0
  for (const [path, img] of Object.entries(set.images)) {
    if (!img.done) continue
    imgId += 1
    images.push({
      id: imgId,
      file_name: path,
      width: img.width,
      height: img.height,
    })
    for (const a of img.annotations) {
      if (a.status !== "kept") continue
      annId += 1
      const [x1, y1, x2, y2] = a.box
      annotations.push({
        id: annId,
        image_id: imgId,
        category_id: catId.get(a.cls) ?? 0,
        bbox: [x1, y1, x2 - x1, y2 - y1],
        area: (x2 - x1) * (y2 - y1),
        iscrowd: 0,
        segmentation: a.points?.length ? [a.points.flat()] : [],
      })
    }
  }
  return { images, annotations, categories }
}

/** …/PlotImages/plot_1.png → …/labels/{name};
 *  …/PlotFrames/crops/x.jpg → …/PlotFrames/labels/{name} (its own set: other pictures). */
export function labelSetDirectory(imagePath: string, name = "default"): string {
  const f = imagePath.lastIndexOf("/PlotFrames/")
  if (f >= 0) return `${imagePath.slice(0, f)}/PlotFrames/labels/${name}`
  const i = imagePath.lastIndexOf("/PlotImages/")
  const base =
    i >= 0
      ? imagePath.slice(0, i + 1)
      : imagePath.slice(0, imagePath.lastIndexOf("/") + 1)
  return `${base}labels/${name}`
}
