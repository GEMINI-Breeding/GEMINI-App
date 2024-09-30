import React, { useState, useEffect } from "react";
import { Grid, Button, Autocomplete, TextField, Typography, Box, CircularProgress, Switch } from "@mui/material";
import { fetchData, useDataSetters, useDataState } from "../../DataContext";
import Snackbar from "@mui/material/Snackbar";
import SplitButton from "../Util/SplitButton";

const ImageSelection = () => {
    // Assuming these are provided by your DataContext or parent component
    const {
        selectedYearGCP,
        selectedExperimentGCP,
        selectedLocationGCP,
        selectedPopulationGCP,
        flaskUrl,
        imageDataQuery,
        selectedDateQuery,
        selectedPlatformQuery,
        selectedSensorQuery,
    } = useDataState();
    const { setImageDataQuery, setSelectedDateQuery, setSelectedPlatformQuery, setSelectedSensorQuery } =
        useDataSetters();

    // State hooks for date, platform, and sensor
    const [dateOptions, setDateOptions] = useState([]);
    const [platformOptions, setPlatformOptions] = useState([]);
    const [sensorOptions, setSensorOptions] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const [plotOptions, setPlotOptions] = useState([]);
    const [selectedPlots, setSelectedPlots] = useState([]);
    const [accessionOptions, setAccessionOptions] = useState([]);
    const [selectedAccessions, setSelectedAccessions] = useState([]);
    const [rowColumnPairs, setRowColumnPairs] = useState("");
    const [geoJSON, setGeoJSON] = useState(null);

    const [middleImage, setMiddleImage] = useState(false);

    const fetchGeoJSON = async (
        selectedYearGCP,
        selectedExperimentGCP,
        selectedLocationGCP,
        selectedPopulationGCP,
        flaskUrl
    ) => {
        const data = {
            selectedLocationGcp: selectedLocationGCP,
            selectedPopulationGcp: selectedPopulationGCP,
            selectedYearGcp: selectedYearGCP,
            selectedExperimentGcp: selectedExperimentGCP,
            filename: "Plot-Boundary-WGS84.geojson",
        };

        console.log("data for load json ", data);

        const response = await fetch(`${flaskUrl}load_geojson`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
        });
        if (response.ok) {
            console.log("response", response);
            const geojsonData = await response.json();
            console.log(geojsonData);
            geojsonData.features ? setGeoJSON(geojsonData) : setGeoJSON({ type: "FeatureCollection", features: [] });
        } else {
            console.error("Failed to load data");
            setGeoJSON({
                type: "FeatureCollection",
                features: [],
            });
        }
    };

    useEffect(() => {
        const extractPlotsAndAccessions = (geoJSON) => {
            const plots = [];
            const accessions = [];

            geoJSON.features.forEach((feature) => {
                const { Plot, plot, Label } = feature.properties;
                const plotValue = Plot || plot; // Added because of inconsistent capitalization
                if (plotValue && !plots.includes(plotValue)) {
                    plots.push(plotValue);
                }
                if (Label && !accessions.includes(Label)) {
                    accessions.push(Label);
                }
            });

            setPlotOptions(plots);
            setAccessionOptions(accessions);
        };

        if (geoJSON) {
            console.log(geoJSON);
            extractPlotsAndAccessions(geoJSON);
        }
    }, [geoJSON]);

    const filterGeoJSON = (geoJSON, queryMethod, queryValues) => {
        switch (queryMethod) {
            case "accession":
                return geoJSON.features.filter((feature) => queryValues.includes(feature.properties.Label));
            case "plot":
                return geoJSON.features.filter((feature) => {
                    const plotValue = feature.properties.Plot || feature.properties.plot;
                    return queryValues.includes(plotValue);
                });
            case "rowColumn":
                // Assuming queryValues is an array of { row, column } objects
                return geoJSON.features.filter((feature) =>
                    queryValues.some(
                        ({ row, column }) => feature.properties.Tier === row && feature.properties.Bed === column
                    )
                );
            default:
                throw new Error("Invalid query method");
        }
    };

    const handleSubmit = async (mode) => {
        setIsLoading(true);
        // Ensure only one selection method is used
        const selections = [selectedPlots.length, selectedAccessions.length, rowColumnPairs.trim() !== ""].filter(
            Boolean
        ).length;
        if (selections !== 1) {
            setSubmitError("Please use only one selection method: Plots, Accessions, or Row,Column pairs.");
            setIsLoading(false);
            return;
        }

        let filteredResults;
        try {
            if (selectedPlots.length > 0) {
                // Filter by plots
                filteredResults = filterGeoJSON(geoJSON, "plot", selectedPlots);
            } else if (selectedAccessions.length > 0) {
                // Filter by accessions
                filteredResults = filterGeoJSON(geoJSON, "accession", selectedAccessions);
            } else {
                // Filter by row/column pairs
                const rowColumnPairsArray = rowColumnPairs.split("\n").map((pair) => {
                    const [row, column] = pair.split(",").map((num) => num.trim());
                    return { row, column };
                });
                filteredResults = filterGeoJSON(geoJSON, "rowColumn", rowColumnPairsArray);
            }

            console.log(filteredResults); // Use the filtered results as needed
            // For example, update the state to render filtered results on the map or elsewhere
        } catch (error) {
            console.error("Error filtering data:", error);
            setSubmitError("Error filtering data. Please try again.");
            setIsLoading(false);
        }

        const payload = {
            geoJSON: filteredResults,
            selectedYearGCP,
            selectedExperimentGCP,
            selectedLocationGCP,
            selectedPopulationGCP,
            selectedPlatformQuery,
            selectedDateQuery,
            selectedSensorQuery,
            selectedPlots,
            middleImage: middleImage,
        };

        console.log("Payload:", payload);

        let response;
        if (mode === "view") {
            try {
                // Call Flask endpoint with the payload
                response = await fetch(`${flaskUrl}query_images`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(payload),
                });

                if (!response.ok) {
                    throw new Error("Network response was not ok");
                }

                const imData = await response.json();
                setImageDataQuery(imData);
                console.log(imData);
                // Use imageData (filtered image names) as needed
            } catch (error) {
                console.error("Error retrieving image data:", error);
                setSubmitError("Error retrieving image data. Please try again.");
                setIsLoading(false);
            }
        } else {
            try {
                response = await fetch(`${flaskUrl}dload_zipped`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(payload),
                })
                    .then((response) => response.blob())
                    .then((blob) => {
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.style.display = "none";
                        a.href = url;
                        a.download = "images.zip";
                        document.body.appendChild(a);
                        a.click();
                        window.URL.revokeObjectURL(url);
                    });
            } catch (error) {
                console.error("Error retrieving image data:", error);
                setSubmitError("Error retrieving image data. Please try again.");
                setIsLoading(false);
            }
        }
        setIsLoading(false);
    };

    // Fetch dates based on selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, and selectedPopulationGCP
    useEffect(() => {
        const fetchDates = async () => {
            setIsLoading(true);
            const dirPath = `Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`;
            try {
                const response = await fetchData(`${flaskUrl}list_dirs/${dirPath}`);
                setDateOptions(response);
            } catch (error) {
                console.error("Error fetching dates:", error);
            }
            setIsLoading(false);
        };

        if (selectedYearGCP && selectedExperimentGCP && selectedLocationGCP && selectedPopulationGCP) {
            fetchDates();
            fetchGeoJSON(selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP, flaskUrl);
        }
    }, [selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP]);

    // Fetch platforms based on the newly included selectedDate
    useEffect(() => {
        const fetchPlatforms = async () => {
            if (!selectedDateQuery) {
                setPlatformOptions([]);
                return;
            }
            setIsLoading(true);
            const dirPath = `Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${selectedDateQuery}`;
            try {
                const response = await fetchData(`${flaskUrl}list_dirs/${dirPath}`);
                setPlatformOptions(response);
            } catch (error) {
                console.error("Error fetching platforms:", error);
            }
            setIsLoading(false);
        };

        fetchPlatforms();
    }, [selectedDateQuery]);

    // Fetch sensors based on selected platform and date
    useEffect(() => {
        const fetchSensors = async () => {
            if (!selectedPlatformQuery) {
                setSensorOptions([]);
                return;
            }
            setIsLoading(true);
            const dirPath = `Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${selectedDateQuery}/${selectedPlatformQuery}`;
            try {
                const response = await fetchData(`${flaskUrl}list_dirs/${dirPath}`);
                setSensorOptions(response);
            } catch (error) {
                console.error("Error fetching sensors:", error);
            }
            setIsLoading(false);
        };

        fetchSensors();
    }, [selectedPlatformQuery, selectedDateQuery]);

    return (
        <Grid container spacing={2} style={{ paddingTop: "25px" }}>
            <Grid item xs={10}>
                <Typography variant="h6">Select Data</Typography>
                {isLoading && <CircularProgress />}
                {/* Date selection */}
                <Autocomplete
                    options={dateOptions}
                    value={selectedDateQuery}
                    onChange={(event, newValue) => {
                        setSelectedDateQuery(newValue);
                        setSelectedPlatformQuery(null); // Reset platform when date changes
                        setSelectedSensorQuery(null); // Reset sensor when date changes
                    }}
                    renderInput={(params) => (
                        <TextField {...params} label="Date" placeholder="Select Date" margin="normal" />
                    )}
                    disabled={isLoading}
                />
                {/* Platform selection */}
                <Autocomplete
                    options={platformOptions}
                    value={selectedPlatformQuery}
                    onChange={(event, newValue) => {
                        setSelectedPlatformQuery(newValue);
                        setSelectedSensorQuery(null); // Reset sensor selection when platform changes
                    }}
                    renderInput={(params) => (
                        <TextField {...params} label="Platform" placeholder="Select Platform" margin="normal" />
                    )}
                    disabled={isLoading || !selectedDateQuery}
                />
                {/* Sensor selection */}
                <Autocomplete
                    options={sensorOptions}
                    value={selectedSensorQuery}
                    onChange={(event, newValue) => {
                        setSelectedSensorQuery(newValue);
                    }}
                    renderInput={(params) => (
                        <TextField {...params} label="Sensor" placeholder="Select Sensor" margin="normal" />
                    )}
                    disabled={isLoading || !selectedPlatformQuery}
                />
                {/* Additional selection components and submission button would go here */}
                <Autocomplete
                    multiple
                    options={plotOptions}
                    value={selectedPlots}
                    onChange={(event, newValue) => {
                        setSelectedPlots(newValue);
                    }}
                    renderInput={(params) => <TextField {...params} label="Plot Numbers" margin="normal" />}
                    disabled={selectedAccessions.length > 0 || rowColumnPairs.trim() !== ""}
                />
                {/* Autocomplete for accessions */}
                <Autocomplete
                    multiple
                    options={accessionOptions}
                    value={selectedAccessions}
                    onChange={(event, newValue) => {
                        setSelectedAccessions(newValue);
                    }}
                    renderInput={(params) => <TextField {...params} label="Accessions" margin="normal" />}
                    disabled={selectedPlots.length > 0 || rowColumnPairs.trim() !== ""}
                />
                <br />
                {/* Multi-line text entry for row,column pairs */}
                <TextField
                    label="Row,Column Pairs"
                    multiline
                    rows={4}
                    value={rowColumnPairs}
                    onChange={(e) => setRowColumnPairs(e.target.value)}
                    disabled={selectedPlots.length > 0 || selectedAccessions.length > 0}
                    fullWidth
                />
                <br />
                {/* Middle image switch */}
                <Box display="flex" alignItems="center">
                    <Typography variant="body1">Center images of plots only</Typography>
                    <Switch
                        checked={middleImage}
                        onChange={(e) => setMiddleImage(e.target.checked)}
                        disabled={isLoading}
                    />
                </Box>
                {/* Submit button */}
                <Button
                    variant="contained"
                    onClick={() => handleSubmit("view")}
                    disabled={isLoading}
                    style={{ marginRight: "10px" }}
                >
                    View Images
                </Button>
                <Button
                    variant="contained"
                    onClick={() => handleSubmit("download")}
                    disabled={isLoading}
                    style={{ marginRight: "10px" }}
                >
                    Download
                </Button>
            </Grid>
            {/* Error Snackbar */}
            <Snackbar
                open={submitError !== ""}
                autoHideDuration={6000}
                onClose={() => setSubmitError("")}
                message={submitError}
            />
        </Grid>
    );
};

export default ImageSelection;
