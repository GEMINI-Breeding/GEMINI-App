import React from "react";

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const GeoJsonTooltip = ({ hoverInfo, selectedMetric }) => {
    // Helper function to render metrics
    const renderMetrics = () => {
        if (Array.isArray(selectedMetric)) {
            console.log(hoverInfo.object);
            return selectedMetric.map((metric, index) => (
                <div key={index} style={{ marginBottom: "5px" }}>
                    {" "}
                    {/* Use div instead of span */}
                    <b>{capitalizeFirstLetter(metric)}:</b>{" "}
                    {hoverInfo.object.properties[metric] !== null ? hoverInfo.object.properties[metric] : "No Data"}
                    {"\n"}
                </div> // Each metric will now appear on a new line
            ));
        } else {
            return (
                <span style={{ marginRight: "5px" }}>
                    <b>{selectedMetric}:</b>{" "}
                    {hoverInfo.object.properties[selectedMetric] !== null
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
                    left: hoverInfo.x,
                    top: hoverInfo.y,
                    backgroundColor: "rgba(255, 255, 255, 0.8)",
                    padding: "10px",
                    borderRadius: "5px",
                    border: "1px solid #ccc",
                    color: "#333",
                    fontFamily: "Arial, sans-serif",
                    lineHeight: "1.6",
                    width: "100px",
                }}
            >
                <div
                    style={{ marginBottom: "5px", display: "flex", flexWrap: "wrap", justifyContent: "space-between" }}
                >
                    {renderMetrics()}
                </div>
                {Array.isArray(selectedMetric) ? null : (
                    <hr style={{ borderTop: "1px solid #aaa", marginBottom: "5px" }} />
                )}
            </div>
        )
    );
};

export default GeoJsonTooltip;
