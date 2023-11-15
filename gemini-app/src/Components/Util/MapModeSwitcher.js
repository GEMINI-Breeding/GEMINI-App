import React, { useState } from "react";
import { drawPolygonMode, modifyMode, translateMode, viewMode } from "../GCP/TabComponents/PopBoundaryMap";
import { useDataState } from "../../DataContext";
import { Button } from "@mui/material";

export const ModeSwitcher = ({ currentMode, setMode, fc, task }) => {
    const { selectedLocationGCP, selectedPopulationGCP, flaskUrl } = useDataState();

    const [buttonText, setButtonText] = useState("Save Boundaries");

    const saveFeatureCollection = async () => {
        let filename;
        if (task === "pop_boundary") {
            filename = "Pop-Boundary-WGS84.geojson";
        } else if (task === "plot_boundary") {
            filename = "Plot-Boundary-WGS84.geojson";
        } else {
            filename = "WGS84.geojson";
        }

        const payload = {
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
        } else {
            setButtonText("Save Failed");
            setTimeout(() => setButtonText("Save Boundaries"), 1500);
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
            <br />
            <Button variant="contained" color="primary" onClick={() => saveFeatureCollection()}>
                {buttonText}
            </Button>
        </div>
    );
};
