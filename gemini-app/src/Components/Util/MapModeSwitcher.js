import React, { useState, useEffect } from "react";
import { drawPolygonMode, modifyMode, translateMode, viewMode, selectionMode } from "../GCP/TabComponents/BoundaryMap";
import { useDataState, useDataSetters } from "../../DataContext";
import { Button } from "@mui/material";
import { save } from "@loaders.gl/core";

export const ModeSwitcher = ({ currentMode, setMode, task }) => {
    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        flaskUrl,
        activeStepBoundaryPrep,
        featureCollectionPop,
        featureCollectionPlot,
    } = useDataState();
    const { setActiveStepBoundaryPrep, setSelectedTabPrep, setFeatureCollectionPop, setFeatureCollectionPlot } =
        useDataSetters();

    const [buttonText, setButtonText] = useState("Save Boundaries");
    const [proceedButtonText, setProceedButtonText] = useState("Proceed");

    useEffect(() => {
        console.log("task", task);
        console.log("featureCollectionPop", featureCollectionPop);
        console.log("featureCollectionPlot", featureCollectionPlot);
    }, [featureCollectionPop, featureCollectionPlot]);

    const saveFeatureCollection = async (fcIn) => {
        let filename;
        let payload;
        let fc = fcIn;

        if (task === "pop_boundary") {
            filename = "Pop-Boundary-WGS84.geojson";
            if (fc == null) {
                fc = featureCollectionPop;
            }
        } else if (task === "plot_boundary") {
            filename = "Plot-Boundary-WGS84.geojson";
            if (fc == null) {
                fc = featureCollectionPlot;
            }
        } else {
            filename = "WGS84.geojson";
        }

        payload = {
            selectedLocationGcp: selectedLocationGCP,
            selectedPopulationGcp: selectedPopulationGCP,
            geojsonData: fc,
            filename: filename,
        };

        const response = await fetch(`${flaskUrl}save_geojson`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        console.log(data);

        if (response.ok) {
            setButtonText("Saved!");
            setTimeout(() => setButtonText("Save Boundaries"), 1500);
            return 0;
        } else {
            setButtonText("Save Failed");
            setTimeout(() => setButtonText("Save Boundaries"), 1500);
            return 1;
        }
    };

    const handleNextStep = () => {
        console.log("task", task);
        if (task === "pop_boundary") {
            if (featureCollectionPop.features.length > 0) {
                saveFeatureCollection(featureCollectionPop) && setActiveStepBoundaryPrep(activeStepBoundaryPrep + 1);
            } else {
                setProceedButtonText("No Boundaries");
                setTimeout(() => setProceedButtonText("Proceed"), 1500);
            }
        } else {
            if (featureCollectionPlot.features.length > 0) {
                saveFeatureCollection(featureCollectionPlot) && setSelectedTabPrep(1);
            }
        }
    };

    const modes = [
        { mode: viewMode, label: "View", info: "Navigate around the map." },
        {
            mode: drawPolygonMode,
            label: "Draw Polygon",
            info: "Click to start drawing a polygon. Double click to finish.",
        },
        { mode: modifyMode, label: "Edit", info: "Click on a polygon to select and modify its vertices." },
        { mode: translateMode, label: "Translate", info: "Click and drag to move a polygon." },
        { mode: selectionMode, label: "Select", info: "Click and drag to select multiple polygons." },
    ];

    const handleChange = (mode) => {
        setMode(mode);
    };

    return (
        <div
            style={{
                position: "absolute",
                top: 10,
                right: 10,
                zIndex: 1,
                backgroundColor: "rgba(255, 255, 255, 0.7)",
                borderRadius: "8px",
                padding: "10px",
                display: "flex",
                flexDirection: "column",
                width: "180px",
            }}
        >
            {modes.map(({ mode, label, info }) => (
                <label
                    key={label}
                    style={{ marginBottom: "5px" }}
                    title={info} // Tooltip on mouseover of the label
                >
                    <input
                        type="radio"
                        name="mode"
                        value={label}
                        checked={currentMode === mode}
                        onChange={() => handleChange(mode)}
                        style={{ marginRight: "5px" }}
                    />
                    {label}
                </label>
            ))}

            <div style={{ marginBottom: "5px", marginTop: "5px" }}>
                <Button fullWidth variant="contained" color="primary" onClick={() => saveFeatureCollection()}>
                    {buttonText}
                </Button>
            </div>
            <div style={{ marginBottom: "5px", marginTop: "5px" }}>
                <Button fullWidth variant="contained" color="primary" onClick={() => handleNextStep()}>
                    {proceedButtonText}
                </Button>
            </div>
        </div>
    );
};
