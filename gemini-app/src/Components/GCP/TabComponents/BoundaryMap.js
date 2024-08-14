import React, { useState, useEffect } from "react";
import DeckGL from "@deck.gl/react";
import { BitmapLayer, GeoJsonLayer } from "@deck.gl/layers";
import { TileLayer } from "@deck.gl/geo-layers";
import { Map } from "react-map-gl";
import { EditableGeoJsonLayer, TranslateMode, DrawPolygonMode, ModifyMode, ViewMode, SelectionLayer } from "nebula.gl";
import { useDataState, useDataSetters, TILE_URL_TEMPLATE } from "../../../DataContext";
import GeoJsonTooltip from "../../Map/ToolTip";
import { ModeSwitcher } from "../../Util/MapModeSwitcher";
import { MapOrthoSwitcher } from "../../Util/MapOrthoSwitcher";
import PlotProposalSwitcher from "../../Util/PlotProposalSwitcher";
import useTrackComponent from "../../../useTrackComponent";
import useExtentFromBounds from "../../Map/MapHooks";
import { FlyToInterpolator } from "@deck.gl/core";

// const fc = {
//     type: "FeatureCollection",
//     crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
//     features: [],
// };

export const drawPolygonMode = new DrawPolygonMode();
export const modifyMode = new ModifyMode();
export const translateMode = new TranslateMode();
export const viewMode = new ViewMode();
export const selectionMode = new TranslateMode();




function BoundaryMap({ task }) {
    useTrackComponent("BoundaryMap");
    const INITIAL_TILE_URL =
        "http://127.0.0.1:8091/cog/tiles/WebMercatorQuad/{z}/{x}/{y}?scale=1&url=${FILE_PATH}&unscale=false&resampling=nearest&return_mask=true";
    const INITIAL_BOUNDS_URL = "http://127.0.0.1:8091/cog/bounds?url=${FILE_PATH}";
    
    const {
        viewState,
        selectedTilePath,
        flaskUrl,
        tileUrl,
        boundsUrl,
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedYearGCP,
        selectedExperimentGCP,
        prepOrthoImagePath,
        cursorStyle,
        featureCollectionPop,
        featureCollectionPlot,
        showTooltipGCP,
    } = useDataState();
    const { setViewState, setCursorStyle, setFeatureCollectionPop, setFeatureCollectionPlot, setSelectedTilePath, setTileUrl, setBoundsUrl } = useDataSetters();

    const [featureCollection, setFeatureCollection] =
        task === "pop_boundary"
            ? [featureCollectionPop, setFeatureCollectionPop]
            : [featureCollectionPlot, setFeatureCollectionPlot];

    const [prepOrthoTileLayer, setPrepOrthoTileLayer] = useState(null);
    const [hoverInfoGCP, setHoverInfoGCP] = useState(null);
    
    useEffect(() => {
        if (prepOrthoImagePath) {
            const newPath = "files/" + prepOrthoImagePath;
            setSelectedTilePath(newPath);
            
            const encodedPath = encodeURIComponent(`${flaskUrl}${newPath}`);
            setTileUrl(INITIAL_TILE_URL.replace("${FILE_PATH}", encodedPath));
            setBoundsUrl(INITIAL_BOUNDS_URL.replace("${FILE_PATH}", encodedPath));
        } else {
            setTileUrl(INITIAL_TILE_URL);
            setBoundsUrl(INITIAL_BOUNDS_URL);
        }
        const newPrepOrthoTileLayer = new TileLayer({
            id: "geotiff-tile-layer",
            minZoom: 10,
            maxZoom: 48,
            tileSize: 256,
            data: TILE_URL_TEMPLATE.replace(
                "${FILE_PATH}",
                encodeURIComponent(`${flaskUrl}files/${prepOrthoImagePath}`)
            ),
            renderSubLayers: (props) => {
                const {
                    bbox: { west, south, east, north },
                } = props.tile;

                return new BitmapLayer(props, {
                    data: null,
                    image: props.data,
                    bounds: [west, south, east, north],
                });
            },
        });

        setPrepOrthoTileLayer(newPrepOrthoTileLayer);
    }, [prepOrthoImagePath]);

    const extentBounds = useExtentFromBounds(boundsUrl);

    useEffect(() => {
        if (extentBounds) {
            const [minLon, minLat, maxLon, maxLat] = extentBounds;
            const longitude = (minLon + maxLon) / 2;
            const latitude = (minLat + maxLat) / 2;

            // Width and height of the current view in pixels
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            // Map extents in degrees
            const mapLngDelta = maxLon - minLon;
            const mapLatDelta = maxLat - minLat;

            // Calculate zoom level
            let zoomLng = Math.floor(Math.log((viewportWidth * 360) / mapLngDelta) / Math.log(2));
            let zoomLat = Math.floor(Math.log((viewportHeight * 360) / mapLatDelta) / Math.log(2));

            const zoom = Math.min(zoomLng, zoomLat) - 9.5;

            setViewState((prevViewState) => ({
                ...prevViewState,
                longitude,
                latitude,
                zoom,
                transitionDuration: 1000, // 1 second transition
                transitionInterpolator: new FlyToInterpolator(),
            }));
        }
    }, [extentBounds]);

    useEffect(() => {
        console.log("task", task);
        const fcPop = async () => {
            const selectedLocationGcp = selectedLocationGCP;
            const selectedPopulationGcp = selectedPopulationGCP;
            let filename;

            if (task === "pop_boundary") {
                filename = "Pop-Boundary-WGS84.geojson";
            } else if (task === "plot_boundary") {
                filename = "Plot-Boundary-WGS84.geojson";
            }

            try {
                const data = {
                    selectedLocationGcp: selectedLocationGcp,
                    selectedPopulationGcp: selectedPopulationGcp,
                    selectedYearGcp: selectedYearGCP,
                    selectedExperimentGcp: selectedExperimentGCP,
                    filename: filename,
                };

                console.log("data for load json ", data);

                const response = await fetch(`${flaskUrl}load_geojson`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(data),
                });
                if (response.ok) {
                    console.log("response", response);
                    const geojsonData = await response.json();
                    console.log(geojsonData);
                    geojsonData.features
                        ? setFeatureCollection(geojsonData)
                        : setFeatureCollection({ type: "FeatureCollection", features: [] });
                } else {
                    console.error("Failed to load data");
                    setFeatureCollection({
                        type: "FeatureCollection",
                        features: [],
                    });
                }
            } catch (error) {
                console.error("Error loading data:", error);
                setFeatureCollection({
                    type: "FeatureCollection",
                    features: [],
                });
            }
        };

        fcPop();
    }, [selectedLocationGCP, selectedPopulationGCP]);

    const [selectedFeatureIndexes, setSelectedFeatureIndexes] = useState([]);
    const [mode, setMode] = useState(viewMode);

    // Set cursor style
    useEffect(() => {
        if (mode === drawPolygonMode) {
            setCursorStyle("crosshair");
        } else if (mode === modifyMode) {
            setCursorStyle("crosshair");
        } else if (mode === translateMode) {
            setCursorStyle("default");
        } else if (mode === viewMode) {
            setCursorStyle("grab");
        } else if (mode === selectionMode) {
            setCursorStyle("crosshair");
        } else {
            setCursorStyle("default");
        }
        console.log("Cursor style set to", cursorStyle);
    }, [mode, setCursorStyle]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.key === "Backspace" || e.key === "Delete") && selectedFeatureIndexes.length) {
                if (mode === translateMode || mode === selectionMode) {
                    e.preventDefault();
                    const newFeatures = featureCollection.features.filter(
                        (_, index) => !selectedFeatureIndexes.includes(index)
                    );
                    setFeatureCollection({
                        ...featureCollection,
                        features: newFeatures,
                    });
                    setSelectedFeatureIndexes([]);
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [selectedFeatureIndexes, featureCollection, mode]);

    const layer = new EditableGeoJsonLayer({
        id: "geojson-layer",
        minZoom: 10,
        maxZoom: 48,
        data: featureCollection,
        mode: mode,
        selectedFeatureIndexes: selectedFeatureIndexes,
        onEdit: ({ updatedData, editType, featureIndexes }) => {
            if (editType === "addFeature") {
                setSelectedFeatureIndexes(featureIndexes);
            }
            setFeatureCollection(updatedData);
            console.log(updatedData);
        },
        onClick: ({ index }) => {
            if (index !== -1) {
                // If a feature is clicked, select it
                setSelectedFeatureIndexes([index]);
            }
        },
        onHover: ({ object, index, x, y }) => {
            if (mode === translateMode && object && selectedFeatureIndexes.length < 2) {
                // When hovering over a feature in translate mode, select it
                setSelectedFeatureIndexes([index]);
            }
            setHoverInfoGCP({ object: object, x: x, y: y });
        },
    });

    const selectionLayer = new SelectionLayer({
        id: "selection-layer",
        minZoom: 10,
        maxZoom: 48,
        selectionType: "rectangle",
        onSelect: ({ pickingInfos }) => {
            const selectedFeatureIndexes = pickingInfos.map((info) => info.index);
            setSelectedFeatureIndexes(selectedFeatureIndexes);
        },
        layerIds: ["geojson-layer"],
    });

    const controller = {
        doubleClickZoom: !(mode === drawPolygonMode || mode === modifyMode),
    };

    return (
        <div style={{ height: "80vh", width: "85vw", position: "absolute" }}>
            <DeckGL
                initialViewState={viewState}
                controller={controller}
                layers={
                    mode === selectionMode ? [prepOrthoTileLayer, layer, selectionLayer] : [prepOrthoTileLayer, layer]
                }
                onViewStateChange={({ viewState }) => setViewState(viewState)}
                getCursor={() => cursorStyle}
                minZoom={10}
                maxZoom={48}
            >
                <Map
                    mapStyle="mapbox://styles/mapbox/satellite-v9"
                    mapboxAccessToken="pk.eyJ1IjoibWFzb25lYXJsZXMiLCJhIjoiY2xkeXR3bXNyMG5heDNucHJhYWFscnZnbyJ9.A03O6PN1N1u771c4Qqg1SA"
                    minZoom={10}
                    maxZoom={48}
                />
            </DeckGL>
            <ModeSwitcher
                currentMode={mode}
                setMode={setMode}
                task={task}
                featureCollection={featureCollection}
                setSelectedFeatureIndexes={setSelectedFeatureIndexes}
            />
            <MapOrthoSwitcher />
            {task === "plot_boundary" && <PlotProposalSwitcher />}
            {showTooltipGCP && (
                <GeoJsonTooltip hoverInfo={hoverInfoGCP} selectedMetric={["row", "column", "plot", "accession"]} />
            )}
        </div>
    );
}

export default BoundaryMap;
