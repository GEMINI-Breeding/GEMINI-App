import React from "react";
import { drawPolygonMode, modifyMode, translateMode, viewMode } from "../GCP/TabComponents/PlotBoundaryMap";

export const ModeSwitcher = ({ currentMode, setMode }) => {
    const modes = [
        {
            mode: drawPolygonMode,
            label: "Draw Polygon",
            info: "Click to start drawing a polygon. Double click to finish.",
        },
        { mode: modifyMode, label: "Edit", info: "Click on a polygon to select and modify its vertices." },
        { mode: translateMode, label: "Translate", info: "Click and drag to move a polygon." },
        { mode: viewMode, label: "View", info: "Navigate around the map." },
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
        </div>
    );
};
