/**
 * PlotBoundaryPrep — shared interactive step for both ground and aerial pipelines.
 *
 * Flow
 * ----
 * 1. Check for field design CSV → if missing, show inline upload dialog.
 * 2. Show map with mosaic (ground: combined mosaic, aerial: orthomosaic) as background.
 *    User draws ONE outer population boundary polygon.
 * 3. Grid settings panel (width, length, rows, cols, spacing, angle).
 *    Grid is recomputed in real-time on the frontend.
 * 4. Preview the generated plot rectangles on the map → Save.
 */

import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import L from "leaflet";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Loader2,
  MousePointer,
  Move,
  Redo2,
  Undo2,
  Upload,
} from "lucide-react";

import { ProcessingService } from "@/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import useCustomToast from "@/hooks/useCustomToast";

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? "";
  return base ? `${base}${path}` : path;
}

// Fix Leaflet default icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrthoInfo {
  available: boolean;
  path: string | null;
  bounds: [[number, number], [number, number]] | null;
  existing_geojson: GeoJSON.FeatureCollection | null;
  existing_pop_boundary: GeoJSON.Feature | GeoJSON.FeatureCollection | null;
  existing_grid_settings: {
    options: GridOptions;
    offset: { lon: number; lat: number };
  } | null;
  active_ortho_version?: number | null;
  plot_boundary_ortho_version?: number | null;
  ortho_versions?: { version: number; name: string | null }[];
  plot_boundary_versions?: { version: number; name: string | null; created_at: string | null }[];
  active_plot_boundary_version?: number | null;
  stitch_versions?: { version: number; name: string | null }[];
  active_stitch_version?: number | null;
}

interface FieldDesignInfo {
  available: boolean;
  rows: Record<string, string>[];
  row_count: number;
  col_count: number;
}

interface GridOptions {
  width: number;
  length: number;
  rows: number;
  columns: number;
  verticalSpacing: number;
  horizontalSpacing: number;
  angle: number;
}

interface PlotBoundaryPrepProps {
  runId: string;
  pipelineType?: "aerial" | "ground";
  onSaved: () => void;
  onCancel: () => void;
}

type InteractionMode = "view" | "select" | "move";

// ── Field design upload dialog ────────────────────────────────────────────────

/** Pipeline-expected column names and their metadata. */
const TARGET_COLS = [
  {
    key: "row",
    label: "Row",
    required: true,
    hint: "Grid row number (1, 2, 3…)",
  },
  {
    key: "col",
    label: "Column",
    required: true,
    hint: "Grid column number (1, 2, 3…)",
  },
  {
    key: "plot",
    label: "Plot ID",
    required: false,
    hint: "Plot label or identifier",
  },
  {
    key: "accession",
    label: "Accession",
    required: false,
    hint: "Entry / variety name",
  },
] as const;

type TargetKey = (typeof TARGET_COLS)[number]["key"];

/** Very small CSV parser — handles quoted fields, trims whitespace from headers. */
function parseCSV(text: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };

  function parseLine(line: string): string[] {
    const fields: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        fields.push(cur);
        cur = "";
      } else cur += ch;
    }
    fields.push(cur);
    return fields;
  }

  const headers = parseLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const vals = parseLine(line);
    return Object.fromEntries(
      headers.map((h, i) => [h, (vals[i] ?? "").trim()])
    );
  });
  return { headers, rows };
}

/** Remap rows using mapping {targetCol → sourceCol}, pass other cols through unchanged. */
function remapAndSerialize(
  rows: Record<string, string>[],
  mapping: Partial<Record<TargetKey, string>>
): string {
  if (rows.length === 0) return "";

  const usedSources = new Set(
    Object.values(mapping).filter(Boolean) as string[]
  );
  const firstRow = rows[0];
  const passthroughCols = Object.keys(firstRow).filter(
    (c) => !usedSources.has(c)
  );
  const newHeaders: string[] = [
    ...Object.entries(mapping)
      .filter(([, src]) => src)
      .map(([tgt]) => tgt),
    ...passthroughCols,
  ];

  const lines = [newHeaders.join(",")];
  for (const row of rows) {
    const vals = newHeaders.map((h) => {
      const sourceKey = (mapping as Record<string, string>)[h] ?? h;
      const val = row[sourceKey] ?? "";
      return val.includes(",") || val.includes('"')
        ? `"${val.replace(/"/g, '""')}"`
        : val;
    });
    lines.push(vals.join(","));
  }
  return lines.join("\n");
}

/** Auto-detect best source column for a target key (case-insensitive fuzzy match). */
function autoDetect(headers: string[], key: TargetKey): string {
  const aliases: Record<TargetKey, string[]> = {
    row: ["row", "row_num", "row_number", "range"],
    col: ["col", "column", "col_num", "column_number", "bed"],
    plot: ["plot", "plot_id", "plotid", "plot_no", "plot_number"],
    accession: [
      "accession",
      "acc",
      "entry",
      "variety",
      "genotype",
      "label",
      "treatment",
    ],
  };
  const lower = headers.map((h) => h.toLowerCase());
  for (const alias of aliases[key]) {
    const idx = lower.findIndex((h) => h === alias || h.startsWith(alias));
    if (idx !== -1) return headers[idx];
  }
  return "";
}

function FieldDesignUploadDialog({
  open,
  onClose,
  onSaved,
  runId,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (info: { row_count: number; col_count: number }) => void;
  runId: string;
}) {
  const [step, setStep] = useState<"upload" | "map">("upload");
  const [headers, setHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<TargetKey, string>>>(
    {}
  );
  const { showErrorToast } = useCustomToast();

  function handleClose() {
    setStep("upload");
    setHeaders([]);
    setParsedRows([]);
    setMapping({});
    onClose();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { headers: h, rows } = parseCSV(text);
      setHeaders(h);
      setParsedRows(rows);
      const auto: Partial<Record<TargetKey, string>> = {};
      for (const t of TARGET_COLS) auto[t.key] = autoDetect(h, t.key);
      setMapping(auto);
      setStep("map");
    };
    reader.readAsText(file);
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      const csvText = remapAndSerialize(parsedRows, mapping);
      return fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/field-design`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
        body: JSON.stringify({ csv_text: csvText }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      });
    },
    onSuccess: (data) => {
      onSaved({ row_count: data.row_count, col_count: data.col_count });
      handleClose();
    },
    onError: () => showErrorToast("Failed to save field design"),
  });

  const requiredMapped = TARGET_COLS.filter((t) => t.required).every(
    (t) => mapping[t.key]
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {step === "upload" ? "Upload Field Design" : "Map Columns"}
          </DialogTitle>
          <DialogDescription>
            {step === "upload"
              ? "Select a CSV file. You'll map your columns to the required pipeline fields in the next step."
              : `Match your file's columns to the pipeline fields. ${parsedRows.length} rows detected.`}
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-3">
            <Label>Select CSV file</Label>
            <Input
              type="file"
              accept=".csv"
              className="mt-1"
              onChange={handleFileChange}
            />
          </div>
        )}

        {step === "map" && (
          <div className="space-y-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left">
                  <th className="w-1/3 pb-2 font-medium">Pipeline field</th>
                  <th className="pb-2 font-medium">Your column</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {TARGET_COLS.map((t) => (
                  <tr key={t.key}>
                    <td className="py-2 pr-4">
                      <div className="flex items-center gap-1.5">
                        <code className="bg-muted rounded px-1 py-0.5 text-xs">
                          {t.key}
                        </code>
                        {t.required && (
                          <span className="text-xs text-red-500">*</span>
                        )}
                      </div>
                      <div className="text-muted-foreground mt-0.5 text-xs">
                        {t.hint}
                      </div>
                    </td>
                    <td className="py-2">
                      <select
                        className="bg-background w-full rounded border px-2 py-1 text-sm"
                        value={mapping[t.key] ?? ""}
                        onChange={(e) =>
                          setMapping((m) => ({ ...m, [t.key]: e.target.value }))
                        }
                      >
                        {!t.required && <option value="">— skip —</option>}
                        {t.required && (
                          <option value="">— select column —</option>
                        )}
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!requiredMapped && (
              <p className="text-xs text-red-500">
                Row and Column fields are required.
              </p>
            )}

            <div>
              <p className="text-muted-foreground mb-1 text-xs">
                Preview (first 4 rows after mapping):
              </p>
              <div className="bg-muted/40 overflow-x-auto rounded border">
                <table className="w-full font-mono text-xs">
                  <thead>
                    <tr className="bg-muted border-b">
                      {TARGET_COLS.filter((t) => mapping[t.key]).map((t) => (
                        <th
                          key={t.key}
                          className="px-2 py-1 text-left font-medium"
                        >
                          {t.key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 4).map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        {TARGET_COLS.filter((t) => mapping[t.key]).map((t) => (
                          <td key={t.key} className="px-2 py-1">
                            {row[mapping[t.key]!] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === "map" && (
            <Button variant="outline" onClick={() => setStep("upload")}>
              Back
            </Button>
          )}
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          {step === "map" && (
            <Button
              disabled={!requiredMapped || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving…" : "Save Field Design"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Client-side grid computation (ported from plot_boundary.py) ───────────────

function degScale(latDeg: number): number {
  return 1.0 / (111_320 * Math.cos((latDeg * Math.PI) / 180));
}

function rotatePoint(
  px: number,
  py: number,
  cx: number,
  cy: number,
  angleDeg: number
): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad),
    sin = Math.sin(rad);
  const dx = px - cx,
    dy = py - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

function rotateRing(
  coords: number[][],
  cx: number,
  cy: number,
  angleDeg: number
): number[][] {
  return coords.map(([lon, lat]) => {
    const [rlon, rlat] = rotatePoint(lon, lat, cx, cy, angleDeg);
    return [rlon, rlat];
  });
}

function polygonCentroid(geom: GeoJSON.Polygon): [number, number] {
  const ring = geom.coordinates[0].slice(0, -1);
  return [
    ring.reduce((s, p) => s + p[0], 0) / ring.length,
    ring.reduce((s, p) => s + p[1], 0) / ring.length,
  ];
}

function computeGrid(
  boundary: GeoJSON.Feature,
  options: GridOptions,
  offset: { lon: number; lat: number },
  fdRows?: Record<string, string>[]
): GeoJSON.FeatureCollection {
  const geom = boundary.geometry as GeoJSON.Polygon;
  const [cx, cy] = polygonCentroid(geom);
  const scale = degScale(cy);

  const widthDeg = options.width * scale;
  const lengthDeg = options.length * scale;
  const vspaceDeg = options.verticalSpacing * scale;
  const hspaceDeg = options.horizontalSpacing * scale;
  const rows = Math.max(1, Math.round(options.rows));
  const cols = Math.max(1, Math.round(options.columns));
  const angle = options.angle;

  const ring0 = geom.coordinates[0];
  const minLon = Math.min(...ring0.map((p) => p[0])) + offset.lon;
  const maxLat = Math.max(...ring0.map((p) => p[1])) + offset.lat;

  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const x = minLon + j * (widthDeg + hspaceDeg);
      const y = maxLat - i * (lengthDeg + vspaceDeg) - lengthDeg;

      let ring: number[][] = [
        [x, y],
        [x + widthDeg, y],
        [x + widthDeg, y + lengthDeg],
        [x, y + lengthDeg],
        [x, y],
      ];
      if (angle !== 0)
        ring = rotateRing(ring, cx + offset.lon, cy + offset.lat, angle);

      const rowStr = String(i + 1),
        colStr = String(j + 1);
      const fd = fdRows?.find((r) => r.row === rowStr && r.col === colStr);
      const props: Record<string, any> = { row: i + 1, column: j + 1, ...fd };
      if (!props.plot) props.plot = `${i + 1}_${j + 1}`;

      features.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: props,
      });
    }
  }
  return { type: "FeatureCollection", features };
}

/** Derive GridOptions from a saved FeatureCollection when no grid_settings were stored. */
function deriveGridOptionsFromGeojson(
  fc: GeoJSON.FeatureCollection
): Partial<GridOptions> {
  const features = fc.features;
  if (features.length === 0) return {};

  const f11 = features.find(
    (f) => f.properties?.row === 1 && f.properties?.column === 1
  ) as GeoJSON.Feature<GeoJSON.Polygon> | undefined;
  if (!f11) return {};

  const ring = f11.geometry.coordinates[0];

  // Edge lengths in degrees — correct even for rotated rectangles
  const widthDeg = Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]);
  const lengthDeg = Math.hypot(
    ring[2][0] - ring[1][0],
    ring[2][1] - ring[1][1]
  );

  // Average centroid latitude for metre conversion
  const allPts = features.flatMap((f) =>
    (f.geometry as GeoJSON.Polygon).coordinates[0].slice(0, -1)
  );
  const avgLat = allPts.reduce((s, p) => s + p[1], 0) / allPts.length;
  const scale = degScale(avgLat);

  const width = Math.round((widthDeg / scale) * 10) / 10;
  const length = Math.round((lengthDeg / scale) * 10) / 10;

  // Centre of f11
  const cx11 = ring.slice(0, -1).reduce((s, p) => s + p[0], 0) / 4;
  const cy11 = ring.slice(0, -1).reduce((s, p) => s + p[1], 0) / 4;

  let horizontalSpacing = 0;
  const f12 = features.find(
    (f) => f.properties?.row === 1 && f.properties?.column === 2
  ) as GeoJSON.Feature<GeoJSON.Polygon> | undefined;
  if (f12) {
    const r12 = f12.geometry.coordinates[0];
    const cx12 = r12.slice(0, -1).reduce((s, p) => s + p[0], 0) / 4;
    const cy12 = r12.slice(0, -1).reduce((s, p) => s + p[1], 0) / 4;
    horizontalSpacing = Math.max(
      0,
      Math.round(
        ((Math.hypot(cx12 - cx11, cy12 - cy11) - widthDeg) / scale) * 10
      ) / 10
    );
  }

  let verticalSpacing = 0;
  const f21 = features.find(
    (f) => f.properties?.row === 2 && f.properties?.column === 1
  ) as GeoJSON.Feature<GeoJSON.Polygon> | undefined;
  if (f21) {
    const r21 = f21.geometry.coordinates[0];
    const cx21 = r21.slice(0, -1).reduce((s, p) => s + p[0], 0) / 4;
    const cy21 = r21.slice(0, -1).reduce((s, p) => s + p[1], 0) / 4;
    verticalSpacing = Math.max(
      0,
      Math.round(
        ((Math.hypot(cx21 - cx11, cy21 - cy11) - lengthDeg) / scale) * 10
      ) / 10
    );
  }

  // Angle: direction of the bottom edge from horizontal
  const angleRad = Math.atan2(ring[1][1] - ring[0][1], ring[1][0] - ring[0][0]);
  const angle =
    Math.round((((angleRad * 180) / Math.PI + 360) % 360) * 10) / 10;

  return { width, length, horizontalSpacing, verticalSpacing, angle };
}

// ── Grid settings panel ───────────────────────────────────────────────────────

interface FdTransform {
  flipRows: boolean;
  flipCols: boolean;
  swapAxes: boolean;
}

/** Re-apply field-design labels onto an existing FeatureCollection without touching geometries. */
function mergeLabelsIntoExisting(
  existing: GeoJSON.FeatureCollection,
  fdRows: Record<string, string>[],
  transform: FdTransform,
): GeoJSON.FeatureCollection {
  // Ground pipeline features only have `plot_id` (sequential: "1","2",...), not row/column.
  // Assign row/column from the fd before applying the transform.
  const hasRowCol = existing.features.some(
    (f) => f.properties?.row != null && f.properties?.column != null,
  );

  let source = existing;
  if (!hasRowCol && fdRows.length > 0) {
    const assigned = existing.features.map((feature, idx) => {
      const plotId = String(feature.properties?.plot_id ?? idx + 1);
      // Try matching by plot_id column in fd, then fall back to sequential order.
      const fd =
        fdRows.find((r) => r.plot_id === plotId) ??
        fdRows.find((r) => r.plot === plotId) ??
        fdRows[idx];
      if (!fd) return feature;
      const r = parseInt(fd.row) || idx + 1;
      const c = parseInt(fd.col) || 1;
      return { ...feature, properties: { ...feature.properties, row: r, column: c } };
    });
    source = { ...existing, features: assigned };
  }

  const maxRow = Math.max(...source.features.map((f) => (f.properties?.row as number) ?? 1));
  const maxCol = Math.max(...source.features.map((f) => (f.properties?.column as number) ?? 1));
  const newFeatures = source.features.map((feature) => {
    let r = (feature.properties?.row as number) ?? 1;
    let c = (feature.properties?.column as number) ?? 1;
    if (transform.flipRows) r = maxRow - r + 1;
    if (transform.flipCols) c = maxCol - c + 1;
    if (transform.swapAxes) [r, c] = [c, r];
    const fd = fdRows.find((row) => row.row === String(r) && row.col === String(c));
    const props: Record<string, any> = { ...feature.properties, ...(fd ?? {}) };
    if (!props.plot) props.plot = `${r}_${c}`;
    return { ...feature, properties: props };
  });
  return { ...existing, features: newFeatures };
}

function GridSettingsPanel({
  options,
  onChange,
  interactionMode,
  onModeChange,
  onSelectAll,
  onClearSelection,
  onDeleteSelected,
  featureCount,
  selectedCount,
  hideGridInputs = false,
  onGenerateGrid,
  gridGenerated,
  gridVisible,
  onToggleGrid,
  pipelineType: _pipelineType,
  fdAvailable: _fdAvailable,
  fdTransform: _fdTransform,
  onFdTransformChange: _onFdTransformChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  options: GridOptions;
  onChange: (opts: GridOptions) => void;
  interactionMode: InteractionMode;
  onModeChange: (mode: InteractionMode) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  featureCount: number;
  selectedCount: number;
  hideGridInputs?: boolean;
  onGenerateGrid?: () => void;
  gridGenerated?: boolean;
  gridVisible?: boolean;
  onToggleGrid?: () => void;
  pipelineType?: "aerial" | "ground";
  fdAvailable?: boolean;
  fdTransform?: FdTransform;
  onFdTransformChange?: (t: FdTransform) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}) {
  const [minimized, setMinimized] = useState(false);

  function field(label: string, key: keyof GridOptions, step = 0.1) {
    return (
      <div>
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Input
          type="number"
          step={step}
          value={options[key]}
          onChange={(e) =>
            onChange({ ...options, [key]: parseFloat(e.target.value) || 0 })
          }
          className="mt-0.5 h-7 text-xs"
        />
      </div>
    );
  }

  return (
    <div className="bg-background/95 absolute bottom-4 right-4 z-[1000] w-60 rounded-lg border shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <p className="text-xs font-semibold">Plot Settings</p>
        <div className="flex items-center gap-0.5">
          {onUndo && (
            <button
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </button>
          )}
          {onRedo && (
            <button
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo (Ctrl+Y)"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </button>
          )}
          {onToggleGrid && gridGenerated && (
            <button
              onClick={onToggleGrid}
              title={gridVisible ? "Hide grid" : "Show grid"}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              {gridVisible ? (
                <Eye className="h-3.5 w-3.5" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          <button
            onClick={() => setMinimized((m) => !m)}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            {minimized ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="space-y-2 p-3">
          {!hideGridInputs && (
            <div className="grid grid-cols-2 gap-1.5">
              {field("Width (m)", "width")}
              {field("Length (m)", "length")}
              {field("Rows", "rows", 1)}
              {field("Columns", "columns", 1)}
              {field("V. Spacing", "verticalSpacing")}
              {field("H. Spacing", "horizontalSpacing")}
            </div>
          )}
          <div>
            <Label className="text-xs text-muted-foreground">Angle (°)</Label>
            <div className="mt-0.5 flex items-center gap-1.5">
              <input
                type="range"
                min={-180}
                max={180}
                step={0.5}
                value={options.angle}
                onChange={(e) =>
                  onChange({ ...options, angle: parseFloat(e.target.value) })
                }
                className="flex-1"
              />
              <Input
                type="number"
                min={-180}
                max={180}
                step={0.5}
                value={options.angle}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v)) onChange({ ...options, angle: Math.max(-180, Math.min(180, v)) });
                }}
                className="h-7 w-14 text-xs"
              />
            </div>
          </div>

          {/* TODO: Label orientation — WILL NEED TO REFINE LATER */}
          {/* {pipelineType === "ground" && fdAvailable && fdTransform && onFdTransformChange && (
            <div>
              <Label className="text-xs text-muted-foreground">Label Orientation</Label>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                {(
                  [
                    { key: "flipRows", label: "Flip Rows" },
                    { key: "flipCols", label: "Flip Cols" },
                    { key: "swapAxes", label: "Swap" },
                  ] as { key: keyof FdTransform; label: string }[]
                ).map(({ key, label }) => (
                  <label key={key} className="flex cursor-pointer items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={fdTransform[key]}
                      onChange={(e) =>
                        onFdTransformChange({ ...fdTransform, [key]: e.target.checked })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )} */}

          {/* Mode buttons */}
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              size="sm"
              variant={interactionMode === "select" ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => onModeChange("select")}
            >
              <MousePointer className="mr-1 h-3 w-3" />
              Select
            </Button>
            <Button
              size="sm"
              variant={interactionMode === "move" ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => onModeChange("move")}
            >
              <Move className="mr-1 h-3 w-3" />
              Move
            </Button>
          </div>

          {/* Select all / clear / delete — shown in select mode when plots exist */}
          {interactionMode === "select" && featureCount > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onSelectAll}>
                  All
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={onClearSelection}
                  disabled={selectedCount === 0}
                >
                  Clear
                </Button>
              </div>
              {selectedCount > 0 && (
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 w-full text-xs"
                  onClick={onDeleteSelected}
                >
                  Delete {selectedCount} plot{selectedCount !== 1 ? "s" : ""}
                </Button>
              )}
            </div>
          )}

          {onGenerateGrid && (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                className="h-7 flex-1 text-xs"
                variant={gridGenerated ? "outline" : "default"}
                onClick={onGenerateGrid}
              >
                {gridGenerated ? "Regenerate Grid" : "Generate Grid"}
              </Button>
              {featureCount > 0 && (
                <span className="text-muted-foreground text-xs whitespace-nowrap">
                  {featureCount} plots
                </span>
              )}
            </div>
          )}
          {!onGenerateGrid && featureCount > 0 && (
            <p className="text-muted-foreground text-center text-xs">
              {featureCount} plots
              {selectedCount > 0 && ` · ${selectedCount} selected`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PlotBoundaryPrep({ runId, pipelineType = "aerial", onCancel, onSaved }: PlotBoundaryPrepProps) {
  const { showErrorToast, showSuccessToast } = useCustomToast();
  const queryClient = useQueryClient();

  // Map refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const popLayerRef = useRef<L.FeatureGroup | null>(null);
  const plotLayerRef = useRef<L.FeatureGroup | null>(null);
  const imageOverlayRef = useRef<L.ImageOverlay | null>(null);
  // Index-based layer array — parallel to previewGeoJson.features
  const plotLayersRef = useRef<L.Path[]>([]);
  const dragRef = useRef<{ startLng: number; startLat: number } | null>(null);

  // Stable refs (avoid stale closures in Leaflet event handlers)
  const interactionModeRef = useRef<InteractionMode>("select");
  const handlePlotClickRef = useRef<(idx: number, shiftKey: boolean) => void>(
    () => {}
  );
  const selectedIndexesRef = useRef<number[]>([]);

  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [gridOptions, setGridOptions] = useState<GridOptions>({
    width: 1.5,
    length: 10,
    rows: 1,
    columns: 1,
    verticalSpacing: 0.5,
    horizontalSpacing: 0.5,
    angle: 0,
  });
  const [popBoundary, setPopBoundary] = useState<GeoJSON.Feature | null>(null);
  const [gridOffset, setGridOffset] = useState({ lon: 0, lat: 0 });
  const [previewGeoJson, setPreviewGeoJson] =
    useState<GeoJSON.FeatureCollection | null>(null);
  // Index-based selection — array of feature indexes into previewGeoJson.features
  const [selectedIndexes, setSelectedIndexes] = useState<number[]>([]);
  const [interactionMode, setInteractionMode] =
    useState<InteractionMode>("view");
  const [gridGenerated, setGridGenerated] = useState(false);
  const [gridVisible, setGridVisible] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingSaveAs, setPendingSaveAs] = useState(false);
  const [showSaveAsDialog, setShowSaveAsDialog] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [hasBoundary, setHasBoundary] = useState(false);
  const [selectedOrthoVersion, setSelectedOrthoVersion] = useState<
    number | null
  >(null);
  const [selectedBoundaryVersion, setSelectedBoundaryVersion] = useState<number | null>(null);
  const [selectedStitchVersion, setSelectedStitchVersion] = useState<number | null>(null);
  const [mapInitialized, setMapInitialized] = useState(false);
  const [noFdWarningOpen, setNoFdWarningOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [fdTransform, setFdTransform] = useState<FdTransform>({ flipRows: false, flipCols: false, swapAxes: false });

  // ── Undo / redo history ──────────────────────────────────────────────────
  const historyRef = useRef<GeoJSON.FeatureCollection[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  function pushHistory(fc: GeoJSON.FeatureCollection) {
    // Discard any redo states beyond current position
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    historyRef.current.push(fc);
    historyIndexRef.current = historyRef.current.length - 1;
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(false);
  }

  function undo() {
    if (historyIndexRef.current <= 0) return;
    historyIndexRef.current -= 1;
    const fc = historyRef.current[historyIndexRef.current];
    setPreviewGeoJson(fc);
    setSelectedIndexes([]);
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(true);
  }

  function redo() {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const fc = historyRef.current[historyIndexRef.current];
    setPreviewGeoJson(fc);
    setSelectedIndexes([]);
    setCanUndo(true);
    setCanRedo(historyIndexRef.current < historyRef.current.length - 1);
  }

  // Fetch mosaic/orthomosaic info (serves as background + provides existing boundaries)
  const { data: orthoInfo, isLoading: orthoLoading } = useQuery<OrthoInfo>({
    queryKey: ["orthomosaic-info", runId],
    queryFn: () =>
      ProcessingService.orthomosaicInfo({
        id: runId,
      }) as unknown as Promise<OrthoInfo>,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // Check for field design
  const { data: fdInfo, refetch: refetchFd } = useQuery<FieldDesignInfo>({
    queryKey: ["field-design", runId],
    queryFn: () =>
      fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/field-design`), {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
      }).then((r) => r.json()),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // Ground only: estimate boundary + grid from georeferenced TIF extents (first visit)
  const { data: autoBoundaryData } = useQuery<{
    available: boolean;
    pop_boundary?: GeoJSON.Feature;
    grid_options?: GridOptions;
  }>({
    queryKey: ["auto-boundary", runId],
    queryFn: () =>
      fetch(apiUrl(`/api/v1/pipeline-runs/${runId}/auto-boundary`), {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
        },
      }).then((r) => r.json()),
    enabled: !!orthoInfo?.available,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  // When field design loads, populate rows/cols — but only if there is no existing saved grid.
  // If a grid was already saved, its settings (or at minimum its feature count) take priority.
  useEffect(() => {
    if (
      fdInfo?.available &&
      fdInfo.row_count > 0 &&
      !orthoInfo?.existing_geojson
    ) {
      setGridOptions((prev) => ({
        ...prev,
        rows: fdInfo.row_count,
        columns: fdInfo.col_count,
      }));
    }
  }, [fdInfo, orthoInfo?.existing_geojson]);

  // Initialize selectedOrthoVersion from saved state or active version
  useEffect(() => {
    if (!orthoInfo) return;
    const v =
      orthoInfo.plot_boundary_ortho_version ?? orthoInfo.active_ortho_version;
    if (v != null) setSelectedOrthoVersion(v);
  }, [orthoInfo?.plot_boundary_ortho_version, orthoInfo?.active_ortho_version]);

  // Initialize selectedBoundaryVersion from active version
  useEffect(() => {
    if (!orthoInfo) return;
    if (orthoInfo.active_plot_boundary_version != null) {
      setSelectedBoundaryVersion(orthoInfo.active_plot_boundary_version);
    }
  }, [orthoInfo?.active_plot_boundary_version]);

  // Initialize selectedStitchVersion from active stitch version (ground only)
  useEffect(() => {
    if (!orthoInfo) return;
    if (orthoInfo.active_stitch_version != null) {
      setSelectedStitchVersion(orthoInfo.active_stitch_version);
    }
  }, [orthoInfo?.active_stitch_version]);

  // Update image overlay URL when stitch version changes (ground only)
  useEffect(() => {
    if (!imageOverlayRef.current || selectedStitchVersion == null) return;
    const url = apiUrl(
      `/api/v1/pipeline-runs/${runId}/mosaic-preview?stitch_version=${selectedStitchVersion}`
    );
    imageOverlayRef.current.setUrl(url);
  }, [selectedStitchVersion, runId]);

  // Update image overlay URL when user switches ortho version
  useEffect(() => {
    if (!imageOverlayRef.current || selectedOrthoVersion == null) return;
    const url = apiUrl(
      `/api/v1/pipeline-runs/${runId}/orthomosaics/${selectedOrthoVersion}/preview?max_size=4096`
    );
    imageOverlayRef.current.setUrl(url);
  }, [selectedOrthoVersion, runId]);

  // Apply auto-boundary estimate to the map once both map and data are ready.
  // Only used when there is no existing saved boundary — if one exists, its own
  // grid_settings are authoritative and should not be overwritten.
  useEffect(() => {
    if (!mapInitialized || !autoBoundaryData?.available) return;
    if (!autoBoundaryData.pop_boundary || !autoBoundaryData.grid_options) return;
    if (popBoundary) return; // boundary already drawn (from existing save or previous effect run)
    const popLayer = popLayerRef.current;
    const map = mapRef.current;
    if (!popLayer || !map) return;

    L.geoJSON(autoBoundaryData.pop_boundary as GeoJSON.GeoJsonObject, {
      style: { color: "#f59e0b", weight: 2, fillOpacity: 0.1 },
    }).eachLayer((l) => popLayer.addLayer(l));

    setPopBoundary(autoBoundaryData.pop_boundary);
    setHasBoundary(true);
    // Apply grid_options only on first-time setup (no existing geojson)
    if (!orthoInfo?.existing_geojson) {
      setGridOptions(autoBoundaryData.grid_options);
      // Auto-generate the grid immediately — no need to click "Generate Grid"
      const fc = computeGrid(
        autoBoundaryData.pop_boundary as GeoJSON.Feature,
        autoBoundaryData.grid_options,
        gridOffset,
        fdInfo?.rows,
      );
      setPreviewGeoJson(fc);
      pushHistory(fc);
      setGridGenerated(true);
      setGridVisible(true);
    }
  }, [mapInitialized, autoBoundaryData]);

  // Destroy map only on component unmount — separate from the init effect so that
  // orthoInfo refetches (triggered by save/invalidate) don't tear down the map mid-session.
  useEffect(() => {
    return () => {
      imageOverlayRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Initialise map once orthoInfo is available — runs whenever orthoInfo changes but
  // the `if (mapRef.current) return` guard ensures setup only happens once.
  useEffect(() => {
    if (!orthoInfo?.available || !orthoInfo.bounds || !mapContainerRef.current)
      return;
    if (mapRef.current) return;

    let cancelled = false;
    const rawBounds = orthoInfo.bounds;

    import("@geoman-io/leaflet-geoman-free").then(() => {
      if (cancelled || !mapContainerRef.current) return;

      const bounds = L.latLngBounds(rawBounds[0], rawBounds[1]);
      const map = L.map(mapContainerRef.current, {
        crs: L.CRS.EPSG3857,
        center: bounds.getCenter(),
        zoom: 17,
        minZoom: 10,
        maxZoom: 22,
        boxZoom: false,
      });
      mapRef.current = map;

      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          attribution:
            "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics",
          maxNativeZoom: 19,
          maxZoom: 22,
          opacity: 0.6,
        }
      ).addTo(map);

      const initVersion =
        orthoInfo.plot_boundary_ortho_version ?? orthoInfo.active_ortho_version;
      const imgSrc =
        pipelineType === "ground" && orthoInfo.active_stitch_version != null
          ? apiUrl(`/api/v1/pipeline-runs/${runId}/mosaic-preview?stitch_version=${orthoInfo.active_stitch_version}`)
          : initVersion != null
          ? apiUrl(
              `/api/v1/pipeline-runs/${runId}/orthomosaics/${initVersion}/preview?max_size=4096`
            )
          : apiUrl(`/api/v1/pipeline-runs/${runId}/mosaic-preview`);
      const overlay = L.imageOverlay(imgSrc, bounds, { opacity: 0.9 }).addTo(
        map
      );
      imageOverlayRef.current = overlay;
      map.fitBounds(bounds);

      // Layer for population boundary (user draws ONE polygon)
      const popLayer = new L.FeatureGroup();
      popLayerRef.current = popLayer;
      popLayer.addTo(map);

      // Layer for plot grid preview (read-only — Geoman must not touch it)
      const plotLayer = new L.FeatureGroup();
      (plotLayer as any).options.pmIgnore = true;
      plotLayerRef.current = plotLayer;
      plotLayer.addTo(map);

      // Load existing pop boundary if present
      if (orthoInfo.existing_pop_boundary) {
        L.geoJSON(orthoInfo.existing_pop_boundary as GeoJSON.GeoJsonObject, {
          style: { color: "#f59e0b", weight: 2, fillOpacity: 0.1 },
        }).eachLayer((l) => popLayer.addLayer(l));
        setHasBoundary(true);
      }

      // Load existing plot grid if present — mark as loaded so recompute is suppressed
      if (orthoInfo.existing_geojson) {
        setPreviewGeoJson(orthoInfo.existing_geojson);
        setGridGenerated(true);
        if (orthoInfo.existing_grid_settings) {
          setGridOptions(orthoInfo.existing_grid_settings.options);
          // Suppress the gridOffset→recompute effect so we keep the loaded geojson as-is
          skipGridRecomputeRef.current = true;
          setGridOffset(orthoInfo.existing_grid_settings.offset);
        } else {
          const features = orthoInfo.existing_geojson.features;
          if (features.length > 0) {
            const maxRow = Math.max(
              ...features.map((f: any) => f.properties?.row ?? 1)
            );
            const maxCol = Math.max(
              ...features.map((f: any) => f.properties?.column ?? 1)
            );
            const derived = deriveGridOptionsFromGeojson(
              orthoInfo.existing_geojson
            );
            setGridOptions((prev) => ({
              ...prev,
              rows: maxRow,
              columns: maxCol,
              ...derived,
            }));
          }
        }
      }

      // Geoman: allow drawing ONE polygon (population boundary)
      const mapAny = map as any;
      if (mapAny.pm) {
        mapAny.pm.addControls({
          position: "topleft",
          drawMarker: false,
          drawCircleMarker: false,
          drawPolyline: false,
          drawCircle: false,
          drawText: false,
          drawPolygon: true,
          drawRectangle: false,
          editMode: true,
          dragMode: true,
          cutPolygon: false,
          removalMode: true,
          rotateMode: false,
        });
        mapAny.pm.setGlobalOptions({
          layerGroup: popLayer,
          pathOptions: { color: "#f59e0b", weight: 2, fillOpacity: 0.1 },
        });

        const syncBoundary = () => {
          const layers = popLayerRef.current?.getLayers() ?? [];
          const hasAny = layers.length > 0;
          setHasBoundary(hasAny);
          if (hasAny)
            setPopBoundary((layers[0] as any).toGeoJSON() as GeoJSON.Feature);
          else setPopBoundary(null);
        };
        map.on("pm:create", syncBoundary);
        map.on("pm:edit", syncBoundary);
        map.on("pm:remove", syncBoundary);
      }

      // Seed popBoundary from existing boundary
      if (orthoInfo.existing_pop_boundary) {
        setPopBoundary(
          orthoInfo.existing_pop_boundary.type === "Feature"
            ? (orthoInfo.existing_pop_boundary as GeoJSON.Feature)
            : (orthoInfo.existing_pop_boundary as GeoJSON.FeatureCollection)
                .features[0]
        );
      }

      setMapInitialized(true);
    }); // end import().then()

    return () => {
      cancelled = true;
    };
  }, [orthoInfo]);

  // Stable refs used by the drag-recompute effect to avoid stale closures
  const popBoundaryRef = useRef(popBoundary);
  popBoundaryRef.current = popBoundary;
  const gridOptionsRef = useRef(gridOptions);
  gridOptionsRef.current = gridOptions;
  const fdRowsRef = useRef(fdInfo?.rows);
  fdRowsRef.current = fdInfo?.rows;
  const gridVisibleRef = useRef(gridVisible);
  gridVisibleRef.current = gridVisible;
  // When set, the next gridOffset effect run is a boundary-load (not a drag) — skip recompute
  const skipGridRecomputeRef = useRef(false);

  // Stable refs for keyboard shortcuts (avoid stale closures)
  const interactionModeRef2 = useRef(interactionMode);
  interactionModeRef2.current = interactionMode;
  const previewGeoJsonRef = useRef(previewGeoJson);
  previewGeoJsonRef.current = previewGeoJson;
  const selectedIndexesRef2 = useRef(selectedIndexes);
  selectedIndexesRef2.current = selectedIndexes;

  // Keyboard shortcuts: S=select, M=move, A=select-all, C=clear, D=delete, Ctrl+Z=undo, Ctrl+Y/Ctrl+Shift+Z=redo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      // Don't fire shortcuts when typing in an input/textarea
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if (e.key === "z" && e.shiftKey)  { e.preventDefault(); redo(); return; }
        if (e.key === "y")                { e.preventDefault(); redo(); return; }
        return;
      }

      switch (e.key.toLowerCase()) {
        case "s": setInteractionMode(interactionModeRef2.current === "select" ? "view" : "select"); break;
        case "m": setInteractionMode(interactionModeRef2.current === "move" ? "view" : "move"); break;
        case "a":
          if (previewGeoJsonRef.current) {
            setSelectedIndexes(Array.from({ length: previewGeoJsonRef.current.features.length }, (_, i) => i));
          }
          break;
        case "c": setSelectedIndexes([]); break;
        case "d":
          if (selectedIndexesRef2.current.length > 0) setShowDeleteConfirm(true);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live recompute ONLY when dragging the grid (gridOffset changes).
  // Boundary / option changes require the user to click "Generate Grid".
  useEffect(() => {
    // loadBoundaryVersion sets gridOffset as part of restoring saved state — don't recompute
    if (skipGridRecomputeRef.current) {
      skipGridRecomputeRef.current = false;
      return;
    }
    if (!popBoundaryRef.current || previewGeoJson === null) return;
    const fc = computeGrid(
      popBoundaryRef.current,
      gridOptionsRef.current,
      gridOffset,
      fdRowsRef.current
    );
    setPreviewGeoJson(fc);
    // Don't reset selectedIndexes during drag — too disruptive
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridOffset]);

  // Ground pipeline: when label orientation transform changes, re-merge labels onto existing features.
  useEffect(() => {
    if (pipelineType !== "ground" || !fdInfo?.rows || !previewGeoJsonRef.current) return;
    const fc = mergeLabelsIntoExisting(previewGeoJsonRef.current, fdInfo.rows, fdTransform);
    setPreviewGeoJson(fc);
    setSelectedIndexes([]);
    pushHistory(fc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fdTransform]);

  // Hide the population boundary (orange) only when the plot grid is actively visible.
  // When the grid is hidden (or no grid exists), restore the orange boundary.
  useEffect(() => {
    const popLayer = popLayerRef.current;
    if (!popLayer) return;
    const gridActivelyShown = gridVisible && (previewGeoJson?.features?.length ?? 0) > 0;
    popLayer.setStyle(
      gridActivelyShown
        ? { opacity: 0, fillOpacity: 0 }
        : { color: "#f59e0b", weight: 2, opacity: 1, fillOpacity: 0.1 }
    );
  }, [previewGeoJson, gridVisible, mapInitialized]);

  // Manual grid generation triggered by the "Generate Grid" button
  function handleGenerateGrid() {
    if (!popBoundary) return;
    if (!fdInfo?.available) {
      setNoFdWarningOpen(true);
      return;
    }
    _doGenerateGrid();
  }

  function _doGenerateGrid() {
    if (!popBoundary) return;
    const fc = computeGrid(popBoundary, gridOptions, gridOffset, fdInfo?.rows);
    setPreviewGeoJson(fc);
    setSelectedIndexes([]);
    setGridGenerated(true);
    setGridVisible(true);
    pushHistory(fc);
  }

  // Show/hide plot grid layer + switch Geoman edit target
  useEffect(() => {
    const map = mapRef.current;
    const mapAny = map as any;
    const plotLayer = plotLayerRef.current;
    const popLayer = popLayerRef.current;
    if (!map || !plotLayer || !popLayer) return;
    if (gridVisible) {
      if (!map.hasLayer(plotLayer)) map.addLayer(plotLayer);
      // Grid visible → Geoman edits plot cells
      plotLayersRef.current.forEach(l => { (l as any).options.pmIgnore = false; });
      if (mapAny.pm) mapAny.pm.setGlobalOptions({ layerGroup: plotLayer });
    } else {
      if (map.hasLayer(plotLayer)) map.removeLayer(plotLayer);
      // Grid hidden → Geoman edits population boundary
      plotLayersRef.current.forEach(l => { (l as any).options.pmIgnore = true; });
      if (mapAny.pm) mapAny.pm.setGlobalOptions({ layerGroup: popLayer });
    }
  }, [gridVisible]);

  // Keep interaction mode ref in sync
  useEffect(() => {
    interactionModeRef.current = interactionMode;
  }, [interactionMode]);

  // Keep selectedIndexes ref in sync for use in Leaflet event handlers
  useEffect(() => {
    selectedIndexesRef.current = selectedIndexes;
  }, [selectedIndexes]);

  // Keep click handler ref fresh — uses index, not string key
  handlePlotClickRef.current = (idx: number, shiftKey: boolean) => {
    if (interactionModeRef.current !== "select") return;
    setSelectedIndexes((prev) => {
      if (shiftKey) {
        // Toggle this index in the selection
        return prev.includes(idx)
          ? prev.filter((i) => i !== idx)
          : [...prev, idx];
      } else {
        // Single click: select only this one (or deselect if already the only one)
        return prev.length === 1 && prev[0] === idx ? [] : [idx];
      }
    });
  };

  // Create plot layers when the grid changes — binds tooltips + click handlers ONCE per grid
  useEffect(() => {
    const plotLayer = plotLayerRef.current;
    if (!plotLayer) return;
    plotLayer.clearLayers();
    plotLayersRef.current = [];
    if (!previewGeoJson) return;

    previewGeoJson.features.forEach((feature, idx) => {
      const p = feature.properties || {};
      const plotLabel = p.plot ?? p.plot_id ?? (p.row != null ? `${p.row}_${p.column}` : "?");
      const lines = [
        `<strong>Plot ${plotLabel}</strong>`,
        p.row != null ? `Row: ${p.row} &nbsp; Col: ${p.column}` : null,
        p.accession ? `Accession: ${p.accession}` : null,
      ]
        .filter(Boolean)
        .join("<br>");

      const leafletLayer = L.geoJSON(feature as GeoJSON.GeoJsonObject, {
        style: {
          color: "#2563eb",
          weight: 1.5,
          fillColor: "#2563eb",
          fillOpacity: 0.15,
        },
      }).getLayers()[0] as L.Path;

      // When grid is visible, allow Geoman to edit individual plot cells;
      // when hidden, exclude them so Geoman targets the population boundary.
      (leafletLayer as any).options.pmIgnore = !gridVisibleRef.current;

      leafletLayer.bindTooltip(lines, { sticky: true, opacity: 0.95 });
      // Capture idx at creation time — stable closure, no stale ref issues
      leafletLayer.on("click", (e: any) => {
        L.DomEvent.stopPropagation(e);
        handlePlotClickRef.current(idx, e.originalEvent?.shiftKey ?? false);
      });

      plotLayer.addLayer(leafletLayer);
      plotLayersRef.current.push(leafletLayer);
    });
  }, [previewGeoJson]);

  // Update only styles when selection changes — no layer recreation
  useEffect(() => {
    const selSet = new Set(selectedIndexes);
    plotLayersRef.current.forEach((layer, idx) => {
      const sel = selSet.has(idx);
      layer.setStyle({
        color: sel ? "#dc2626" : "#2563eb",
        weight: sel ? 2.5 : 1.5,
        fillColor: sel ? "#ef4444" : "#2563eb",
        fillOpacity: sel ? 0.4 : 0.15,
      });
    });
  }, [selectedIndexes]);

  // Move-mode: drag on map to translate entire grid
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (interactionMode !== "move") return;

    map.dragging.disable();
    map.getContainer().style.cursor = "move";

    function onMouseDown(e: L.LeafletMouseEvent) {
      dragRef.current = { startLng: e.latlng.lng, startLat: e.latlng.lat };
    }
    const pendingOffset = { lon: 0, lat: 0 };
    let rafId: number | null = null;
    function onMouseMove(e: L.LeafletMouseEvent) {
      if (!dragRef.current) return;
      pendingOffset.lon += e.latlng.lng - dragRef.current.startLng;
      pendingOffset.lat += e.latlng.lat - dragRef.current.startLat;
      dragRef.current = { startLng: e.latlng.lng, startLat: e.latlng.lat };
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          const { lon, lat } = pendingOffset;
          pendingOffset.lon = 0;
          pendingOffset.lat = 0;
          if (selectedIndexesRef.current.length > 0) {
            // Move only the selected features by directly translating their coordinates
            const selSet = new Set(selectedIndexesRef.current);
            setPreviewGeoJson((prev) => {
              if (!prev) return prev;
              const newFeatures = prev.features.map((feature, idx) => {
                if (!selSet.has(idx)) return feature;
                const geom = feature.geometry as GeoJSON.Polygon;
                const newCoords = geom.coordinates.map((ring) =>
                  ring.map(([fLon, fLat]) => [fLon + lon, fLat + lat])
                );
                return { ...feature, geometry: { ...geom, coordinates: newCoords } };
              });
              return { ...prev, features: newFeatures };
            });
          }
          // No selection → do nothing; select plots first before dragging in move mode
        });
      }
    }
    function onMouseUp() {
      if (dragRef.current && previewGeoJsonRef.current) {
        pushHistory(previewGeoJsonRef.current);
      }
      dragRef.current = null;
    }

    map.on("mousedown", onMouseDown);
    map.on("mousemove", onMouseMove);
    map.on("mouseup", onMouseUp);
    map.on("mouseout", onMouseUp);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      map.off("mousedown", onMouseDown);
      map.off("mousemove", onMouseMove);
      map.off("mouseup", onMouseUp);
      map.off("mouseout", onMouseUp);
      if (mapRef.current) {
        map.dragging.enable();
        map.getContainer().style.cursor = "";
      }
    };
  }, [interactionMode]);

  // Select-mode: rubber-band drag on map background to select plots within a rectangle.
  // A drag of > 5px starts the selection box; mouseup selects enclosed plots.
  // Shift+drag adds to existing selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || interactionMode !== "select") return;
    const m = map; // stable non-null reference for closures

    // Disable map panning so drag is always rubber-band selection
    m.dragging.disable();
    m.getContainer().style.cursor = "crosshair";

    let startLatLng: L.LatLng | null = null;
    let startContainerPt: L.Point | null = null;
    let selBox: L.Rectangle | null = null;
    let isDragging = false;
    const THRESHOLD = 5; // px before rubber-band kicks in

    function onMouseDown(e: L.LeafletMouseEvent) {
      startLatLng = e.latlng;
      startContainerPt = m.latLngToContainerPoint(e.latlng);
      isDragging = false;
    }

    function onMouseMove(e: L.LeafletMouseEvent) {
      if (!startLatLng || !startContainerPt) return;
      const curPt = m.latLngToContainerPoint(e.latlng);
      const dist = Math.hypot(
        curPt.x - startContainerPt.x,
        curPt.y - startContainerPt.y
      );

      if (!isDragging && dist > THRESHOLD) {
        isDragging = true;
        m.dragging.disable();
        selBox = L.rectangle(L.latLngBounds(startLatLng, e.latlng), {
          color: "#2563eb",
          weight: 1.5,
          fillColor: "#2563eb",
          fillOpacity: 0.08,
          dashArray: "5, 4",
          interactive: false,
        }).addTo(m);
      }

      if (isDragging && selBox && startLatLng) {
        selBox.setBounds(L.latLngBounds(startLatLng, e.latlng));
      }
    }

    function onMouseUp(e: L.LeafletMouseEvent) {
      if (isDragging && selBox && startLatLng) {
        const bounds = L.latLngBounds(startLatLng, e.latlng);
        const inside: number[] = [];
        plotLayersRef.current.forEach((layer, idx) => {
          const center = (layer as any).getBounds?.()?.getCenter?.();
          if (center && bounds.contains(center)) inside.push(idx);
        });
        const shiftKey = e.originalEvent?.shiftKey ?? false;
        setSelectedIndexes((prev) =>
          shiftKey ? [...new Set([...prev, ...inside])] : inside
        );
        m.removeLayer(selBox);
        selBox = null;
        m.dragging.enable();
      }
      startLatLng = null;
      startContainerPt = null;
      isDragging = false;
    }

    function onMouseOut() {
      if (isDragging && selBox) {
        m.removeLayer(selBox);
        selBox = null;
        m.dragging.enable();
      }
      startLatLng = null;
      startContainerPt = null;
      isDragging = false;
    }

    m.on("mousedown", onMouseDown);
    m.on("mousemove", onMouseMove);
    m.on("mouseup", onMouseUp);
    m.on("mouseout", onMouseOut);

    return () => {
      m.off("mousedown", onMouseDown);
      m.off("mousemove", onMouseMove);
      m.off("mouseup", onMouseUp);
      m.off("mouseout", onMouseOut);
      if (selBox) m.removeLayer(selBox);
      if (mapRef.current) {
        m.dragging.enable();
        m.getContainer().style.cursor = "";
      }
    };
  }, [interactionMode]);

  // Load a specific plot boundary version and make it the editing base
  async function loadBoundaryVersion(version: number) {
    try {
      const res = await fetch(
        apiUrl(`/api/v1/pipeline-runs/${runId}/plot-boundaries/${version}`),
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
          },
        }
      );
      if (!res.ok) throw new Error();
      const data = await res.json();
      const fc = data.geojson as GeoJSON.FeatureCollection;
      setPreviewGeoJson(fc);
      setGridGenerated(true);
      if (data.grid_settings) {
        setGridOptions(data.grid_settings.options);
        skipGridRecomputeRef.current = true;
        setGridOffset(data.grid_settings.offset ?? { lon: 0, lat: 0 });
      } else {
        const features = fc.features;
        if (features.length > 0) {
          const maxRow = Math.max(...features.map((f: any) => f.properties?.row ?? 1));
          const maxCol = Math.max(...features.map((f: any) => f.properties?.column ?? 1));
          const derived = deriveGridOptionsFromGeojson(fc);
          setGridOptions((prev) => ({ ...prev, rows: maxRow, columns: maxCol, ...derived }));
          setGridOffset({ lon: 0, lat: 0 });
        }
      }
      setSelectedBoundaryVersion(version);
    } catch {
      showErrorToast("Failed to load boundary version");
    }
  }

  function handleGridOptionsChange(opts: GridOptions) {
    setGridOptions(opts);
    // Live recompute — updates the grid immediately as the user adjusts any setting
    // (angle slider, width, rows, etc.) without requiring "Regenerate Grid".
    if (gridGenerated && popBoundary) {
      const fc = computeGrid(popBoundary, opts, gridOffset, fdInfo?.rows);
      setPreviewGeoJson(fc);
      setGridVisible(true);
    }
  }

  function handleModeChange(mode: InteractionMode) {
    // Clicking the active mode button deactivates it → back to view (normal panning)
    setInteractionMode((prev) => (prev === mode ? "view" : mode));
  }

  async function handleSave(saveAs = false, name?: string) {
    if (!previewGeoJson) return;
    if (!popBoundary) {
      showErrorToast("Draw a field boundary before saving");
      return;
    }
    setIsSaving(true);
    if (saveAs) setPendingSaveAs(true);

    // Sync any Geoman vertex-edits from live Leaflet layers into the GeoJSON before saving.
    // Geoman edits the layer geometry in place without updating React state, so we read
    // the current layer coordinates directly rather than relying on previewGeoJson.
    let geojsonToSave = previewGeoJson;
    const liveLayers = plotLayersRef.current;
    if (liveLayers.length > 0 && liveLayers.length === previewGeoJson.features.length) {
      const newFeatures = previewGeoJson.features.map((feature, idx) => {
        const layer = liveLayers[idx];
        if (!layer) return feature;
        try {
          const updated = (layer as any).toGeoJSON() as GeoJSON.Feature;
          return { ...updated, properties: feature.properties };
        } catch {
          return feature;
        }
      });
      geojsonToSave = { ...previewGeoJson, features: newFeatures };
    }

    try {
      const res = await fetch(
        apiUrl(`/api/v1/pipeline-runs/${runId}/save-plot-grid`),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
          },
          body: JSON.stringify({
            geojson: geojsonToSave,
            pop_boundary: popBoundary,
            grid_options: gridOptions,
            grid_offset: gridOffset,
            ortho_version: selectedOrthoVersion,
            stitch_version: selectedStitchVersion,
            save_as: saveAs,
            name: name || null,
          }),
        }
      );
      if (!res.ok) throw new Error();
      await queryClient.invalidateQueries({ queryKey: ["orthomosaic-info", runId] });
      await queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] });
      await queryClient.invalidateQueries({ queryKey: ["plot-boundaries", runId] });
      showSuccessToast(
        saveAs ? "Saved as new version" : "Plot boundaries saved"
      );
      if (saveAs) onSaved?.();
    } catch {
      showErrorToast("Failed to save grid");
    } finally {
      setIsSaving(false);
      setPendingSaveAs(false);
    }
  }

  function openSaveAsDialog() {
    setSaveAsName("");
    setShowSaveAsDialog(true);
  }

  function confirmSaveAs() {
    setShowSaveAsDialog(false);
    handleSave(true, saveAsName.trim() || undefined);
  }

  if (orthoLoading) {
    return (
      <div className="text-muted-foreground flex h-64 items-center justify-center gap-2 text-sm">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading mosaic…
      </div>
    );
  }

  if (!orthoInfo?.available) {
    return (
      <div className="text-muted-foreground flex h-64 flex-col items-center justify-center gap-2">
        <AlertCircle className="h-8 w-8" />
        <p className="text-sm">
          No mosaic found for this run. Complete the preceding processing steps
          first.
        </p>
      </div>
    );
  }

  const featureCount = previewGeoJson?.features?.length ?? 0;

  return (
    <div className="space-y-3">
      {/* Field design status banner */}
      <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
        {fdInfo?.available ? (
          <span className="text-green-700">
            Field design loaded — {fdInfo.row_count} rows × {fdInfo.col_count}{" "}
            cols
          </span>
        ) : (
          <span className="flex items-center gap-1 font-medium text-red-600">
            ⚠ Field design required — upload one to draw plot boundaries and
            merge accession data.
          </span>
        )}
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowUploadDialog(true)}
          >
            <Upload className="mr-1 h-3 w-3" />
            {fdInfo?.available ? "Replace" : "Upload"}
          </Button>
        </div>
      </div>

      <details className="bg-muted/40 rounded-md border text-sm">
        <summary className="flex cursor-pointer select-none list-none items-center justify-between px-4 py-2.5 font-medium">
          Instructions
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform [[open]_&]:rotate-180" />
        </summary>
        <ol className="list-inside list-decimal space-y-1.5 px-4 pb-3 pt-1">
          <li>
            Click the <strong>polygon icon</strong> (⬠) in the{" "}
            <strong>top-left toolbar</strong> to draw the outer field boundary.{" "}
            <strong>Double-click</strong> to finish. You can edit or redraw it at
            any time using the toolbar.
          </li>
          <li>
            Adjust plot dimensions in the <strong>Plot Settings</strong> panel
            (bottom-right), then click <strong>Generate Grid</strong> to preview
            the plot grid.
          </li>
          <li>
            Use <strong>Move</strong> mode to drag selected plots into position, or
            adjust the <strong>Angle</strong>. After changing settings, click{" "}
            <strong>Regenerate Grid</strong> to apply.
          </li>
          <li>
            In <strong>Select</strong> mode: <strong>click</strong> a plot to
            select it, <strong>Shift+click</strong> to add/remove, or{" "}
            <strong>drag</strong> a rectangle to multi-select.
          </li>
          <li>
            Click <strong>Save</strong> to save and close.
          </li>
        </ol>
      </details>

      {/* Map with floating grid settings panel */}
      {/* isolation:isolate contains Leaflet's internal z-indices so dialogs render above */}
      <div className="relative" style={{ isolation: "isolate" }}>
        <div
          ref={mapContainerRef}
          className="w-full overflow-hidden rounded-lg border"
          style={{ height: 600 }}
        />
        {hasBoundary && (
          <GridSettingsPanel
            options={gridOptions}
            onChange={handleGridOptionsChange}
            interactionMode={interactionMode}
            onModeChange={handleModeChange}
            onSelectAll={() =>
              setSelectedIndexes(
                Array.from({ length: featureCount }, (_, i) => i)
              )
            }
            onClearSelection={() => setSelectedIndexes([])}
            onDeleteSelected={() => {
              if (selectedIndexes.length > 0) setShowDeleteConfirm(true);
            }}
            featureCount={featureCount}
            selectedCount={selectedIndexes.length}
            onGenerateGrid={handleGenerateGrid}
            gridGenerated={gridGenerated}
            gridVisible={gridVisible}
            onToggleGrid={() => setGridVisible((v) => !v)}
            pipelineType={pipelineType}
            fdAvailable={fdInfo?.available}
            fdTransform={fdTransform}
            onFdTransformChange={setFdTransform}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
          />
        )}
        {!hasBoundary && (
          <div className="bg-background/90 pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg border px-4 py-2 text-sm shadow">
            Use the <strong>polygon tool</strong> (top-left) to draw the outer
            field boundary
          </div>
        )}
        {/* Bottom-left: stacked version selectors */}
        <div className="absolute bottom-4 left-4 z-[1000] flex flex-col gap-1">
          {/* Stitch version selector (ground only) */}
          {pipelineType === "ground" && orthoInfo.stitch_versions && orthoInfo.stitch_versions.length > 0 && (
            <select
              value={selectedStitchVersion ?? ""}
              onChange={(e) => setSelectedStitchVersion(Number(e.target.value))}
              className="border-input bg-background/90 rounded border px-1.5 py-1 text-xs shadow focus:outline-none"
            >
              {orthoInfo.stitch_versions.map((v) => (
                <option key={v.version} value={v.version}>
                  Stitching: {v.name ? `${v.name} (v${v.version})` : `v${v.version}`}
                </option>
              ))}
            </select>
          )}
          {/* Ortho version selector (aerial only) */}
          {pipelineType === "aerial" && orthoInfo.ortho_versions && orthoInfo.ortho_versions.length > 0 && (
            <select
              value={selectedOrthoVersion ?? ""}
              onChange={(e) => setSelectedOrthoVersion(Number(e.target.value))}
              className="border-input bg-background/90 rounded border px-1.5 py-1 text-xs shadow focus:outline-none"
            >
              {orthoInfo.ortho_versions.map((v) => (
                <option key={v.version} value={v.version}>
                  Orthomosaic: {v.name ? `${v.name} (v${v.version})` : `v${v.version}`}
                </option>
              ))}
            </select>
          )}
          {/* Boundary version selector */}
          {orthoInfo.plot_boundary_versions && orthoInfo.plot_boundary_versions.length > 1 && (
            <select
              value={selectedBoundaryVersion ?? ""}
              onChange={(e) => loadBoundaryVersion(Number(e.target.value))}
              className="border-input bg-background/90 rounded border px-1.5 py-1 text-xs shadow focus:outline-none"
            >
              {orthoInfo.plot_boundary_versions.map((v) => (
                <option key={v.version} value={v.version}>
                  Boundary: {v.name ? `${v.name} (v${v.version})` : `v${v.version}`}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        {previewGeoJson && (
          <>
            <Button variant="secondary" className="bg-secondary/60 hover:bg-secondary/80" onClick={() => handleSave(false)} disabled={isSaving}>
              {isSaving && !pendingSaveAs ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save"
              )}
            </Button>
            <Button
              onClick={openSaveAsDialog}
              disabled={isSaving}
            >
              {pendingSaveAs ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save As"
              )}
            </Button>
          </>
        )}
      </div>

      <FieldDesignUploadDialog
        open={showUploadDialog}
        onClose={() => setShowUploadDialog(false)}
        runId={runId}
        onSaved={async (info) => {
          const result = await refetchFd();
          const newRows = (result.data as FieldDesignInfo | undefined)?.rows;
          if (pipelineType === "ground" && previewGeoJsonRef.current) {
            // Ground: keep existing georeferenced boundaries, only re-merge labels
            const fc = mergeLabelsIntoExisting(previewGeoJsonRef.current, newRows ?? [], fdTransform);
            setPreviewGeoJson(fc);
            setSelectedIndexes([]);
            pushHistory(fc);
          } else {
            // Aerial: update row/col counts and regenerate the rectangular grid
            const newOpts = {
              ...gridOptions,
              rows: info.row_count || gridOptions.rows,
              columns: info.col_count || gridOptions.columns,
            };
            setGridOptions(newOpts);
            if (gridGenerated && popBoundary) {
              const fc = computeGrid(popBoundary, newOpts, gridOffset, newRows);
              setPreviewGeoJson(fc);
              setSelectedIndexes([]);
              pushHistory(fc);
            }
          }
        }}
      />

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={(o) => !o && setShowDeleteConfirm(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete selected plots?</DialogTitle>
            <DialogDescription>
              This will permanently remove{" "}
              <strong>{selectedIndexes.length} plot{selectedIndexes.length !== 1 ? "s" : ""}</strong>{" "}
              from the grid. Use undo (Ctrl+Z) to restore them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!previewGeoJson) { setShowDeleteConfirm(false); return; }
                const selSet = new Set(selectedIndexes);
                const remaining = previewGeoJson.features.filter((_, i) => !selSet.has(i));
                const fc = { ...previewGeoJson, features: remaining };
                setPreviewGeoJson(fc);
                setSelectedIndexes([]);
                pushHistory(fc);
                setShowDeleteConfirm(false);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* No field design warning */}
      <Dialog open={noFdWarningOpen} onOpenChange={(o) => !o && setNoFdWarningOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>No Field Design Loaded</DialogTitle>
            <DialogDescription>
              No field design file has been uploaded for this run. The grid may not
              match the actual plot layout (rows × columns will use the current
              settings). You can upload a field design using the button in the
              settings panel.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoFdWarningOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => { setNoFdWarningOpen(false); _doGenerateGrid(); }}>
              Generate Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showSaveAsDialog}
        onOpenChange={(o) => !o && setShowSaveAsDialog(false)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save As New Version</DialogTitle>
            <DialogDescription>
              Give this boundary version a name (optional).
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="save-as-name" className="mb-1 block text-sm">
              Name
            </Label>
            <Input
              id="save-as-name"
              placeholder="e.g. final, adjusted, wide-plots"
              value={saveAsName}
              onChange={(e) => setSaveAsName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmSaveAs();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowSaveAsDialog(false)}
            >
              Cancel
            </Button>
            <Button onClick={confirmSaveAs}>Save As</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
