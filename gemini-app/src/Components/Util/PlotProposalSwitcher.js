import React, { useState, useEffect, useCallback } from "react";
import { Box, Button, Slider, TextField, Typography } from "@mui/material";
import DashboardCustomizeIcon from "@mui/icons-material/DashboardCustomize";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useDataState, useDataSetters } from "../../DataContext";
import { centerOfMass, booleanContains, bboxPolygon, transformRotate, featureCollection } from "@turf/turf";

function parseCsv(csvText) {
    const lines = csvText.trim().split("\n");
    const headers = lines[0].split(",");
    return lines.slice(1).map((line) => {
        const values = line.split(",");
        return headers.reduce((obj, header, index) => {
            obj[header] = values[index];
            return obj;
        }, {});
    });
}

function getAndParseFieldDesign(
    flaskUrl,
    selectedYearGCP,
    selectedExperimentGCP,
    selectedLocationGCP,
    selectedPopulationGCP
) {
    const filePath = `${flaskUrl}files/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/FieldDesign.csv`;
    return fetch(filePath)
        .then((response) => response.text())
        .then((text) => parseCsv(text))
        .catch((error) => {
            console.error("Error fetching or parsing field design:", error);
            throw error; // Rethrow to handle it further up if necessary
        });
}

function mergeCsvDataWithGeoJson(featureCollection, csvData) {
    const csvKeys = Object.keys(csvData[0]);

    featureCollection.features.forEach((feature) => {
        const { row, column } = feature.properties;

        const csvRow = csvData.find((data) => data.row == row && data.col == column);

        if (csvRow) {
            // Assuming the data from the CSV might need transformation if keys differ
            // Adjust as necessary based on actual CSV and GeoJSON structure
            for (const key in csvRow) {
                if (key !== "row" && key !== "col") {
                    feature.properties[key] = csvRow[key];
                }
            }
        } else {
            for (const key of csvKeys) {
                if (key !== "row" && key !== "col") {
                    feature.properties[key] = null;
                } else if (key === "row") {
                    feature.properties[key] = row;
                } else if (key === "col") {
                    feature.properties[key] = column;
                }
            }
        }
    });
}

function fillPolygonWithRectangles(mainPolygon, options) {
    // Options
    const { width, length, rows, columns, verticalSpacing, horizontalSpacing, angle } = options;

    // Calculate the center of the main polygon
    const center = centerOfMass(mainPolygon);
    const [centerX, centerY] = center.geometry.coordinates;

    // Calculate scale factor (degrees per meter) at the latitude of the center
    const scaleFactor = 1 / (111320 * Math.cos((centerY * Math.PI) / 180));

    // Convert dimensions and spacings from meters to degrees
    const widthInDegrees = width * scaleFactor;
    const lengthInDegrees = length * scaleFactor;
    const verticalSpacingInDegrees = verticalSpacing * scaleFactor;
    const horizontalSpacingInDegrees = horizontalSpacing * scaleFactor;

    // Calculate the total width and height in degrees
    const totalWidthInDegrees = columns * (widthInDegrees + horizontalSpacingInDegrees) - horizontalSpacingInDegrees;
    const totalHeightInDegrees = rows * (lengthInDegrees + verticalSpacingInDegrees) - verticalSpacingInDegrees;

    // Initialize an array to hold all valid rectangles
    let validRectangles = [];

    // Generate rectangles
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < columns; j++) {
            // Calculate the position of each rectangle in degrees
            // const x = centerX - totalWidthInDegrees / 2 + j * (widthInDegrees + horizontalSpacingInDegrees);
            // const y = centerY - totalHeightInDegrees / 2 + i * (lengthInDegrees + verticalSpacingInDegrees);

            // Adjusted calculation for `x` to start from the left and shift right by one rectangle's width
            const x = centerX - totalWidthInDegrees / 2 + j * (widthInDegrees + horizontalSpacingInDegrees);
            const y =
                centerY + totalHeightInDegrees / 2 - i * (lengthInDegrees + verticalSpacingInDegrees) - lengthInDegrees;

            // Create rectangle (unrotated for now)
            let rectangle = bboxPolygon([x, y, x + widthInDegrees, y + lengthInDegrees]);

            // Add row and column information as properties
            rectangle.properties = {
                row: i + 1, // Adding 1 to start the count from 1 instead of 0
                column: j + 1, // Same as above
            };

            // Rotate the rectangle if an angle is specified
            if (angle !== 0) {
                rectangle = transformRotate(rectangle, angle, { pivot: [centerX, centerY] });
            }

            // Check if the rectangle is fully within the main polygon
            //if (booleanContains(mainPolygon, rectangle)) {
            // Add the valid rectangle to the array
            validRectangles.push(rectangle);
            //}
        }
    }

    // Combine valid rectangles into a single FeatureCollection
    return featureCollection(validRectangles);
}

function PlotProposalSwitcher() {
    const [isMinimized, setIsMinimized] = useState(true);
    const {
        featureCollectionPop,
        featureCollectionPlot,
        polygonProposalOptions,
        flaskUrl,
        selectedYearGCP,
        selectedExperimentGCP,
        selectedLocationGCP,
        selectedPopulationGCP,
    } = useDataState();
    const { setFeatureCollectionPlot } = useDataSetters();
    const [options, setOptions] = useState(polygonProposalOptions);
    const [fieldDesign, setFieldDesign] = useState(null);

    useEffect(() => {
        getAndParseFieldDesign(
            flaskUrl,
            selectedYearGCP,
            selectedExperimentGCP,
            selectedLocationGCP,
            selectedPopulationGCP
        ).then((data) => {
            setFieldDesign(data);
        });
    }, [flaskUrl, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP]);

    const applyUpdatedOptions = useCallback(
        (updatedOptions) => {
            const mainPolygon = featureCollectionPop.features[0];
            const newRectangles = fillPolygonWithRectangles(mainPolygon, updatedOptions);
            console.log("Filling polygon with rectangles...")
            if (fieldDesign) {
                mergeCsvDataWithGeoJson(newRectangles, fieldDesign);
            }
            setFeatureCollectionPlot(newRectangles);
        },
        [fieldDesign, featureCollectionPop.features, setFeatureCollectionPlot]
    );

    const handleChange = (event) => {
        setOptions({ ...options, [event.target.name]: event.target.value });
    };

    const handleSliderChange = (name) => (event, newValue) => {
        const updatedOptions = { ...options, [name]: newValue };
        setOptions(updatedOptions);
        applyUpdatedOptions(updatedOptions);
    };

    const applyOptions = () => {
        applyUpdatedOptions(options);
        console.log("Feature Collection Plot", featureCollectionPlot);
    };

    const toggleMinimize = () => setIsMinimized(!isMinimized);

    return (
        <div
            style={
                isMinimized
                    ? {
                          position: "absolute",
                          bottom: 10,
                          left: 10, // Adjust positioning as needed
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
                          bottom: 10,
                          left: 10, // Adjust positioning as needed
                          zIndex: 1,
                          backgroundColor: "rgba(255, 255, 255, 0.7)",
                          borderRadius: "8px",
                          padding: "20px",
                          display: "flex",
                          flexDirection: "column",
                          width: "300px", // Adjust width as needed for your content
                      }
            }
        >
            {isMinimized ? (
                <Button onClick={toggleMinimize} style={{ padding: 0, minWidth: "auto" }}>
                    <DashboardCustomizeIcon fontSize="large" />
                </Button>
            ) : (
                <>
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
                    <Box sx={{ margin: 0 }}>
                        <Typography variant="h6">Rectangle Options</Typography>
                        <TextField
                            label="Width (m)"
                            name="width"
                            value={options.width}
                            onChange={handleChange}
                            type="number"
                            sx={{ my: 0.5 }}
                        />
                        <TextField
                            label="Length (m)"
                            name="length"
                            value={options.length}
                            onChange={handleChange}
                            type="number"
                            sx={{ my: 0.5 }}
                        />
                        <TextField
                            label="Rows"
                            name="rows"
                            value={options.rows}
                            onChange={handleChange}
                            type="number"
                            sx={{ my: 0.5 }}
                        />
                        <TextField
                            label="Columns"
                            name="columns"
                            value={options.columns}
                            onChange={handleChange}
                            type="number"
                            sx={{ my: 0.5 }}
                        />
                        <TextField
                            label="Vertical Spacing (m)"
                            name="verticalSpacing"
                            value={options.verticalSpacing}
                            onChange={handleChange}
                            type="number"
                            sx={{ my: 0.5 }}
                        />
                        <TextField
                            label="Horizontal Spacing (m)"
                            name="horizontalSpacing"
                            value={options.horizontalSpacing}
                            onChange={handleChange}
                            type="number"
                            sx={{ my: 0.5 }}
                        />
                        <TextField
                            label="Angle (deg)"
                            name="angle"
                            value={options.angle}
                            onChange={handleChange}
                            type="number"
                            inputProps={{ step: 0.1, min: 0, max: 90 }}
                            sx={{ my: 0.5 }}
                        />
                        <Typography align="center">Angle Slider</Typography>
                        <Slider
                            value={typeof options.angle === "number" ? options.angle : 0}
                            onChange={handleSliderChange("angle")}
                            step={0.1}
                            min={0}
                            max={90}
                            sx={{ my: 0.5 }}
                        />

                        <Button variant="contained" color="primary" onClick={applyOptions}>
                            Apply
                        </Button>
                    </Box>
                </>
            )}
        </div>
    );
}

export default PlotProposalSwitcher;
