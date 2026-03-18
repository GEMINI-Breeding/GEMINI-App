/**
 * GcpPicker — interactive tool for aerial pipeline Step 1.
 *
 * Flow:
 *  1. If gcp_locations.csv is missing, show an inline upload panel.
 *  2. GCP dropdown at top — select GCP from list; shows image count per GCP.
 *  3. Image slider below the viewer — scrub through all images.
 *     Colored diamond markers on the slider track show ALL marked images from ALL GCPs.
 *     A number label below each diamond shows which GCP it belongs to.
 *  4. Click anywhere on the image to set the pixel coordinate for the active GCP.
 *     Multiple images can be marked per GCP.
 *  5. Save when all GCPs have at least one image marked.
 */

import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Filter,
  MapPin,
  Minus,
  Plus,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? "";
  return base ? `${base}${path}` : path;
}

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProcessingService } from "@/client";
import useCustomToast from "@/hooks/useCustomToast";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GcpEntry {
  label: string;
  lat: number;
  lon: number;
  alt: number;
}

interface ImageEntry {
  name: string;
  lat: number | null;
  lon: number | null;
  alt: number | null;
}

interface ExistingSelection {
  label: string;
  image: string;
  pixel_x: number;
  pixel_y: number;
  lat: number;
  lon: number;
  alt: number;
}

interface GcpCandidatesResponse {
  has_gcp_locations: boolean;
  gcps: GcpEntry[];
  images: ImageEntry[];
  count: number;
  total_images: number;
  filtered: boolean;
  radius_m: number;
  no_gps_count: number;
  has_msgs_synced: boolean;
  raw_dir: string;
  existing_selections: ExistingSelection[];
}

/** A single pixel marking for one GCP on one image. */
interface GcpMarkEntry {
  image: string;
  pixel_x: number;
  pixel_y: number;
}

interface GcpPickerProps {
  runId: string;
  onSaved: () => void;
  onCancel: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** One color per GCP (cycles if more GCPs than colors). */
const GCP_COLORS = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#22c55e", // green
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
];

function gcpColor(idx: number): string {
  return GCP_COLORS[idx % GCP_COLORS.length];
}

// ── Inline CSV upload panel ───────────────────────────────────────────────────

interface CsvUploadPanelProps {
  runId: string;
  onLoaded: () => void;
}

function CsvUploadPanel({ runId, onLoaded }: CsvUploadPanelProps) {
  const { showErrorToast } = useCustomToast();
  const [csvText, setCsvText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const saveMutation = useMutation({
    mutationFn: (text: string) =>
      ProcessingService.saveGcpLocations({
        id: runId,
        requestBody: { csv_text: text },
      }),
    onSuccess: onLoaded,
    onError: () => showErrorToast("Failed to save GCP locations"),
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev: ProgressEvent<FileReader>) =>
      setCsvText((ev.target?.result as string) ?? "");
    reader.readAsText(file);
  };

  return (
    <div className="mx-auto max-w-xl space-y-4 py-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <MapPin className="text-muted-foreground h-10 w-10" />
        <h3 className="font-medium">GCP Locations Required</h3>
        <p className="text-muted-foreground text-sm">
          No <code>gcp_locations.csv</code> found. Paste the CSV content below
          or pick the file. Format:{" "}
          <code className="text-xs">Label, Lat_dec, Lon_dec, Altitude</code>
        </p>
      </div>
      <div className="space-y-2">
        <Label>CSV content</Label>
        <Textarea
          rows={8}
          placeholder={
            "Label,Lat_dec,Lon_dec,Altitude\nGCP1,33.4512,-111.9876,380.5\nGCP2,33.4498,-111.9845,381.0"
          }
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          className="font-mono text-xs"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" />
          Pick File
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleFile}
        />
        <Button
          className="flex-1"
          disabled={!csvText.trim() || saveMutation.isPending}
          onClick={() => saveMutation.mutate(csvText)}
        >
          {saveMutation.isPending ? "Saving…" : "Load GCP Locations"}
        </Button>
      </div>
    </div>
  );
}

// ── Letterbox helper ──────────────────────────────────────────────────────────

/** Compute the rendered image rect inside an object-contain container. */
function getLetterbox(
  naturalW: number,
  naturalH: number,
  cw: number,
  ch: number
) {
  const imgAspect = naturalW / naturalH;
  const containerAspect = cw / ch;
  if (imgAspect > containerAspect) {
    const h = cw / imgAspect;
    return { x: 0, y: (ch - h) / 2, w: cw, h };
  }
  const w = ch * imgAspect;
  return { x: (cw - w) / 2, y: 0, w, h: ch };
}

/** Great-circle distance in metres between two WGS-84 points. */
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** Browser range-input thumb width in px — used to correct marker alignment. */
const THUMB_PX = 16;

/** Compute left CSS value that lines up a centered marker with a slider thumb at `pct` %. */
function sliderLeft(pct: number): string {
  const offset = (0.5 - pct / 100) * THUMB_PX;
  return `calc(${pct}% + ${offset}px)`;
}

// ── Main picker ───────────────────────────────────────────────────────────────

export function GcpPicker({
  runId,
  onSaved,
  onCancel: _onCancel,
}: GcpPickerProps) {
  const { showErrorToast, showSuccessToast } = useCustomToast();
  const queryClient = useQueryClient();

  const [filterByGcp, setFilterByGcp] = useState(true)
  const [confirmClear, setConfirmClear] = useState(false);

  const { data, isLoading, refetch } = useQuery<GcpCandidatesResponse>({
    queryKey: ["gcp-candidates", runId, filterByGcp],
    queryFn: () => {
      const params = new URLSearchParams({
        filter_by_gcp: String(filterByGcp),
      });
      return fetch(
        apiUrl(`/api/v1/pipeline-runs/${runId}/gcp-candidates?${params}`),
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
          },
        }
      ).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<GcpCandidatesResponse>;
      });
    },
  });

  // Multiple marks per GCP: label → list of {image, pixel_x, pixel_y}
  const [markings, setMarkings] = useState<Record<string, GcpMarkEntry[]>>({});
  const [activeGcpLabel, setActiveGcpLabel] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // Zoom / pan state
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [editingIdx, setEditingIdx] = useState(false);
  const [editIdxValue, setEditIdxValue] = useState("");
  const zoomRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });
  zoomRef.current = zoom;
  offsetRef.current = offset;

  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragMovedRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });

  const gcps = data?.gcps ?? [];
  const allImages = data?.images ?? [];
  const rawDir = data?.raw_dir ?? "";

  const activeGcp =
    gcps.find((g) => g.label === activeGcpLabel) ?? gcps[0] ?? null;
  const activeLabel = activeGcp?.label ?? null;
  const activeGcpIdx = gcps.findIndex((g) => g.label === activeLabel);
  const activeColor = activeGcpIdx >= 0 ? gcpColor(activeGcpIdx) : "#ef4444";

  // Marks for the active GCP
  const activeGcpMarks: GcpMarkEntry[] = activeLabel
    ? (markings[activeLabel] ?? [])
    : [];
  // Mark on the currently-displayed image (if any) for the active GCP
  const activeMark =
    activeGcpMarks.find((m) => m.image === selectedImage) ?? null;

  // All marks from all GCPs flattened (for slider display)
  const allMarks = Object.entries(markings).flatMap(([label, marks]) =>
    marks.map((m) => ({
      ...m,
      label,
      gcpIdx: gcps.findIndex((g) => g.label === label),
    }))
  );

  // Slider uses allImages order — no resorting, so index is stable across GCP switches
  const selectedIdx = allImages.findIndex((img) => img.name === selectedImage);
  const sliderMax = Math.max(0, allImages.length - 1);

  // Nearest GCP to the currently displayed image (requires valid GPS on the image)
  const selectedImageData = allImages.find((img) => img.name === selectedImage) ?? null
  const nearestGcp: (GcpEntry & { dist_m: number }) | null = (() => {
    if (!selectedImageData?.lat || !selectedImageData?.lon || gcps.length === 0) return null
    let best: (GcpEntry & { dist_m: number }) | null = null
    for (const gcp of gcps) {
      const d = haversineM(selectedImageData.lat, selectedImageData.lon, gcp.lat, gcp.lon)
      if (best === null || d < best.dist_m) best = { ...gcp, dist_m: d }
    }
    return best
  })()

  // ── View reset helper ─────────────────────────────────────────────────────

  function resetView() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  // ── Pan clamping ──────────────────────────────────────────────────────────

  function clamp(ox: number, oy: number, z: number) {
    const el = containerRef.current;
    if (!el) return { x: ox, y: oy };
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    return {
      x: Math.min(0, Math.max(ox, cw * (1 - z))),
      y: Math.min(0, Math.max(oy, ch * (1 - z))),
    };
  }

  // ── Zoom helpers (centered on image midpoint) ─────────────────────────────

  function applyZoom(dz: number) {
    const el = containerRef.current;
    if (!el) return;
    const prevZoom = zoomRef.current;
    const newZoom = Math.min(Math.max(prevZoom * dz, 1), 10);
    if (newZoom <= 1) {
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      return;
    }
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    const ratio = newZoom / prevZoom;
    const prev = offsetRef.current;
    const raw = {
      x: cx * (1 - ratio) + prev.x * ratio,
      y: cy * (1 - ratio) + prev.y * ratio,
    };
    const clamped = {
      x: Math.min(0, Math.max(raw.x, el.clientWidth * (1 - newZoom))),
      y: Math.min(0, Math.max(raw.y, el.clientHeight * (1 - newZoom))),
    };
    setZoom(newZoom);
    setOffset(clamped);
  }

  // ── Keyboard navigation ───────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSelectedImage((cur) => {
          const idx = allImages.findIndex((c) => c.name === cur);
          return idx > 0 ? allImages[idx - 1].name : cur;
        });
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setSelectedImage((cur) => {
          const idx = allImages.findIndex((c) => c.name === cur);
          return idx < allImages.length - 1 ? allImages[idx + 1].name : cur;
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [allImages]);

  // ── Restore previously saved markings ────────────────────────────────────
  // Use `data` (object reference) so this re-runs when a background refetch
  // delivers fresh data (e.g. data now has existing_selections but cached
  // version didn't).

  useEffect(() => {
    if (!data) return;
    const saved = data.existing_selections ?? [];
    const restored: Record<string, GcpMarkEntry[]> = {};
    for (const sel of saved) {
      if (!restored[sel.label]) restored[sel.label] = [];
      restored[sel.label].push({
        image: sel.image,
        pixel_x: sel.pixel_x,
        pixel_y: sel.pixel_y,
      });
    }
    setMarkings(restored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // ── Initial image selection ───────────────────────────────────────────────

  useEffect(() => {
    if (allImages.length > 0 && selectedImage === null) {
      setSelectedImage(allImages[0].name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!data]);

  // ── Navigation helpers ────────────────────────────────────────────────────

  function goToPrevImage() {
    const idx = allImages.findIndex((img) => img.name === selectedImage);
    if (idx > 0) setSelectedImage(allImages[idx - 1].name);
  }

  function goToNextImage() {
    const idx = allImages.findIndex((img) => img.name === selectedImage);
    if (idx < allImages.length - 1) setSelectedImage(allImages[idx + 1].name);
  }

  // ── GCP switch handler — keep current image position ─────────────────────

  function handleGcpChange(newLabel: string) {
    setActiveGcpLabel(newLabel);
    // Don't change selectedImage — user stays at the same image position
  }

  // ── Navigate through marked images for the active GCP ────────────────────

  // Marked images for active GCP sorted by their index in allImages
  const activeMarksSorted = activeLabel
    ? [...(markings[activeLabel] ?? [])].sort(
        (a, b) =>
          allImages.findIndex((i) => i.name === a.image) -
          allImages.findIndex((i) => i.name === b.image)
      )
    : [];

  const currentMarkPos = activeMarksSorted.findIndex(
    (m) => m.image === selectedImage
  );

  function goToPrevMark() {
    if (activeMarksSorted.length === 0) return;
    if (currentMarkPos <= 0) {
      // Wrap to last mark
      setSelectedImage(activeMarksSorted[activeMarksSorted.length - 1].image);
    } else {
      setSelectedImage(activeMarksSorted[currentMarkPos - 1].image);
    }
  }

  function goToNextMark() {
    if (activeMarksSorted.length === 0) return;
    if (currentMarkPos < 0 || currentMarkPos >= activeMarksSorted.length - 1) {
      setSelectedImage(activeMarksSorted[0].image);
    } else {
      setSelectedImage(activeMarksSorted[currentMarkPos + 1].image);
    }
  }

  // ── GCP marking ───────────────────────────────────────────────────────────

  function markAtClient(clientX: number, clientY: number) {
    if (
      !activeLabel ||
      !selectedImage ||
      !containerRef.current ||
      !imgRef.current
    )
      return;
    const naturalW = imgRef.current.naturalWidth;
    const naturalH = imgRef.current.naturalHeight;
    if (!naturalW || !naturalH) return;
    const rect = containerRef.current.getBoundingClientRect();
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const dx = (cx - offsetRef.current.x) / zoomRef.current;
    const dy = (cy - offsetRef.current.y) / zoomRef.current;
    const lb = getLetterbox(naturalW, naturalH, cw, ch);
    const imgX = dx - lb.x;
    const imgY = dy - lb.y;
    if (imgX < 0 || imgX > lb.w || imgY < 0 || imgY > lb.h) return;
    const px = Math.round((imgX / lb.w) * naturalW);
    const py = Math.round((imgY / lb.h) * naturalH);
    setMarkings((prev) => {
      const existing = prev[activeLabel] ?? [];
      // Replace mark for same image, or add new
      const filtered = existing.filter((m) => m.image !== selectedImage);
      return {
        ...prev,
        [activeLabel]: [
          ...filtered,
          { image: selectedImage, pixel_x: px, pixel_y: py },
        ],
      };
    });
  }

  // ── Drag / pan + click ────────────────────────────────────────────────────

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragMovedRef.current = false;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      ox: offsetRef.current.x,
      oy: offsetRef.current.y,
    };
    setIsPanning(true);

    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - dragStartRef.current.x;
      const dy = me.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMovedRef.current = true;
      if (dragMovedRef.current) {
        const c = clamp(
          dragStartRef.current.ox + dx,
          dragStartRef.current.oy + dy,
          zoomRef.current
        );
        setOffset(c);
      }
    };
    const onUp = (me: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setIsPanning(false);
      if (!dragMovedRef.current) markAtClient(me.clientX, me.clientY);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Right-click removes the active GCP mark on the current image
  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!activeLabel || !selectedImage) return;
    setMarkings((prev) => {
      const existing = prev[activeLabel] ?? [];
      const filtered = existing.filter((m) => m.image !== selectedImage);
      if (filtered.length === 0) {
        const next = { ...prev };
        delete next[activeLabel];
        return next;
      }
      return { ...prev, [activeLabel]: filtered };
    });
  };

  // ── Crosshair positions (all marks on current image) ─────────────────────

  function getCrosshairPos(
    mark: GcpMarkEntry
  ): { left: number; top: number } | null {
    if (!imgRef.current || !containerRef.current) return null;
    const naturalW = imgRef.current.naturalWidth;
    const naturalH = imgRef.current.naturalHeight;
    if (!naturalW || !naturalH) return null;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const lb = getLetterbox(naturalW, naturalH, cw, ch);
    return {
      left: lb.x + (mark.pixel_x / naturalW) * lb.w,
      top: lb.y + (mark.pixel_y / naturalH) * lb.h,
    };
  }

  // All marks on the current image (from all GCPs)
  const currentImageMarks = Object.entries(markings).flatMap(([label, marks]) =>
    marks
      .filter((m) => m.image === selectedImage)
      .map((m) => ({
        ...m,
        label,
        gcpIdx: gcps.findIndex((g) => g.label === label),
      }))
  );

  // ── Save mutation ─────────────────────────────────────────────────────────

  const unmarked = gcps.filter(
    (g) => !markings[g.label] || markings[g.label].length === 0
  );
  const totalMarked = gcps.length - unmarked.length;
  const canSave = totalMarked > 0;

  const saveMutation = useMutation({
    mutationFn: () => {
      // Flatten all marks into a list of {label, image, pixel_x, pixel_y, lat, lon, alt}
      const selections = Object.entries(markings).flatMap(([label, marks]) => {
        const gcp = gcps.find((g) => g.label === label)!;
        return marks.map((m) => ({
          label,
          image: m.image,
          pixel_x: m.pixel_x,
          pixel_y: m.pixel_y,
          lat: gcp.lat,
          lon: gcp.lon,
          alt: gcp.alt,
        }));
      });
      const imageGps = allImages.map((img) => ({
        image: img.name,
        lat: img.lat ?? 0,
        lon: img.lon ?? 0,
        alt: img.alt ?? 0,
      }));
      return ProcessingService.saveGcpSelection({
        id: runId,
        requestBody: {
          gcp_selections: selections as unknown as { [key: string]: unknown }[],
          image_gps: imageGps as unknown as { [key: string]: unknown }[],
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] });
      showSuccessToast("GCPs saved successfully");
    },
    onError: () => showErrorToast("Failed to save GCP selection"),
  });

  // ── Early returns ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex h-64 items-center justify-center text-sm">
        Loading…
      </div>
    );
  }

  if (!data?.has_gcp_locations) {
    return <CsvUploadPanel runId={runId} onLoaded={() => refetch()} />;
  }

  if (gcps.length === 0) {
    return (
      <div className="text-muted-foreground flex h-48 flex-col items-center justify-center gap-2">
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm">
          GCP locations file is empty or could not be parsed.
        </p>
      </div>
    );
  }

  if (allImages.length === 0) {
    return (
      <div className="text-muted-foreground flex h-48 flex-col items-center justify-center gap-3">
        <AlertCircle className="h-8 w-8" />
        <div className="space-y-1 text-center">
          <p className="text-sm font-medium">No images found</p>
          <p className="text-xs">
            Expected images in:{" "}
            <code className="bg-muted rounded px-1 py-0.5 text-xs break-all">
              {rawDir}
            </code>
          </p>
          <p className="text-xs">
            Make sure the data sync step completed successfully.
          </p>
        </div>
      </div>
    );
  }

  const imgSrc = selectedImage
    ? apiUrl(
        `/api/v1/files/serve?path=${encodeURIComponent(rawDir + "/" + selectedImage)}`
      )
    : null;

  return (
    <div className="space-y-3">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!canSave || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? "Saving…" : "Save GCPs"}
        </Button>
        <Button variant="outline" size="sm" onClick={onSaved}>
          Done
        </Button>

        <div className="bg-border mx-1 h-5 w-px" />

        <span className="text-muted-foreground text-sm whitespace-nowrap">
          GCP:
        </span>
        <Select value={activeLabel ?? ""} onValueChange={handleGcpChange}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Select…" />
          </SelectTrigger>
          <SelectContent>
            {gcps.map((gcp, idx) => {
              const marks = markings[gcp.label] ?? [];
              const color = gcpColor(idx);
              return (
                <SelectItem key={gcp.label} value={gcp.label}>
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block h-3 w-3 shrink-0 rounded-full"
                      style={
                        marks.length > 0
                          ? { backgroundColor: color }
                          : { border: "2px solid #9ca3af" }
                      }
                    />
                    {gcp.label}
                    {marks.length > 0 && (
                      <span className="text-muted-foreground text-xs">
                        ({marks.length})
                      </span>
                    )}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {/* Navigate between marked images for the active GCP */}
        <Button
          variant="ghost"
          size="icon"
          disabled={activeMarksSorted.length === 0}
          onClick={goToPrevMark}
          title="Previous marked image for this GCP"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-muted-foreground text-xs tabular-nums">
          {activeMarksSorted.length > 0
            ? `${currentMarkPos >= 0 ? currentMarkPos + 1 : "–"}/${activeMarksSorted.length} marks`
            : "no marks"}
        </span>
        <Button
          variant="ghost"
          size="icon"
          disabled={activeMarksSorted.length === 0}
          onClick={goToNextMark}
          title="Next marked image for this GCP"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>

        <div className="flex-1" />

        <Button
          variant="ghost"
          size="icon"
          disabled={selectedIdx <= 0}
          onClick={goToPrevImage}
          title="Previous image (←)"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {/* Clickable image counter — click to jump to an image by number */}
        {editingIdx ? (
          <input
            type="number"
            min={1}
            max={allImages.length}
            value={editIdxValue}
            className="w-16 rounded border px-1 py-0.5 text-center text-xs tabular-nums"
            autoFocus
            onChange={(e) => setEditIdxValue(e.target.value)}
            onBlur={() => {
              const n = parseInt(editIdxValue);
              if (!isNaN(n) && n >= 1 && n <= allImages.length)
                setSelectedImage(allImages[n - 1].name);
              setEditingIdx(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const n = parseInt(editIdxValue);
                if (!isNaN(n) && n >= 1 && n <= allImages.length)
                  setSelectedImage(allImages[n - 1].name);
                setEditingIdx(false);
              } else if (e.key === "Escape") {
                setEditingIdx(false);
              }
            }}
          />
        ) : (
          <span
            className="text-muted-foreground hover:text-foreground min-w-[4rem] cursor-pointer text-center text-xs tabular-nums hover:underline"
            title="Click to jump to image number"
            onClick={() => {
              setEditIdxValue(String(selectedIdx + 1));
              setEditingIdx(true);
            }}
          >
            {allImages.length > 0
              ? `${selectedIdx + 1} / ${allImages.length}`
              : "—"}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          disabled={selectedIdx >= allImages.length - 1}
          onClick={goToNextImage}
          title="Next image (→)"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* ── Filter toggle + info banner ── */}
      {data && (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            {data.filtered ? (
              <>
                Showing <strong>{data.count}</strong> of{" "}
                <strong>{data.total_images}</strong> images within{" "}
                <strong>{data.radius_m} m</strong> of a GCP
                {data.has_msgs_synced ? " (platform-log GPS)" : " (EXIF GPS)"}.
                {data.no_gps_count > 0 && (
                  <>
                    {" "}
                    <strong>{data.no_gps_count}</strong> image
                    {data.no_gps_count > 1 ? "s" : ""} with no GPS excluded.
                  </>
                )}
              </>
            ) : filterByGcp ? (
              <span className="text-amber-700 dark:text-amber-400">
                No images found near GCPs — showing all{" "}
                <strong>{data.total_images}</strong> images.
                {data.no_gps_count === data.total_images &&
                  " All images lack GPS data."}
              </span>
            ) : (
              <>
                Showing all <strong>{data.total_images}</strong> images (filter
                off).
              </>
            )}
          </span>
          <button
            type="button"
            onClick={() => setFilterByGcp((v) => !v)}
            className={`flex items-center gap-1 rounded px-2 py-0.5 font-medium transition-colors ${
              filterByGcp
                ? "bg-blue-200 text-blue-900 hover:bg-blue-300 dark:bg-blue-800 dark:text-blue-100"
                : "bg-transparent text-blue-600 hover:bg-blue-100 dark:text-blue-400"
            }`}
          >
            <Filter className="h-3 w-3" />
            {filterByGcp ? "Filtered" : "Show all"}
          </button>
        </div>
      )}

      {/* ── GCP status line ── */}
      {activeGcp && (
        <div className="text-muted-foreground flex items-center gap-3 px-1 text-xs">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: activeColor }}
          />
          <span>
            {activeGcp.lat.toFixed(6)}, {activeGcp.lon.toFixed(6)} ·{" "}
            {activeGcp.alt}m
          </span>
          <span className="text-border">·</span>
          {activeGcpMarks.length > 0 ? (
            <span
              className="flex items-center gap-1"
              style={{ color: activeColor }}
            >
              <Check className="h-3 w-3" />
              {activeGcpMarks.length} image
              {activeGcpMarks.length > 1 ? "s" : ""} marked
              {activeMark && (
                <span className="text-muted-foreground ml-1">
                  (right-click to remove this one)
                </span>
              )}
            </span>
          ) : (
            <span className="text-amber-600">
              Not yet marked — click the image to mark this GCP
            </span>
          )}
          {unmarked.length > 0 && (
            <>
              <span className="text-border">·</span>
              <span className="text-muted-foreground ml-auto">
                {unmarked.length} GCP{unmarked.length > 1 ? "s" : ""} not yet
                marked
              </span>
            </>
          )}
        </div>
      )}

      {/* ── Image viewer ── */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-lg bg-black select-none"
        style={{
          aspectRatio: "16/9",
          cursor: isPanning ? "grabbing" : "crosshair",
        }}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        onDoubleClick={resetView}
      >
        {imgSrc ? (
          <>
            {/* Transformed wrapper — crosshairs live here so they move with the image */}
            <div
              className="absolute inset-0"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                transformOrigin: "0 0",
              }}
            >
              <img
                ref={imgRef}
                src={imgSrc}
                alt={selectedImage ?? ""}
                className="h-full w-full object-contain"
                draggable={false}
              />
              {/* Crosshairs for all GCP marks on this image */}
              {currentImageMarks.map((m) => {
                const pos = getCrosshairPos(m);
                if (!pos) return null;
                const color = gcpColor(m.gcpIdx);
                const isActive = m.label === activeLabel;
                return (
                  <div
                    key={`${m.label}-crosshair`}
                    className="pointer-events-none absolute"
                    style={{ left: pos.left, top: pos.top }}
                  >
                    <div
                      className="absolute -translate-x-1/2 -translate-y-1/2"
                      style={{
                        width: isActive ? 28 : 22,
                        height: isActive ? 28 : 22,
                      }}
                    >
                      <div
                        className="absolute top-0 left-1/2 h-full w-px"
                        style={{ backgroundColor: color }}
                      />
                      <div
                        className="absolute top-1/2 left-0 h-px w-full"
                        style={{ backgroundColor: color }}
                      />
                      <div
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
                        style={{
                          width: isActive ? 8 : 6,
                          height: isActive ? 8 : 6,
                          borderColor: color,
                        }}
                      />
                    </div>
                    {/* GCP number badge */}
                    <div
                      className="absolute -translate-x-1/2 rounded px-0.5 text-[9px] leading-none font-bold"
                      style={{
                        top: isActive ? 16 : 13,
                        backgroundColor: color,
                        color: "#fff",
                      }}
                    >
                      {m.gcpIdx + 1}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Zoom controls — always visible top-right */}
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
              <button
                className="flex h-7 w-7 items-center justify-center rounded bg-black/60 text-white hover:bg-black/80 disabled:opacity-40"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => applyZoom(1 / 1.5)}
                disabled={zoom <= 1}
                title="Zoom out"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[3.5rem] rounded bg-black/60 px-1.5 py-0.5 text-center text-xs text-white tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
              <button
                className="flex h-7 w-7 items-center justify-center rounded bg-black/60 text-white hover:bg-black/80 disabled:opacity-40"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => applyZoom(1.5)}
                disabled={zoom >= 10}
                title="Zoom in"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
              {zoom > 1 && (
                <button
                  className="rounded bg-black/60 px-1.5 py-0.5 text-xs text-white hover:bg-black/80"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={resetView}
                >
                  Reset
                </button>
              )}
            </div>

            {/* Hint */}
            <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-white/30 select-none">
              Drag to pan · Double-click to reset
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-white/40">Select a GCP above</p>
          </div>
        )}
      </div>

      {/* ── Image slider ── */}
      {allImages.length > 0 && (
        <div className="px-1">
          {/* Nearest GCP label — shown when the image has GPS data */}
          {nearestGcp ? (
            <p className="text-muted-foreground mb-1 text-xs">
              Closest to GCP{" "}
              <strong className="text-foreground">{nearestGcp.label}</strong>
              {" "}—{" "}
              <span>{nearestGcp.dist_m.toFixed(1)} m away</span>
            </p>
          ) : selectedImageData && !selectedImageData.lat ? (
            <p className="text-muted-foreground mb-1 text-xs italic">No GPS on this image</p>
          ) : null}
          {/* Extra bottom padding to make room for GCP number labels */}
          <div className="relative" style={{ paddingBottom: "1.25rem" }}>
            <input
              type="range"
              min={0}
              max={sliderMax}
              value={selectedIdx >= 0 ? selectedIdx : 0}
              onChange={(e) =>
                setSelectedImage(allImages[Number(e.target.value)].name)
              }
              className="accent-primary h-2 w-full cursor-pointer"
            />
            {/* Colored diamond markers for every mark from every GCP */}
            {sliderMax > 0 &&
              allMarks.map((m) => {
                const imgIdx = allImages.findIndex(
                  (img) => img.name === m.image
                );
                if (imgIdx < 0) return null;
                const pct = (imgIdx / sliderMax) * 100;
                const color = gcpColor(m.gcpIdx);
                const isActive = m.label === activeLabel;
                return (
                  <div
                    key={`${m.label}-${m.image}`}
                    className="pointer-events-none absolute"
                    style={{ left: sliderLeft(pct), top: "50%" }}
                  >
                    {/* Diamond */}
                    <div
                      className="absolute -translate-x-1/2 -translate-y-1/2 rotate-45"
                      style={{
                        width: isActive ? 14 : 11,
                        height: isActive ? 14 : 11,
                        backgroundColor: color,
                        border: "1px solid rgba(255,255,255,0.5)",
                        marginTop: isActive ? 0 : 1,
                      }}
                      title={`${m.label}: ${m.image}`}
                    />
                    {/* GCP number below the diamond */}
                    <div
                      className="absolute -translate-x-1/2 text-[9px] leading-none font-bold"
                      style={{ top: 12, color }}
                    >
                      {m.gcpIdx + 1}
                    </div>
                  </div>
                );
              })}
          </div>
          <div className="text-muted-foreground mt-0.5 truncate text-xs">
            {selectedImage}
          </div>
        </div>
      )}

      {/* ── Clear all GCPs ── */}
      {Object.keys(markings).length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          {confirmClear ? (
            <>
              <span className="text-muted-foreground text-sm">
                Clear all GCP markings?
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setMarkings({})
                  setConfirmClear(false)
                }}
              >
                Yes, clear all
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmClear(false)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmClear(true)}
            >
              Clear all GCPs
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
