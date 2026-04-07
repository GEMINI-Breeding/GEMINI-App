import React, { useState, useEffect, useCallback, useRef } from "react";
import { 
    Box, 
    Button, 
    Slider, 
    TextField, 
    Typography, 
    FormGroup, 
    FormControlLabel, 
    Checkbox, 
    FormControl, 
    InputLabel, 
    Select, 
    MenuItem 
} from "@mui/material";
import DashboardCustomizeIcon from "@mui/icons-material/DashboardCustomize";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useDataState, useDataSetters } from "../../DataContext";
import { listDirs, getFileUrl } from '../../api/files';
import { centerOfMass, bbox as turfBbox, bboxPolygon, transformRotate, featureCollection } from "@turf/turf";

export function parseCsv(csvText) {
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
    selectedYearGCP,
    selectedExperimentGCP,
    selectedLocationGCP,
    selectedPopulationGCP
) {
    const filePath = getFileUrl(`Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/FieldDesign.csv`);
    return fetch(filePath)
        .then((response) => response.text())
        .then((text) => parseCsv(text))
        .catch((error) => {
            console.error("Error fetching or parsing field design:", error);
            throw error; // Rethrow to handle it further up if necessary
        });
}

// Merge CSV data with GeoJSON data correctly and ensure field design is updated.
export function mergeCsvDataWithGeoJson(featureCollection, csvData) {
    if (!csvData || csvData.length === 0) return;

    featureCollection.features.forEach((feature) => {
        const { row, column } = feature.properties;
        const csvRow = csvData.find((data) => data.row == row && data.col == column);

        if (csvRow) {
            // Merge CSV data into the feature's properties
            for (const key in csvRow) {
                if (key !== "row" && key !== "col") {
                    feature.properties[key] = csvRow[key];
                }
            }
        } else {
            // Default values for unmatched features
            feature.properties = {
                ...feature.properties,
                row,
                column,
                plot: `${row}_${column}`,
                Plot: `${row}_${column}`,
            };
        }
    });
}

/**
 * Validate that a grid of plots with the given spacing fits within the boundary.
 * Returns { valid: true, plotWidth, plotLength } or { valid: false, error: string }.
 *
 * @param {Feature} mainPolygon - Population boundary polygon
 * @param {object} options - { rows, columns, verticalSpacing, horizontalSpacing }
 * @returns {object} validation result
 */
export function validateAndCalcPlotDimensions(mainPolygon, options) {
    const { rows, columns, verticalSpacing, horizontalSpacing } = options;

    if (!rows || rows < 1) return { valid: false, error: "Rows must be at least 1." };
    if (!columns || columns < 1) return { valid: false, error: "Columns must be at least 1." };
    if (verticalSpacing < 0) return { valid: false, error: "Vertical spacing cannot be negative." };
    if (horizontalSpacing < 0) return { valid: false, error: "Horizontal spacing cannot be negative." };

    const [minX, minY, maxX, maxY] = turfBbox(mainPolygon);
    const center = centerOfMass(mainPolygon);
    const [, centerY] = center.geometry.coordinates;

    // Convert boundary size from degrees to meters
    const metersPerDegreeLon = 111320 * Math.cos((centerY * Math.PI) / 180);
    const metersPerDegreeLat = 111320;

    const boundaryWidthM = (maxX - minX) * metersPerDegreeLon;
    const boundaryHeightM = (maxY - minY) * metersPerDegreeLat;

    // Available space after subtracting all spacing gaps
    const totalHSpacing = (columns - 1) * horizontalSpacing;
    const totalVSpacing = (rows - 1) * verticalSpacing;

    const availableWidth = boundaryWidthM - totalHSpacing;
    const availableHeight = boundaryHeightM - totalVSpacing;

    if (availableWidth <= 0) {
        return { valid: false, error: `Horizontal spacing (${totalHSpacing.toFixed(1)}m total) exceeds boundary width (${boundaryWidthM.toFixed(1)}m). Reduce spacing or columns.` };
    }
    if (availableHeight <= 0) {
        return { valid: false, error: `Vertical spacing (${totalVSpacing.toFixed(1)}m total) exceeds boundary height (${boundaryHeightM.toFixed(1)}m). Reduce spacing or rows.` };
    }

    const plotWidth = availableWidth / columns;
    const plotLength = availableHeight / rows;

    if (plotWidth < 0.1) {
        return { valid: false, error: `Calculated plot width (${plotWidth.toFixed(2)}m) is too small. Reduce columns or spacing.` };
    }
    if (plotLength < 0.1) {
        return { valid: false, error: `Calculated plot length (${plotLength.toFixed(2)}m) is too small. Reduce rows or spacing.` };
    }

    return { valid: true, plotWidth, plotLength, boundaryWidthM, boundaryHeightM };
}

export function fillPolygonWithRectangles(mainPolygon, options) {
    const { rows, columns, verticalSpacing, horizontalSpacing, angle } = options;

    // Auto-calculate plot width/length from boundary
    const validation = validateAndCalcPlotDimensions(mainPolygon, options);
    if (!validation.valid) {
        throw new Error(validation.error);
    }
    const { plotWidth, plotLength } = validation;

    // Calculate the center of the main polygon
    const [minX, minY, , ] = turfBbox(mainPolygon);
    const center = centerOfMass(mainPolygon);
    const [centerX, centerY] = center.geometry.coordinates;

    // Calculate scale factor (degrees per meter) at the latitude of the center
    const scaleFactor = 1 / (111320 * Math.cos((centerY * Math.PI) / 180));
    const scaleFactorLat = 1 / 111320;

    // Convert dimensions and spacings from meters to degrees
    const widthInDegrees = plotWidth * scaleFactor;
    const lengthInDegrees = plotLength * scaleFactorLat;
    const verticalSpacingInDegrees = verticalSpacing * scaleFactorLat;
    const horizontalSpacingInDegrees = horizontalSpacing * scaleFactor;

    // Start from the boundary's min corner so plots fill the boundary exactly
    let validRectangles = [];

    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < columns; j++) {
            const x = minX + j * (widthInDegrees + horizontalSpacingInDegrees);
            const y = minY + (rows - 1 - i) * (lengthInDegrees + verticalSpacingInDegrees);

            let rectangle = bboxPolygon([x, y, x + widthInDegrees, y + lengthInDegrees]);

            rectangle.properties = {
                row: i + 1,
                column: j + 1,
            };

            if (angle !== 0) {
                rectangle = transformRotate(rectangle, angle, { pivot: [centerX, centerY] });
            }

            validRectangles.push(rectangle);
        }
    }

    return featureCollection(validRectangles);
}

function PlotProposalSwitcher() {
    const [isMinimized, setIsMinimized] = useState(true);
    const {
        featureCollectionPop,
        featureCollectionPlot,
        polygonProposalOptions,
        selectedYearGCP,
        selectedExperimentGCP,
        selectedLocationGCP,
        selectedPopulationGCP,
    } = useDataState();
    const { setFeatureCollectionPlot } = useDataSetters();
    const [options, setOptions] = useState(polygonProposalOptions);
    const [hasAutoApplied, setHasAutoApplied] = useState(false);

    // Sync local options when polygonProposalOptions changes (e.g., from ImportSettingsModal)
    useEffect(() => {
        setOptions(polygonProposalOptions);
        setHasAutoApplied(false);
    }, [polygonProposalOptions]);

    const [fieldDesign, setFieldDesign] = useState(null);
    const [agrowstitchAvailable, setAgrowstitchAvailable] = useState(false);
    
    // Undo system
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);

    // Add current state to history
    const addToHistory = useCallback((newFeatureCollection, newOptions) => {
        const newHistoryItem = {
            featureCollection: JSON.parse(JSON.stringify(newFeatureCollection)),
            options: { ...newOptions },
            timestamp: Date.now()
        };
        
        setHistory(prev => {
            // Remove any history after current index (when we're not at the end)
            const newHistory = prev.slice(0, historyIndex + 1);
            newHistory.push(newHistoryItem);
            
            // Keep only last 20 items to prevent memory issues
            if (newHistory.length > 20) {
                return newHistory.slice(-20);
            }
            return newHistory;
        });
        
        setHistoryIndex(prev => {
            const newIndex = Math.min(prev + 1, 19); // Cap at 19 (0-indexed)
            return newIndex;
        });
    }, [historyIndex]);

    // Undo function
    const undo = useCallback(() => {
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            const historyItem = history[newIndex];
            
            setHistoryIndex(newIndex);
            setOptions(historyItem.options);
            setFeatureCollectionPlot(historyItem.featureCollection);
        }
    }, [history, historyIndex, setFeatureCollectionPlot]);

    // Redo function
    const redo = useCallback(() => {
        if (historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1;
            const historyItem = history[newIndex];
            
            setHistoryIndex(newIndex);
            setOptions(historyItem.options);
            setFeatureCollectionPlot(historyItem.featureCollection);
        }
    }, [history, historyIndex, setFeatureCollectionPlot]);

    // Keyboard shortcuts for undo/redo
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Only handle shortcuts if not typing in an input field
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

            if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
            } else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                e.preventDefault();
                redo();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [undo, redo]);

    useEffect(() => {
        if (selectedYearGCP && selectedExperimentGCP && selectedLocationGCP && selectedPopulationGCP) {
            getAndParseFieldDesign(
                selectedYearGCP,
                selectedExperimentGCP,
                selectedLocationGCP,
                selectedPopulationGCP
            ).then((data) => {
                setFieldDesign(data);
            }).catch((error) => {
                console.log("No field design found, continuing without CSV data");
                setFieldDesign(null);
            });
            
            // Check for AgRowStitch availability
            checkAgrowstitchAvailability();
        }
    }, [selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP]);

    const checkAgrowstitchAvailability = async () => {
        try {
            const basePath = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`;
            const dates = await listDirs(basePath);

            let hasAgrowstitch = false;
            for (const date of dates) {
                if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    try {
                        const platforms = await listDirs(`${basePath}/${date}`);

                        for (const platform of platforms) {
                            try {
                                const sensors = await listDirs(`${basePath}/${date}/${platform}`);

                                for (const sensor of sensors) {
                                    try {
                                        const dirs = await listDirs(`${basePath}/${date}/${platform}/${sensor}`);

                                        if (dirs.some(dir => dir.startsWith('AgRowStitch_v'))) {
                                            hasAgrowstitch = true;
                                            break;
                                        }
                                    } catch (e) {
                                        continue;
                                    }
                                }
                                if (hasAgrowstitch) break;
                            } catch (e) {
                                continue;
                            }
                        }
                        if (hasAgrowstitch) break;
                    } catch (e) {
                        continue;
                    }
                }
            }
            setAgrowstitchAvailable(hasAgrowstitch);
        } catch (error) {
            console.log("Error checking AgRowStitch availability:", error);
            setAgrowstitchAvailable(false);
        }
    };

    const [validationError, setValidationError] = useState("");
    const [calcDimensions, setCalcDimensions] = useState(null);

    // Recalculate dimensions whenever options or pop boundary change
    useEffect(() => {
        if (!featureCollectionPop?.features?.length || !options.rows || !options.columns) {
            setCalcDimensions(null);
            setValidationError("");
            return;
        }
        const result = validateAndCalcPlotDimensions(featureCollectionPop.features[0], options);
        if (result.valid) {
            setCalcDimensions(result);
            setValidationError("");
        } else {
            setCalcDimensions(null);
            setValidationError(result.error);
        }
    }, [featureCollectionPop, options]);

    const applyUpdatedOptions = useCallback(
        (updatedOptions) => {
            if (!featureCollectionPop?.features?.length) return;
            const mainPolygon = featureCollectionPop.features[0];

            try {
                const newRectangles = fillPolygonWithRectangles(mainPolygon, updatedOptions);
                if (fieldDesign) {
                    mergeCsvDataWithGeoJson(newRectangles, fieldDesign);
                }

                if (featureCollectionPlot?.features?.length > 0) {
                    addToHistory(featureCollectionPlot, options);
                }

                setFeatureCollectionPlot(newRectangles);
                setValidationError("");
            } catch (error) {
                setValidationError(error.message);
            }
        },
        [fieldDesign, featureCollectionPop, setFeatureCollectionPlot, featureCollectionPlot, options, addToHistory]
    );

    // Auto-apply plot proposals when population boundary and options are available
    // Use a ref to track if we've applied, since state updates can be batchy
    const autoApplyAttempted = useRef(false);
    useEffect(() => {
        if (autoApplyAttempted.current) return;
        if (!featureCollectionPop?.features?.length) return;
        if (!options.rows || !options.columns) return;

        // Small delay to let all state settle after step transition
        const timer = setTimeout(() => {
            if (autoApplyAttempted.current) return;
            if (!featureCollectionPop?.features?.length) return;

            try {
                const mainPolygon = featureCollectionPop.features[0];
                const newRectangles = fillPolygonWithRectangles(mainPolygon, options);
                if (fieldDesign) {
                    mergeCsvDataWithGeoJson(newRectangles, fieldDesign);
                }
                setFeatureCollectionPlot(newRectangles);
                autoApplyAttempted.current = true;
                setHasAutoApplied(true);
                console.log("Auto-applied plot proposals:", newRectangles.features.length, "plots");
            } catch (error) {
                console.error("Auto-apply skipped:", error.message);
            }
        }, 500);

        return () => clearTimeout(timer);
    }, [featureCollectionPop, options, fieldDesign, setFeatureCollectionPlot]);

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
        <>
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
                            <Typography variant="h6">Plot Grid Options</Typography>
                            {agrowstitchAvailable && (
                                <Typography variant="caption" color="success.main" sx={{ display: 'block', mb: 1 }}>
                                    AgRowStitch data detected - plot labeling available
                                </Typography>
                            )}
                            {fieldDesign && (
                                <Typography variant="caption" color="info.main" sx={{ display: 'block', mb: 1 }}>
                                    Field design data loaded ({fieldDesign.length} entries)
                                </Typography>
                            )}
                            {calcDimensions && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                                    Plot size: {calcDimensions.plotWidth.toFixed(1)}m x {calcDimensions.plotLength.toFixed(1)}m
                                    (field: {calcDimensions.boundaryWidthM.toFixed(1)}m x {calcDimensions.boundaryHeightM.toFixed(1)}m)
                                </Typography>
                            )}
                            {validationError && (
                                <Typography variant="caption" color="error" sx={{ display: 'block', mb: 1 }}>
                                    {validationError}
                                </Typography>
                            )}
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
                                max={360}
                                sx={{ my: 0.5 }}
                            />

                            <Button variant="contained" color="primary" onClick={applyOptions} disabled={!!validationError}>
                                Apply
                            </Button>
                            
                            <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
                                <Button 
                                    variant="outlined" 
                                    size="small" 
                                    onClick={undo}
                                    disabled={historyIndex <= 0}
                                    sx={{ flex: 1 }}
                                >
                                    Undo (⌘Z)
                                </Button>
                                <Button 
                                    variant="outlined" 
                                    size="small" 
                                    onClick={redo}
                                    disabled={historyIndex >= history.length - 1}
                                    sx={{ flex: 1 }}
                                >
                                    Redo (⌘Y)
                                </Button>
                            </Box>
                        </Box>
                    </>
                )}
            </div>
        </>
    );
}

export default PlotProposalSwitcher;
