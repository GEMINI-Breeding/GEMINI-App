import React, { useState, useEffect } from "react";
import DeckGL from "@deck.gl/react";
import { Map } from "react-map-gl";
import { EditableGeoJsonLayer, TranslateMode, DrawPolygonMode, ModifyMode, ViewMode, SelectionLayer } from "nebula.gl";
import { useDataState } from "../../../DataContext";

const fc = {
    type: "FeatureCollection",
    features: [],
};

const drawPolygonMode = new DrawPolygonMode();
const modifyMode = new ModifyMode();
const translateMode = new TranslateMode();
const viewMode = new ViewMode();

const ModeSwitcher = ({ setMode }) => {
    return (
        <div style={{ position: "absolute", top: 10, left: 10, zIndex: 1 }}>
            <button onClick={() => setMode(drawPolygonMode)}>Draw Polygon</button>
            <button onClick={() => setMode(modifyMode)}>Edit</button>
            <button onClick={() => setMode(translateMode)}>Translate</button>
            <button onClick={() => setMode(viewMode)}>View</button>
        </div>
    );
};

function PlotBoundaryMap() {
    const { viewState } = useDataState();
    const [featureCollection, setFeatureCollection] = useState(fc);
    const [selectedFeatureIndexes, setSelectedFeatureIndexes] = useState([]);
    const [mode, setMode] = useState(viewMode);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.key === "Backspace" || e.key === "Delete") && selectedFeatureIndexes.length) {
                if (mode === translateMode) {
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
        data: featureCollection,
        mode: mode,
        selectedFeatureIndexes: selectedFeatureIndexes,
        onEdit: ({ updatedData, editType, featureIndexes }) => {
            if (editType === "addFeature") {
                setSelectedFeatureIndexes(featureIndexes);
            }
            setFeatureCollection(updatedData);
        },
        onClick: ({ index }) => {
            if (index !== -1) {
                // If a feature is clicked, select it
                setSelectedFeatureIndexes([index]);
            }
        },
        onHover: ({ object, index }) => {
            if (mode === translateMode && object) {
                // When hovering over a feature in translate mode, select it
                setSelectedFeatureIndexes([index]);
            }
        },
    });

    const controller = {
        doubleClickZoom: !(mode === drawPolygonMode || mode === modifyMode),
    };

    return (
        <div style={{ height: "70vh", width: "70vw", position: "relative" }}>
            <DeckGL initialViewState={viewState} controller={controller} layers={[layer]}>
                <Map
                    mapStyle="mapbox://styles/mapbox/satellite-v9"
                    mapboxAccessToken="pk.eyJ1IjoibWFzb25lYXJsZXMiLCJhIjoiY2xkeXR3bXNyMG5heDNucHJhYWFscnZnbyJ9.A03O6PN1N1u771c4Qqg1SA"
                />
            </DeckGL>
            <ModeSwitcher setMode={setMode} />
        </div>
    );
}

export default PlotBoundaryMap;
