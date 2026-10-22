/**
 * LabelingWorkspace — label plot images by hand, as quickly as possible,
 * for training or fine-tuning a model later.
 *
 * The idea: show one example, let the models do the rest, confirm.
 *   1. Start from a model's detections (dashed: proposed) or a blank image.
 *   2. Draw a box (B) or click (P) on ONE object; F finds every similar
 *      object (YOLOE visual prompt) as proposals.
 *   3. Enter keeps all proposals; clicking one keeps or drops it.
 *   4. M turns kept boxes into exact masks (SAM 2).
 *   5. → saves the image and moves on. Objects kept so far are examples for
 *      the next images: their similar objects are proposed on arrival.
 *
 * Prompts run as LOCATE_PLANTS jobs with `prompted` (worker prompted.py).
 * The set is saved as versions next to the plot images; COCO export.
 */
import { useMutation, useQuery } from "@tanstack/react-query"
import {
  BoxSelect,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Maximize,
  MousePointer2,
  Plus,
  Save,
  Sparkles,
  SquareDashedMousePointer,
  Trash2,
  WandSparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { type JobOutput, JobsService, PlotGeometryService } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LabelingWorker } from "@/features/process/components/LabelingWorker"
import {
  classColour,
  useAuthedBlobUrl,
} from "@/features/process/components/predictionView"
import {
  type Ann,
  fromPrediction,
  type LabelSet,
  labelSetDirectory,
  newId,
  newProposals,
  toCoco,
} from "@/features/process/lib/labelSet"

type Tool = "select" | "box" | "point"

interface Exemplar {
  image: string
  box: [number, number, number, number]
  cls: string
}

/** Submit a prompted job and wait for its predictions (about a second
 *  once the worker has the model loaded). */
async function prompt(
  experimentId: string | undefined,
  image: string,
  prompted: Record<string, unknown>,
  onWait?: (note: string) => void,
): Promise<
  {
    class: string
    confidence?: number
    x: number
    y: number
    width: number
    height: number
    points?: { x: number; y: number }[]
  }[]
> {
  const job = (await JobsService.apiJobsSubmitSubmitJob({
    requestBody: {
      job_type: "LOCATE_PLANTS",
      parameters: { image_path: image, prompted },
      ...(experimentId ? { experiment_id: experimentId } : {}),
    } as Parameters<
      typeof JobsService.apiJobsSubmitSubmitJob
    >[0]["requestBody"],
  })) as JobOutput
  const id = String(job?.id ?? "")
  if (!id) throw new Error("The prompt job was not accepted")
  const started = Date.now()
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000))
    const j = (await JobsService.apiJobsJobIdGetJob({ jobId: id })) as JobOutput
    // Not picked up yet: no ML worker is running. The first one has to be
    // started on the cluster and fetch the models, which takes minutes.
    if (j.status === "PENDING" && Date.now() - started > 8_000)
      onWait?.(
        "Waiting for an ML worker on the cluster (see above; the first start takes a few minutes)…",
      )
    const stage = (j as { progress_detail?: { stage?: string } })
      .progress_detail?.stage
    if (j.status === "RUNNING" && stage?.startsWith("Downloading"))
      onWait?.(`${stage}…`)
    if (j.status === "COMPLETED")
      return (
        ((j as { result?: { predictions?: unknown } }).result
          ?.predictions as never) ?? []
      )
    if (j.status === "FAILED" || j.status === "CANCELLED")
      throw new Error(
        String(
          (j as { error_message?: string }).error_message ??
            "The prompt failed",
        ),
      )
    if (Date.now() - started > 600_000)
      throw new Error(
        "No answer after 10 minutes: is an ML worker running? (Settings → Compute)",
      )
  }
}

export function LabelingWorkspace({
  images,
  initial,
  experimentId,
  onClose,
}: {
  /** Object names of the images to label. */
  images: string[]
  /** A model's detections per image, offered as proposals. */
  initial?: Record<string, Parameters<typeof fromPrediction>[0][]>
  experimentId?: string
  onClose: () => void
}) {
  const directory = labelSetDirectory(images[0] ?? "")
  const saved = useQuery({
    queryKey: ["label-set", directory],
    queryFn: async () => {
      try {
        const r =
          (await PlotGeometryService.apiPlotGeometryVersionsLoadLoadVersion({
            requestBody: { directory },
          })) as { state_snapshot?: LabelSet }
        return r.state_snapshot ?? null
      } catch {
        return null
      }
    },
    staleTime: Number.POSITIVE_INFINITY,
  })
  const [set, setSet] = useState<LabelSet>({ classes: [], images: {} })
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (loaded || saved.isLoading) return
    const base: LabelSet = saved.data ?? { classes: [], images: {} }
    const classes = new Set(base.classes)
    for (const preds of Object.values(initial ?? {}))
      for (const p of preds) if (p.class) classes.add(p.class)
    setSet({ ...base, classes: [...classes] })
    setLoaded(true)
  }, [saved.isLoading, saved.data, initial, loaded])

  const [idx, setIdx] = useState(() =>
    Math.max(
      0,
      images.findIndex((p) => !saved.data?.images[p]?.done),
    ),
  )
  const image = images[idx]
  const [tool, setTool] = useState<Tool>("box")
  const [cls, setCls] = useState<string>("")
  const activeClass = cls || set.classes[0] || "object"
  const [busy, setBusy] = useState<string | null>(null)
  const ask = useCallback(
    (img: string, prompted: Record<string, unknown>) =>
      prompt(experimentId, img, prompted, setBusy),
    [experimentId],
  )
  const [selected, setSelected] = useState<string | null>(null)
  const [newClass, setNewClass] = useState("")
  const [dirty, setDirty] = useState(false)

  const img = set.images[image]
  const anns = img?.annotations ?? []
  const setAnns = useCallback(
    (fn: (a: Ann[]) => Ann[]) => {
      setSet((s) => {
        const cur = s.images[image] ?? {
          width: 0,
          height: 0,
          annotations: [],
          done: false,
        }
        return {
          ...s,
          images: {
            ...s.images,
            [image]: { ...cur, annotations: fn(cur.annotations) },
          },
        }
      })
      setDirty(true)
    },
    [image],
  )

  // First visit: the model's detections, as proposals.
  useEffect(() => {
    if (!loaded || !image || set.images[image]) return
    const props = (initial?.[image] ?? [])
      .map((p) => fromPrediction(p, "proposed", "model"))
      .filter((a): a is Ann => Boolean(a))
    setSet((s) => ({
      ...s,
      images: {
        ...s.images,
        [image]: { width: 0, height: 0, annotations: props, done: false },
      },
    }))
  }, [loaded, image, initial, set.images])

  // Examples kept on earlier images (newest first), for carrying over.
  const exemplars = useMemo<Exemplar[]>(() => {
    const out: Exemplar[] = []
    for (const p of images.slice(0, idx).reverse()) {
      const a = set.images[p]?.annotations.find((x) => x.status === "kept")
      if (a) out.push({ image: p, box: a.box, cls: a.cls })
      if (out.length >= 3) break
    }
    return out
  }, [images, idx, set.images])

  const findSimilar = useCallback(
    async (useCarried = false) => {
      if (!image) return
      const own = anns.filter(
        (a) => a.status === "kept" && a.cls === activeClass,
      )
      const ex = own.length
        ? {
            image,
            boxes: own.map((a) => a.box),
            classes: own.map((a) => a.cls),
          }
        : exemplars.length
          ? {
              image: exemplars[0].image,
              boxes: [exemplars[0].box],
              classes: [exemplars[0].cls],
            }
          : null
      if (!ex) {
        if (!useCarried)
          toast.info(
            "Draw a box around one example first (B), then find similar (F).",
          )
        return
      }
      setBusy("Finding similar objects…")
      try {
        const preds = await ask(image, {
          mode: "similar",
          boxes: ex.boxes,
          classes: ex.classes,
          ...(ex.image !== image ? { refer_image: ex.image } : {}),
        })
        const proposed = preds
          .map((p) => fromPrediction(p, "proposed", "similar"))
          .filter((a): a is Ann => Boolean(a))
        setAnns((a) => [...a, ...newProposals(a, proposed)])
        if (!useCarried)
          toast.success(
            `${proposed.length} proposed. Enter keeps them all; click any wrong one to drop it.`,
          )
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Finding similar failed")
      } finally {
        setBusy(null)
      }
    },
    [image, anns, activeClass, exemplars, setAnns, ask],
  )

  // Carry-over: an untouched image with earlier examples gets proposals.
  const carried = useRef(new Set<string>())
  useEffect(() => {
    if (!loaded || !image || carried.current.has(image)) return
    if (!exemplars.length || anns.length) return
    carried.current.add(image)
    void findSimilar(true)
  }, [loaded, image, exemplars, anns.length, findSimilar])

  const segmentKept = useCallback(async () => {
    const need = anns.filter((a) => a.status === "kept" && !a.points)
    if (!need.length) {
      toast.info("Every kept object already has a mask.")
      return
    }
    setBusy(`Masks for ${need.length} objects…`)
    try {
      const preds = await ask(image, {
        mode: "segment",
        boxes: need.map((a) => a.box),
      })
      setAnns((all) =>
        all.map((a) => {
          const i = need.findIndex((n) => n.id === a.id)
          const p = i >= 0 ? preds[i] : undefined
          return p?.points?.length
            ? {
                ...a,
                points: p.points.map((q) => [q.x, q.y] as [number, number]),
              }
            : a
        }),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Masks failed")
    } finally {
      setBusy(null)
    }
  }, [anns, image, setAnns, ask])

  const segmentPoint = useCallback(
    async (x: number, y: number) => {
      setBusy("Outlining the object…")
      try {
        const preds = await ask(image, {
          mode: "segment",
          points: [[x, y]],
          point_labels: [1],
          label: activeClass,
        })
        const a = preds[0]
          ? fromPrediction({ ...preds[0], class: activeClass }, "kept", "sam")
          : null
        if (a) setAnns((all) => [...all, a])
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Outlining failed")
      } finally {
        setBusy(null)
      }
    },
    [image, activeClass, setAnns, ask],
  )

  const save = useMutation({
    mutationFn: async (next: LabelSet) =>
      PlotGeometryService.apiPlotGeometryVersionsSaveSaveVersion({
        requestBody: {
          directory,
          state_snapshot: next as unknown as Record<string, unknown>,
          name: `labels: ${Object.values(next.images).filter((i) => i.done).length} images`,
        },
      }),
    onSuccess: () => setDirty(false),
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not save labels"),
  })

  const markDoneAndGo = (d: number) => {
    let next = set
    if (img) {
      next = {
        ...set,
        images: { ...set.images, [image]: { ...img, done: true } },
      }
      setSet(next)
    }
    if (dirty || img) save.mutate(next)
    setSelected(null)
    setIdx((i) => Math.max(0, Math.min(images.length - 1, i + d)))
  }

  // Keyboard: the whole flow without the mouse leaving the image.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (busy) return
      const k = e.key.toLowerCase()
      if (k === "b") setTool("box")
      else if (k === "p") setTool("point")
      else if (k === "v") setTool("select")
      else if (k === "f") void findSimilar()
      else if (k === "m") void segmentKept()
      else if (e.key === "Enter")
        setAnns((a) => a.map((x) => ({ ...x, status: "kept" as const })))
      else if (e.key === "Escape")
        setAnns((a) => a.filter((x) => x.status === "kept"))
      else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
        setAnns((a) => a.filter((x) => x.id !== selected))
        setSelected(null)
      } else if (e.key === "ArrowRight") markDoneAndGo(1)
      else if (e.key === "ArrowLeft") markDoneAndGo(-1)
      else if (e.key === "+" || e.key === "=") zoomTo(scale * 1.5)
      else if (e.key === "-" || e.key === "_") zoomTo(scale / 1.5)
      else if (e.key === "0") zoomTo(null)
      else if (/^[1-9]$/.test(e.key)) {
        const c = set.classes[Number(e.key) - 1]
        if (c) setCls(c)
      } else return
      e.preventDefault()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  // Drawing
  const url = useAuthedBlobUrl(image ? `gemini/${image}` : null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const viewRef = useRef<HTMLDivElement | null>(null)
  const [natural, setNatural] = useState<[number, number] | null>(null)
  const [fit, setFit] = useState(1)
  // null: fit the whole image in the view; else image pixels per screen pixel.
  const [zoom, setZoom] = useState<number | null>(null)
  const scale = zoom ?? fit
  const [drag, setDrag] = useState<[number, number, number, number] | null>(
    null,
  )
  const refit = useCallback(() => {
    const v = viewRef.current
    if (!v || !natural) return
    setFit(
      Math.min(
        (v.clientWidth - 2) / natural[0],
        (v.clientHeight - 2) / natural[1],
      ),
    )
  }, [natural])
  useEffect(() => {
    refit()
    const v = viewRef.current
    if (!v) return
    const ro = new ResizeObserver(refit)
    ro.observe(v)
    return () => ro.disconnect()
  }, [refit])
  const onImgLoad = () => {
    const el = imgRef.current
    if (!el) return
    setNatural([el.naturalWidth, el.naturalHeight])
    if (img && (!img.width || !img.height))
      setSet((s) => ({
        ...s,
        images: {
          ...s.images,
          [image]: {
            ...s.images[image],
            width: el.naturalWidth,
            height: el.naturalHeight,
          },
        },
      }))
  }
  // Each image opens fitted to the view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on image change only
  useEffect(() => setZoom(null), [image])

  /** Zoom to `next` (null: fit), keeping the point under (cx, cy) — view
   *  coordinates, default the view's middle — where it is. */
  const zoomTo = useCallback(
    (next: number | null, cx?: number, cy?: number) => {
      const v = viewRef.current
      const target = next === null ? null : Math.min(8, Math.max(fit, next))
      if (!v || target === null) {
        setZoom(null)
        return
      }
      const px = cx ?? v.clientWidth / 2
      const py = cy ?? v.clientHeight / 2
      // Image point under the pointer, before.
      const imgEl = imgRef.current
      const r = imgEl?.getBoundingClientRect()
      const vr = v.getBoundingClientRect()
      const ix = r ? (vr.left + px - r.left) / scale : 0
      const iy = r ? (vr.top + py - r.top) / scale : 0
      setZoom(target)
      requestAnimationFrame(() => {
        const r2 = imgRef.current?.getBoundingClientRect()
        if (!r2) return
        v.scrollLeft += r2.left + ix * target - (vr.left + px)
        v.scrollTop += r2.top + iy * target - (vr.top + py)
      })
    },
    [fit, scale],
  )
  // Ctrl/⌘ + wheel (or trackpad pinch) zooms at the pointer; a plain wheel scrolls.
  useEffect(() => {
    const v = viewRef.current
    if (!v) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const vr = v.getBoundingClientRect()
      zoomTo(
        scale * Math.exp(-e.deltaY * 0.0025),
        e.clientX - vr.left,
        e.clientY - vr.top,
      )
    }
    v.addEventListener("wheel", onWheel, { passive: false })
    return () => v.removeEventListener("wheel", onWheel)
  }, [scale, zoomTo])
  // Space + drag pans the zoomed image.
  const [spaceHeld, setSpaceHeld] = useState(false)
  const pan = useRef<[number, number, number, number] | null>(null)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (
        e.code === "Space" &&
        !(t && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))
      ) {
        e.preventDefault()
        setSpaceHeld(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false)
    }
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [])
  const toImage = (e: React.MouseEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect()
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale] as const
  }

  const kept = anns.filter((a) => a.status === "kept").length
  const proposed = anns.length - kept
  const doneCount = Object.values(set.images).filter((i) => i.done).length

  const exportCoco = () => {
    const blob = new Blob([JSON.stringify(toCoco(set), null, 1)], {
      type: "application/json",
    })
    const href = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = href
    a.download = "annotations.coco.json"
    a.click()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
  }

  return (
    <div className="flex flex-col gap-2" data-testid="labeling">
      <LabelingWorker experimentId={experimentId} />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Button size="sm" variant="ghost" className="h-7" onClick={onClose}>
          ← Back to results
        </Button>
        <span className="font-medium">
          {image?.split("/").pop()} · {idx + 1} / {images.length}
        </span>
        <span className="text-muted-foreground">
          {doneCount} labelled · {kept} kept
          {proposed ? ` · ${proposed} proposed` : ""}
        </span>
        {busy && (
          <span className="flex items-center gap-1 text-primary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {busy}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={!doneCount}
            onClick={exportCoco}
            title="The kept objects of every saved image, as COCO JSON for training"
          >
            <Download className="mr-1 h-3.5 w-3.5" /> COCO
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={save.isPending}
            onClick={() => save.mutate(set)}
          >
            <Save className="mr-1 h-3.5 w-3.5" />
            {save.isPending ? "Saving…" : dirty ? "Save" : "Saved"}
          </Button>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-xs">
        {(
          [
            ["box", "B", "Box", BoxSelect],
            ["point", "P", "Click → outline", MousePointer2],
            ["select", "V", "Select", SquareDashedMousePointer],
          ] as const
        ).map(([t, key, label, Icon]) => (
          <Button
            key={t}
            size="sm"
            variant={tool === t ? "default" : "outline"}
            className="h-7 px-2"
            onClick={() => setTool(t)}
            title={`${label} (${key})`}
          >
            <Icon className="mr-1 h-3.5 w-3.5" /> {label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          disabled={Boolean(busy)}
          onClick={() => void findSimilar()}
          title="Propose every object like your example (F)"
        >
          <Sparkles className="mr-1 h-3.5 w-3.5" /> Find similar
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          disabled={Boolean(busy) || !kept}
          onClick={() => void segmentKept()}
          title="Exact masks for the kept boxes (M)"
        >
          <WandSparkles className="mr-1 h-3.5 w-3.5" /> Masks
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2"
          disabled={!proposed}
          onClick={() =>
            setAnns((a) => a.map((x) => ({ ...x, status: "kept" as const })))
          }
          title="Keep every proposal (Enter)"
        >
          Keep all
        </Button>
        {selected && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2"
            onClick={() => {
              setAnns((a) => a.filter((x) => x.id !== selected))
              setSelected(null)
            }}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
          </Button>
        )}
        <span className="text-muted-foreground mx-2">Class</span>
        {set.classes.map((c, i) => (
          <Button
            key={c}
            size="sm"
            variant={activeClass === c ? "default" : "outline"}
            className="h-7 px-2"
            onClick={() => setCls(c)}
            title={`${c} (${i + 1})`}
          >
            <span
              className="mr-1 inline-block h-2 w-2 rounded-full"
              style={{ background: classColour(c) }}
            />
            {c}
          </Button>
        ))}
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault()
            const c = newClass.trim()
            if (!c) return
            setSet((s) =>
              s.classes.includes(c) ? s : { ...s, classes: [...s.classes, c] },
            )
            setCls(c)
            setNewClass("")
          }}
        >
          <Input
            value={newClass}
            onChange={(e) => setNewClass(e.target.value)}
            placeholder="new class"
            className="h-7 w-28 text-xs"
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            type="submit"
            aria-label="Add class"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="text-muted-foreground mr-1">Zoom</span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0"
          aria-label="Zoom out"
          title="Zoom out (−)"
          onClick={() => zoomTo(scale / 1.5)}
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <span className="w-12 text-center tabular-nums">
          {Math.round(scale * 100)}%
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 w-7 p-0"
          aria-label="Zoom in"
          title="Zoom in (+)"
          onClick={() => zoomTo(scale * 1.5)}
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant={zoom === null ? "secondary" : "outline"}
          className="h-7"
          title="Fit the whole image in the view (0)"
          onClick={() => zoomTo(null)}
        >
          <Maximize className="mr-1 h-3.5 w-3.5" /> Fit
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          title="One image pixel per screen pixel"
          onClick={() => zoomTo(1)}
        >
          100%
        </Button>
        <span className="text-muted-foreground ml-2">
          Ctrl/⌘ + scroll zooms at the pointer · scroll or hold Space and drag
          to move around
        </span>
      </div>

      {/* biome-ignore lint/a11y/noStaticElementInteractions: Space-drag panning; the view also scrolls by keyboard and scrollbars */}
      <div
        ref={viewRef}
        className="flex h-[70vh] overflow-auto rounded border bg-black"
        style={{
          cursor: spaceHeld ? (pan.current ? "grabbing" : "grab") : undefined,
        }}
        onMouseDownCapture={(e) => {
          if (!spaceHeld || !viewRef.current) return
          e.preventDefault()
          e.stopPropagation()
          const v = viewRef.current
          pan.current = [e.clientX, e.clientY, v.scrollLeft, v.scrollTop]
        }}
        onMouseMoveCapture={(e) => {
          if (!pan.current || !viewRef.current) return
          e.stopPropagation()
          const [x0, y0, l0, t0] = pan.current
          viewRef.current.scrollLeft = l0 - (e.clientX - x0)
          viewRef.current.scrollTop = t0 - (e.clientY - y0)
        }}
        onMouseUpCapture={(e) => {
          if (!pan.current) return
          e.stopPropagation()
          pan.current = null
        }}
        onMouseLeave={() => {
          pan.current = null
        }}
      >
        {url ? (
          // m-auto centres the image while it is smaller than the view, and
          // lets it scroll from its edge once it is larger.
          <div className="relative m-auto shrink-0">
            <img
              ref={imgRef}
              src={url}
              alt=""
              onLoad={onImgLoad}
              className="block max-w-none"
              style={
                natural
                  ? { width: natural[0] * scale, height: natural[1] * scale }
                  : { maxWidth: "100%", maxHeight: "100%" }
              }
              draggable={false}
            />
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: drawing surface; every action has a key (B, P, F, M, Enter, arrows) */}
            <svg
              className="absolute inset-0 h-full w-full"
              style={{ cursor: tool === "select" ? "default" : "crosshair" }}
              onMouseDown={(e) => {
                if (tool !== "box" || busy) return
                const [x, y] = toImage(e)
                setDrag([x, y, x, y])
              }}
              onMouseMove={(e) => {
                if (!drag) return
                const [x, y] = toImage(e)
                setDrag([drag[0], drag[1], x, y])
              }}
              onMouseUp={() => {
                if (!drag) return
                const [x1, y1, x2, y2] = drag
                setDrag(null)
                if (Math.abs(x2 - x1) < 4 || Math.abs(y2 - y1) < 4) return
                setAnns((a) => [
                  ...a,
                  {
                    id: newId(),
                    cls: activeClass,
                    box: [
                      Math.min(x1, x2),
                      Math.min(y1, y2),
                      Math.max(x1, x2),
                      Math.max(y1, y2),
                    ],
                    status: "kept",
                    source: "hand",
                  },
                ])
              }}
              onClick={(e) => {
                if (tool !== "point" || busy) return
                const [x, y] = toImage(e)
                void segmentPoint(x, y)
              }}
            >
              <title>Labels</title>
              {anns.map((a) => {
                const colour = classColour(a.cls)
                const [x1, y1, x2, y2] = a.box.map((v) => v * scale)
                const isSel = a.id === selected
                return (
                  // biome-ignore lint/a11y/noStaticElementInteractions: SVG shapes; the keyboard flow covers the same actions
                  <g
                    key={a.id}
                    onClick={(e) => {
                      if (tool !== "select") return
                      e.stopPropagation()
                      if (a.status === "proposed")
                        setAnns((all) =>
                          all.map((x) =>
                            x.id === a.id ? { ...x, status: "kept" } : x,
                          ),
                        )
                      else setSelected(isSel ? null : a.id)
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setAnns((all) => all.filter((x) => x.id !== a.id))
                    }}
                    style={{
                      cursor: tool === "select" ? "pointer" : undefined,
                    }}
                  >
                    {a.points && (
                      <polygon
                        points={a.points
                          .map(([px, py]) => `${px * scale},${py * scale}`)
                          .join(" ")}
                        fill={colour}
                        fillOpacity={a.status === "kept" ? 0.3 : 0.12}
                        stroke="none"
                      />
                    )}
                    <rect
                      x={x1}
                      y={y1}
                      width={x2 - x1}
                      height={y2 - y1}
                      fill="transparent"
                      stroke={colour}
                      strokeWidth={isSel ? 3 : 2}
                      strokeDasharray={
                        a.status === "proposed" ? "5 4" : undefined
                      }
                    />
                  </g>
                )
              })}
              {drag && (
                <rect
                  x={Math.min(drag[0], drag[2]) * scale}
                  y={Math.min(drag[1], drag[3]) * scale}
                  width={Math.abs(drag[2] - drag[0]) * scale}
                  height={Math.abs(drag[3] - drag[1]) * scale}
                  fill="transparent"
                  stroke={classColour(activeClass)}
                  strokeWidth={2}
                />
              )}
            </svg>
          </div>
        ) : (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-white/60" />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs">
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          disabled={idx === 0}
          onClick={() => markDoneAndGo(-1)}
        >
          <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Previous
        </Button>
        <Button
          size="sm"
          className="h-7"
          disabled={idx >= images.length - 1}
          onClick={() => markDoneAndGo(1)}
        >
          Save &amp; next <ChevronRight className="ml-1 h-3.5 w-3.5" />
        </Button>
        <span className="text-muted-foreground">
          Draw one example (B) → Find similar (F) → Enter keeps all, click a
          proposal to keep it, right-click to drop → Masks (M) → → next. Earlier
          examples are proposed on each new image.
        </span>
      </div>
    </div>
  )
}
