//import React, { useEffect } from "react";

export function geojsonToCSV(geojson) {
    // Check if the GeoJSON has features
    if (!geojson || !geojson.features || !geojson.features.length) {
        return "";
    }

    // Extract header (property names)
    const headers = Object.keys(geojson.features[0].properties);
    let csvString = headers.join(",") + "\n"; // Create the header row

    // Iterate over features to extract properties and create rows
    geojson.features.forEach((feature) => {
        const row = headers
            .map((header) => {
                // Ensure value is present, else empty string
                return feature.properties[header] ? `${feature.properties[header]}` : "";
            })
            .join(",");
        csvString += row + "\n";
    });

    return csvString;
}

export function downloadCSV(csvString, filename = "data.csv") {
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
