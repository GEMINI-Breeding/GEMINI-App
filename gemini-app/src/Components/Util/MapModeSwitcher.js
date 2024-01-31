import React, { useState, useEffect } from "react";
import { drawPolygonMode, modifyMode, translateMode, viewMode, selectionMode } from "../GCP/TabComponents/BoundaryMap";
import { useDataState, useDataSetters } from "../../DataContext";
import { Button } from "@mui/material";
import { save } from "@loaders.gl/core";
import SettingsIcon from "@mui/icons-material/Settings";
import VisibilityIcon from "@mui/icons-material/Visibility";

export const ModeSwitcher = ({ currentMode, setMode, task, featureCollection, setSelectedFeatureIndexes }) => {
    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedYearGCP,
        selectedExperimentGCP,
        flaskUrl,
        activeStepBoundaryPrep,
        featureCollectionPop,
        featureCollectionPlot,
    } = useDataState();
    const { setActiveStepBoundaryPrep, setSelectedTabPrep, setFeatureCollectionPop, setFeatureCollectionPlot } =
        useDataSetters();

    const [buttonText, setButtonText] = useState("Save");
    const [proceedButtonText, setProceedButtonText] = useState("Proceed");
    // State to track if the component is minimized
    const [isMinimized, setIsMinimized] = useState(false);

    // Toggle function
    const toggleMinimize = () => setIsMinimized(!isMinimized);

    useEffect(() => {
        console.log("task", task);
        console.log("featureCollectionPop", featureCollectionPop);
        console.log("featureCollectionPlot", featureCollectionPlot);
    }, [featureCollectionPop, featureCollectionPlot]);

    const selectAllFeatures = () => {
        const allFeatureIndexes = featureCollection.features.map((_, index) => index);
        setSelectedFeatureIndexes(allFeatureIndexes);
    };

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
            selectedYearGcp: selectedYearGCP,
            selectedExperimentGcp: selectedExperimentGCP,
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
            setTimeout(() => setButtonText("Save"), 1500);
            return 0;
        } else {
            setButtonText("Save Failed");
            setTimeout(() => setButtonText("Save"), 1500);
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
            label: "Draw",
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
            style={
                isMinimized
                    ? {
                          position: "absolute",
                          top: 10,
                          right: 10,
                          zIndex: 1,
                          backgroundColor: "rgba(255, 255, 255, 0.2)",
                          borderRadius: "8px",
                          padding: "10px",
                          width: "40px",
                          height: "40px",
                          display: "flex",
                          justifyContent: "center",
                          alignItems: "center",
                      }
                    : {
                          position: "absolute",
                          top: 10,
                          right: 10,
                          zIndex: 1,
                          backgroundColor: "rgba(255, 255, 255, 0.7)",
                          borderRadius: "8px",
                          padding: "10px",
                          display: "flex",
                          flexDirection: "column",
                          width: "100px",
                      }
            }
        >
            {isMinimized ? (
                <Button onClick={() => toggleMinimize()} style={{ marginBottom: "5px" }}>
                    <SettingsIcon name="maximize" fontSize="large" />
                </Button>
            ) : (
                <>
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

                    {task === "plot_boundary" && (
                        <div style={{ marginBottom: "5px", marginTop: "5px" }}>
                            <Button fullWidth variant="contained" color="primary" onClick={() => selectAllFeatures()}>
                                Select All
                            </Button>
                        </div>
                    )}

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
                    <Button
                        onClick={toggleMinimize}
                        style={{
                            position: "absolute", // Absolute position for the button
                            top: -8, // Top right corner
                            right: -10,
                            zIndex: 1000, // High z-index to float above other elements
                            backgroundColor: "transparent", // Set default background
                            "&:hover": {
                                backgroundColor: "transparent", // Keep background transparent on hover
                            },
                        }}
                    >
                        <VisibilityIcon name="minimize" />
                    </Button>
                </>
            )}
        </div>
    );
};
