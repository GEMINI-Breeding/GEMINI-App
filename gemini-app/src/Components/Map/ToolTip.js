import React from "react";

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const GeoJsonTooltip = ({ hoverInfo, selectedMetric }) => {
    // Helper function to render metrics
    const renderMetrics = () => {
        if (Array.isArray(selectedMetric)) {
            console.log("Here");
            console.log(hoverInfo.object.properties);
            console.log("Here after");
            return selectedMetric.map((metric, index) => (
                <div key={index} style={{ marginBottom: "5px" }}>
                    {" "}
                    {/* Use div instead of span */}
                    <b>{capitalizeFirstLetter(metric)}:</b>{" "}
                    {(hoverInfo.object.properties[metric] !== null && hoverInfo.object.properties[metric] !== undefined) ? hoverInfo.object.properties[metric] : "No Data"}
                    {"\n"}
                </div> // Each metric will now appear on a new line
            ));
        } else {
            return (
                <span style={{ marginRight: "5px" }}>
                    <b>{selectedMetric}:</b>{" "}
                    {(hoverInfo.object.properties[selectedMetric] !== null && hoverInfo.object.properties[selectedMetric] !== undefined)
                        ? hoverInfo.object.properties[selectedMetric].toFixed(2)
                        : "No Data"}
                </span>
            );
        }
    };

    return (
        hoverInfo &&
        hoverInfo.object && (
            <div
                style={{
                    position: "absolute",
                    zIndex: 1,
                    pointerEvents: "none",
                    left: hoverInfo.x + 10,
                    top: hoverInfo.y + 10,
                    backgroundColor: "rgba(255, 255, 255, 0.9)",
                    padding: "10px",
                    borderRadius: "5px",
                    border: "1px solid #ccc",
                    color: "#333",
                    fontFamily: "Arial, sans-serif",
                    lineHeight: "1.6",
                    minWidth: "150px",
                    maxWidth: "300px",
                    overflow: "hidden"
                }}
                >
                <div
                    style={{ marginBottom: "5px", display: "flex", flexWrap: "wrap", justifyContent: "space-between" }}
                >
                    {renderMetrics()}
                </div>
                <div style={{ marginBottom: "5px" }}>
                    <b>Plot:</b> {hoverInfo.object.properties.plot !== null && hoverInfo.object.properties.plot !== undefined
                        ? hoverInfo.object.properties.plot
                        : "No Data"}
                </div>
                <div style={{ marginBottom: "5px" }}>
                    <b>Accession:</b> {hoverInfo.object.properties.accession !== null && hoverInfo.object.properties.accession !== undefined
                        ? hoverInfo.object.properties.accession
                        : "No Data"}
                </div>
                {Array.isArray(selectedMetric) ? null : (
                    <hr style={{ borderTop: "1px solid #aaa", marginBottom: "5px" }} />
                )}
            </div>
        )
    );
};

export default GeoJsonTooltip;
