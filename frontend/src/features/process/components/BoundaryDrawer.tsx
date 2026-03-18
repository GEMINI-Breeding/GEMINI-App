/**
 * BoundaryDrawer — interactive tool for aerial pipeline Step 3.
 *
 * Displays the orthomosaic as a Leaflet ImageOverlay and lets the user draw
 * plot polygon boundaries using Geoman. Saves the result as a GeoJSON
 * FeatureCollection via POST /plot-boundaries.
 *
 * The orthomosaic is served through the backend /files/serve endpoint so no
 * tile server is required for basic display.
 */
// test change

import "leaflet/dist/leaflet.css";
import "@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import L from "leaflet";
import { AlertCircle, Loader2, Trash2 } from "lucide-react";

import { ProcessingService } from "@/client";
import { Button } from "@/components/ui/button";
import useCustomToast from "@/hooks/useCustomToast";

function apiUrl(path: string): string {
  const base = (window as any).__GEMI_BACKEND_URL__ ?? "";
  return base ? `${base}${path}` : path;
}

// Fix Leaflet's broken default icon paths when bundled with Vite
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
  // [[southLat, westLon], [northLat, eastLon]]
  bounds: [[number, number], [number, number]] | null;
  existing_geojson: GeoJSON.FeatureCollection | null;
}

interface BoundaryDrawerProps {
  runId: string;
  onSaved: () => void;
  onCancel: () => void;
}

// ── Geoman layer counter ───────────────────────────────────────────────────────

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

export function BoundaryDrawer({
  runId,
  onSaved,
  onCancel,
}: BoundaryDrawerProps) {
  const { showErrorToast } = useCustomToast();
  const queryClient = useQueryClient();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.ImageOverlay | null>(null);
  const drawnLayersRef = useRef<L.FeatureGroup | null>(null);
  const [featureCount, setFeatureCount] = useState(0);

  // Fetch orthomosaic info
  const { data: orthoInfo, isLoading } = useQuery<OrthoInfo>({
    queryKey: ["orthomosaic-info", runId],
    queryFn: () =>
      ProcessingService.orthomosaicInfo({
        id: runId,
      }) as unknown as Promise<OrthoInfo>,
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (geojson: GeoJSON.FeatureCollection) =>
      ProcessingService.savePlotBoundaries({
        id: runId,
        requestBody: {
          geojson: geojson as unknown as { [key: string]: unknown },
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pipeline-runs", runId] });
      onSaved();
    },
    onError: () => showErrorToast("Failed to save plot boundaries"),
  });

  // Initialise map once orthoInfo is available
  useEffect(() => {
    if (!orthoInfo?.available || !orthoInfo.bounds || !mapContainerRef.current)
      return;
    if (mapRef.current) return; // already initialised

    const bounds = L.latLngBounds(orthoInfo.bounds[0], orthoInfo.bounds[1]);

    const map = L.map(mapContainerRef.current, {
      crs: L.CRS.EPSG3857,
      center: bounds.getCenter(),
      zoom: 17,
      minZoom: 10,
      maxZoom: 22,
    });
    mapRef.current = map;

    // Base tile layer for spatial context
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      opacity: 0.4,
    }).addTo(map);

    // Orthomosaic as ImageOverlay served through backend
    const imgSrc = apiUrl(
      `/api/v1/files/serve?path=${encodeURIComponent(orthoInfo.path!)}`
    );
    const overlay = L.imageOverlay(imgSrc, bounds, { opacity: 0.9 }).addTo(map);
    overlayRef.current = overlay;
    map.fitBounds(bounds);

    // Feature group for drawn layers
    const drawnLayers = new L.FeatureGroup();
    drawnLayersRef.current = drawnLayers;
    drawnLayers.addTo(map);

    // Load existing boundaries if present
    if (orthoInfo.existing_geojson) {
      const existing = L.geoJSON(orthoInfo.existing_geojson, {
        style: { color: "#2563eb", weight: 2, fillOpacity: 0.15 },
      });
      existing.eachLayer((l) => drawnLayers.addLayer(l));
      setFeatureCount(orthoInfo.existing_geojson.features?.length ?? 0);
    }

    // Enable Geoman drawing controls (polygon only)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        dragMode: true,
        cutPolygon: false,
        removalMode: true,
        rotateMode: false,
      });

      // Style drawn layers consistently
      mapAny.pm.setGlobalOptions({
        layerGroup: drawnLayers,
        pathOptions: { color: "#2563eb", weight: 2, fillOpacity: 0.15 },
      });

      // Update feature count whenever a layer is created, edited, or removed
      const refresh = () => {
        setFeatureCount(drawnLayers.getLayers().length);
      };
      map.on("pm:create", refresh);
      map.on("pm:remove", refresh);
      map.on("pm:edit", refresh);
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [orthoInfo]);

  const handleClearAll = () => {
    drawnLayersRef.current?.clearLayers();
    setFeatureCount(0);
  };

  const handleSave = () => {
    const layers = drawnLayersRef.current?.getLayers() ?? [];
    const features: GeoJSON.Feature[] = layers
      .map(layerToFeature)
      .filter((f): f is GeoJSON.Feature => f !== null);

    const geojson: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features,
    };
    saveMutation.mutate(geojson);
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
          No mosaic found for this run. Complete the preceding processing steps
          first.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          Draw polygons on the map to define plot boundaries.{" "}
          <span className="text-foreground font-medium">{featureCount}</span>{" "}
          polygon
          {featureCount !== 1 ? "s" : ""} drawn.
        </p>
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
