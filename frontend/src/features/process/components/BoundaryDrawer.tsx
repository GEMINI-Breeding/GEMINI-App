/**
 * BoundaryDrawer — interactive tool for aerial/ground pipeline plot boundaries.
 *
 * Displays the orthomosaic as a Leaflet ImageOverlay and lets the user draw
 * plot polygon boundaries using Geoman. Saves the result as a GeoJSON
 * FeatureCollection via POST /plot-boundaries.
 */

import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import L from "leaflet";
import {
  AlertCircle,
  Loader2,
  MessageSquare,
  MessageSquareOff,
  Move,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";

import { ProcessingService } from "@/client";
import { Button } from "@/components/ui/button";
import useCustomToast from "@/hooks/useCustomToast";

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? "";
  return base ? `${base}${path}` : path;
}

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)
  ._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ── Types ──────────────────────────────────────────────────────────────────────

interface OrthoInfo {
  available: boolean;
  path: string | null;
  bounds: [[number, number], [number, number]] | null;
  existing_geojson: GeoJSON.FeatureCollection | null;
}

interface BoundaryDrawerProps {
  runId: string;
  onSaved: () => void;
  onCancel: () => void;
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const DEFAULT_STYLE = { color: "#2563eb", weight: 2, fillOpacity: 0.15 };
const SELECTED_STYLE = { color: "#f59e0b", weight: 3, fillOpacity: 0.3 };

// ── Helpers ────────────────────────────────────────────────────────────────────

function layerToFeature(layer: L.Layer): GeoJSON.Feature | null {
  if (
    layer instanceof L.Polygon ||
    layer instanceof L.Polyline ||
    layer instanceof L.Rectangle ||
    layer instanceof L.Circle ||
    layer instanceof L.CircleMarker ||
    layer instanceof L.Marker
  ) {
    return (layer as unknown as { toGeoJSON(): GeoJSON.Feature }).toGeoJSON();
  }
  return null;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function BoundaryDrawer({ runId, onSaved, onCancel }: BoundaryDrawerProps) {
  const { showErrorToast } = useCustomToast();
  const queryClient = useQueryClient();

  // Map refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const drawnLayersRef = useRef<L.FeatureGroup | null>(null);

  // Selection state
  const selectedLayersRef = useRef<Set<L.Layer>>(new Set());
  const [selectedCount, setSelectedCount] = useState(0);

  // Move mode (selection-gated drag)
  const isMoveModeRef = useRef(false);
  const [isMoveMode, setIsMoveMode] = useState(false);

  // Undo/redo history
  const historyRef = useRef<GeoJSON.Feature[][]>([[]]);
  const historyIdxRef = useRef(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // UI state
  const [featureCount, setFeatureCount] = useState(0);
  const [tooltipsEnabled, setTooltipsEnabled] = useState(true);

  // Fetch orthomosaic info
  const { data: orthoInfo, isLoading } = useQuery<OrthoInfo>({
    queryKey: ["orthomosaic-info", runId],
    queryFn: () =>
      ProcessingService.orthomosaicInfo({ id: runId }) as unknown as Promise<OrthoInfo>,
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (geojson: GeoJSON.FeatureCollection) =>
      ProcessingService.savePlotBoundaries({
        id: runId,
        requestBody: { geojson: geojson as unknown as { [key: string]: unknown } },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] });
      onSaved();
    },
    onError: () => showErrorToast("Failed to save plot boundaries"),
  });

  // ── Stable callbacks (use refs only, no closure deps) ─────────────────────

  /** Snapshot the current drawn-layer state into undo history. */
  const pushHistory = useCallback(() => {
    const layers = drawnLayersRef.current?.getLayers() ?? [];
    const features = layers
      .map(layerToFeature)
      .filter((f): f is GeoJSON.Feature => f !== null);

    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push(features);
    historyIdxRef.current = historyRef.current.length - 1;
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(false);
    setFeatureCount(features.length);
  }, []);

  /** Stop drag on all layers and exit move mode. */
  const exitMoveMode = useCallback(() => {
    isMoveModeRef.current = false;
    setIsMoveMode(false);
    drawnLayersRef.current?.getLayers().forEach((l: any) => {
      if (l.pm) l.pm.disableLayerDrag();
    });
  }, []);

  /**
   * Attach per-layer listeners (selection click + undo-history events).
   * Must be called for every layer added to drawnLayers.
   *
   * NOTE: pm:update and pm:dragend are LAYER-level events in Geoman — they do
   * NOT bubble to the map, so map.on("pm:edit") / map.on("pm:dragend") never
   * fire.  We attach them directly to each layer here instead.
   */
  const addLayerListeners = useCallback(
    (layer: L.Layer) => {
      const layerAny = layer as any;

      // Click → toggle selection (stop propagation so the map's deselect-all
      // click handler doesn't immediately cancel it)
      layer.on("click", (e: any) => {
        L.DomEvent.stopPropagation(e);
        if (selectedLayersRef.current.has(layer)) {
          selectedLayersRef.current.delete(layer);
          layerAny.setStyle?.(DEFAULT_STYLE);
        } else {
          selectedLayersRef.current.add(layer);
          layerAny.setStyle?.(SELECTED_STYLE);
        }
        setSelectedCount(selectedLayersRef.current.size);
      });

      // pm:update fires when a vertex is moved during edit mode (layer-level)
      layerAny.on("pm:update", pushHistory);
      // pm:dragend fires when a drag ends (layer-level)
      layerAny.on("pm:dragend", () => {
        pushHistory();
        // Re-enter move mode is done — disable drag until user clicks Move again
        if (isMoveModeRef.current) exitMoveMode();
      });
    },
    [pushHistory, exitMoveMode],
  );

  /**
   * Restore drawnLayers to a set of features (used by undo/redo).
   * Clears current selection and move mode, then re-attaches all listeners.
   */
  const restoreFeatures = useCallback(
    (features: GeoJSON.Feature[]) => {
      const drawnLayers = drawnLayersRef.current;
      if (!drawnLayers) return;

      if (isMoveModeRef.current) exitMoveMode();

      selectedLayersRef.current.clear();
      setSelectedCount(0);

      drawnLayers.clearLayers();
      if (features.length > 0) {
        L.geoJSON({ type: "FeatureCollection", features }, { style: DEFAULT_STYLE }).eachLayer(
          (l) => {
            addLayerListeners(l);
            drawnLayers.addLayer(l);
          },
        );
      }
      setFeatureCount(features.length);
    },
    [addLayerListeners, exitMoveMode],
  );

  // ── Map initialisation ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!orthoInfo?.available || !orthoInfo.bounds || !mapContainerRef.current) return;
    if (mapRef.current) return;

    const bounds = L.latLngBounds(orthoInfo.bounds[0], orthoInfo.bounds[1]);
    const map = L.map(mapContainerRef.current, {
      crs: L.CRS.EPSG3857,
      center: bounds.getCenter(),
      zoom: 17,
      minZoom: 10,
      maxZoom: 22,
    });
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      opacity: 0.4,
    }).addTo(map);

    L.imageOverlay(
      apiUrl(`/api/v1/files/serve?path=${encodeURIComponent(orthoInfo.path!)}`),
      bounds,
      { opacity: 0.9 },
    ).addTo(map);
    map.fitBounds(bounds);

    const drawnLayers = new L.FeatureGroup();
    drawnLayersRef.current = drawnLayers;
    drawnLayers.addTo(map);

    // Load existing boundaries and attach listeners to each layer
    const initialFeatures = orthoInfo.existing_geojson?.features ?? [];
    if (initialFeatures.length > 0) {
      L.geoJSON(
        { type: "FeatureCollection", features: initialFeatures },
        { style: DEFAULT_STYLE },
      ).eachLayer((l) => {
        addLayerListeners(l);
        drawnLayers.addLayer(l);
      });
      setFeatureCount(initialFeatures.length);
    }

    // Seed undo history
    historyRef.current = [initialFeatures];
    historyIdxRef.current = 0;
    setCanUndo(false);
    setCanRedo(false);

    // ── Geoman setup (dragMode disabled — we manage drag via selection) ──────
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
        drawRectangle: true,
        editMode: true,
        dragMode: false,   // replaced by our selection-gated Move button
        cutPolygon: false,
        removalMode: true,
        rotateMode: false,
      });

      mapAny.pm.setGlobalOptions({
        layerGroup: drawnLayers,
        pathOptions: DEFAULT_STYLE,
      });
    }

    // pm:create and pm:remove DO fire on the map in Geoman
    map.on("pm:create", (e: any) => {
      if (e.layer) addLayerListeners(e.layer);
      pushHistory();
    });

    map.on("pm:remove", (e: any) => {
      if (e.layer) {
        selectedLayersRef.current.delete(e.layer);
        setSelectedCount(selectedLayersRef.current.size);
      }
      pushHistory();
    });

    // Clicking empty map space clears selection and exits move mode
    map.on("click", () => {
      selectedLayersRef.current.forEach((l: any) => l.setStyle?.(DEFAULT_STYLE));
      selectedLayersRef.current.clear();
      setSelectedCount(0);
      if (isMoveModeRef.current) exitMoveMode();
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [orthoInfo, addLayerListeners, pushHistory, exitMoveMode]);

  // ── Undo / Redo ────────────────────────────────────────────────────────────

  const handleUndo = () => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current--;
    restoreFeatures(historyRef.current[historyIdxRef.current]);
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(true);
  };

  const handleRedo = () => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current++;
    restoreFeatures(historyRef.current[historyIdxRef.current]);
    setCanUndo(true);
    setCanRedo(historyIdxRef.current < historyRef.current.length - 1);
  };

  // ── Selection ──────────────────────────────────────────────────────────────

  const handleSelectAll = () => {
    const drawnLayers = drawnLayersRef.current;
    if (!drawnLayers) return;
    // Deselect current first
    selectedLayersRef.current.forEach((l: any) => l.setStyle?.(DEFAULT_STYLE));
    selectedLayersRef.current.clear();
    // Select all
    drawnLayers.getLayers().forEach((l: any) => {
      selectedLayersRef.current.add(l);
      l.setStyle?.(SELECTED_STYLE);
    });
    setSelectedCount(selectedLayersRef.current.size);
  };

  // ── Move mode ──────────────────────────────────────────────────────────────

  const handleToggleMove = () => {
    if (isMoveMode) {
      exitMoveMode();
    } else {
      if (selectedLayersRef.current.size === 0) return;
      isMoveModeRef.current = true;
      setIsMoveMode(true);
      // Only enable drag on selected layers
      selectedLayersRef.current.forEach((l: any) => {
        if (l.pm) l.pm.enableLayerDrag();
      });
    }
  };

  // ── Tooltip toggle ─────────────────────────────────────────────────────────

  const handleTooltipToggle = () => {
    const next = !tooltipsEnabled;
    setTooltipsEnabled(next);
    (mapRef.current as any)?.pm.setGlobalOptions({ tooltips: next });
  };

  // ── Clear all ──────────────────────────────────────────────────────────────

  const handleClearAll = () => {
    if (isMoveModeRef.current) exitMoveMode();
    selectedLayersRef.current.clear();
    setSelectedCount(0);
    drawnLayersRef.current?.clearLayers();

    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1);
    historyRef.current.push([]);
    historyIdxRef.current = historyRef.current.length - 1;
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(false);
    setFeatureCount(0);
  };

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = () => {
    const layers = drawnLayersRef.current?.getLayers() ?? [];
    const features = layers
      .map(layerToFeature)
      .filter((f): f is GeoJSON.Feature => f !== null);
    saveMutation.mutate({ type: "FeatureCollection", features });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
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
          No mosaic found for this run. Complete the preceding processing steps first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Undo / Redo */}
        <Button variant="outline" size="sm" onClick={handleUndo} disabled={!canUndo} title="Undo">
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="sm" onClick={handleRedo} disabled={!canRedo} title="Redo">
          <Redo2 className="h-3.5 w-3.5" />
        </Button>

        <div className="h-4 w-px bg-border" />

        {/* Select All */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleSelectAll}
          disabled={featureCount === 0}
          title="Select all polygons"
        >
          Select All
        </Button>

        {/* Move (selection-gated) */}
        <Button
          variant={isMoveMode ? "secondary" : "outline"}
          size="sm"
          onClick={handleToggleMove}
          disabled={selectedCount === 0}
          title={
            selectedCount === 0
              ? "Select one or more polygons first"
              : isMoveMode
                ? "Exit move mode"
                : `Move ${selectedCount} selected polygon(s)`
          }
        >
          <Move className="mr-1 h-3.5 w-3.5" />
          Move{selectedCount > 0 ? ` (${selectedCount})` : ""}
        </Button>

        <div className="h-4 w-px bg-border" />

        {/* Tooltip toggle */}
        <Button
          variant={tooltipsEnabled ? "secondary" : "outline"}
          size="sm"
          onClick={handleTooltipToggle}
          title={tooltipsEnabled ? "Hide drawing tooltips" : "Show drawing tooltips"}
        >
          {tooltipsEnabled ? (
            <MessageSquare className="h-3.5 w-3.5" />
          ) : (
            <MessageSquareOff className="h-3.5 w-3.5" />
          )}
        </Button>

        <span className="text-muted-foreground text-xs ml-auto">
          <span className="text-foreground font-medium">{featureCount}</span> polygon
          {featureCount !== 1 ? "s" : ""}
          {selectedCount > 0 && (
            <span className="text-amber-600 ml-1">· {selectedCount} selected</span>
          )}
        </span>

        {/* Clear All */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleClearAll}
          disabled={featureCount === 0}
        >
          <Trash2 className="mr-1 h-3 w-3" />
          Clear All
        </Button>
      </div>

      {/* Map */}
      <div
        ref={mapContainerRef}
        className="w-full overflow-hidden rounded-lg border"
        style={{ height: 520 }}
      />

      {/* Footer */}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          className="flex-1"
          disabled={featureCount === 0 || saveMutation.isPending}
          onClick={handleSave}
        >
          {saveMutation.isPending ? "Saving…" : "Save Boundaries"}
        </Button>
      </div>
    </div>
  );
}
