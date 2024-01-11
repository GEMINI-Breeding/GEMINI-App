import React, { useState, useEffect } from "react";
import DeckGL from "@deck.gl/react";
import { BitmapLayer, GeoJsonLayer } from "@deck.gl/layers";
import { TileLayer } from "@deck.gl/geo-layers";
import { Map } from "react-map-gl";
import { EditableGeoJsonLayer, TranslateMode, DrawPolygonMode, ModifyMode, ViewMode, SelectionLayer } from "nebula.gl";
import { useDataState, useDataSetters, TILE_URL_TEMPLATE } from "../../../DataContext";
import { ModeSwitcher } from "../../Util/MapModeSwitcher";
import { MapOrthoSwitcher } from "../../Util/MapOrthoSwitcher";

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
    const {
        viewState,
        selectedTilePath,
        flaskUrl,
        selectedLocationGCP,
        selectedPopulationGCP,
        prepOrthoImagePath,
        cursorStyle,
        featureCollectionPop,
        featureCollectionPlot,
    } = useDataState();
    const { setViewState, setCursorStyle, setFeatureCollectionPop, setFeatureCollectionPlot } = useDataSetters();

    const [featureCollection, setFeatureCollection] =
        task === "pop_boundary"
            ? [featureCollectionPop, setFeatureCollectionPop]
            : [featureCollectionPlot, setFeatureCollectionPlot];

    const [prepOrthoTileLayer, setPrepOrthoTileLayer] = useState(null);

    useEffect(() => {
        console.log("prepOrthoImagePath", prepOrthoImagePath);

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
                const response = await fetch(
                    `${flaskUrl}load_geojson?selectedLocationGcp=${selectedLocationGcp}&selectedPopulationGcp=${selectedPopulationGcp}&filename=${filename}`
                );
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
        onHover: ({ object, index }) => {
            if (mode === translateMode && object && selectedFeatureIndexes.length < 2) {
                // When hovering over a feature in translate mode, select it
                setSelectedFeatureIndexes([index]);
            }
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
        <div style={{ height: "85vh", width: "100vw", position: "relative" }}>
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
        </div>
    );
}

export default BoundaryMap;
