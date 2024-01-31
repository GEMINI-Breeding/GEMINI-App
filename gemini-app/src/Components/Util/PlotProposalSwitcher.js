import React, { useState } from "react";
import { Box, Button, Slider, TextField, Typography } from "@mui/material";
import DashboardCustomizeIcon from "@mui/icons-material/DashboardCustomize";
import VisibilityIcon from "@mui/icons-material/Visibility"; // Use for minimize icon
import { useDataState, useDataSetters } from "../../DataContext";
import { centerOfMass, booleanContains, bboxPolygon, transformRotate, featureCollection } from "@turf/turf";

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
            const x = centerX - totalWidthInDegrees / 2 + j * (widthInDegrees + horizontalSpacingInDegrees);
            const y = centerY - totalHeightInDegrees / 2 + i * (lengthInDegrees + verticalSpacingInDegrees);

            // Create rectangle (unrotated for now)
            let rectangle = bboxPolygon([x, y, x + widthInDegrees, y + lengthInDegrees]);

            // Rotate the rectangle if an angle is specified
            if (angle !== 0) {
                rectangle = transformRotate(rectangle, angle, { pivot: [centerX, centerY] });
            }

            // Check if the rectangle is fully within the main polygon
            if (booleanContains(mainPolygon, rectangle)) {
                // Add the valid rectangle to the array
                validRectangles.push(rectangle);
            }
        }
    }

    // Combine valid rectangles into a single FeatureCollection
    return featureCollection(validRectangles);
}

function PlotProposalSwitcher() {
    const toggleMinimize = () => setIsMinimized(!isMinimized); // Toggle function for minimizing/maximizing
    const [isMinimized, setIsMinimized] = useState(true); // Manage minimized/maximized state

    const { featureCollectionPop, featureCollectionPlot, polygonProposalOptions } = useDataState();
    const { setFeatureCollectionPlot, setPolygonProposalOptions } = useDataSetters();

    const [options, setOptions] = useState(polygonProposalOptions);

    const handleChange = (event) => {
        setOptions({ ...options, [event.target.name]: event.target.value });
    };

    const handleSliderChange = (name) => (event, newValue) => {
        const updatedOptions = { ...options, [name]: newValue };
        setOptions(updatedOptions);
        applyUpdatedOptions(updatedOptions);
    };

    const applyUpdatedOptions = (updatedOptions) => {
        const mainPolygon = featureCollectionPop.features[0];
        const newRectangles = fillPolygonWithRectangles(mainPolygon, updatedOptions);
        setFeatureCollectionPlot(newRectangles);
    };

    const applyOptions = () => {
        applyUpdatedOptions(options);
    };

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
