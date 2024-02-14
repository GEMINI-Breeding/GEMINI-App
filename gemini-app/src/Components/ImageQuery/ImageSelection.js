import React, { useState, useEffect } from "react";
import { Grid, Button, Autocomplete, TextField, Typography, Box, CircularProgress } from "@mui/material";
import { fetchData, useDataSetters, useDataState } from "../../DataContext";
import Snackbar from "@mui/material/Snackbar";

const ImageSelection = () => {
    // Assuming these are provided by your DataContext or parent component
    const {
        selectedYearGCP,
        selectedExperimentGCP,
        selectedLocationGCP,
        selectedPopulationGCP,
        flaskUrl,
        imageDataQuery,
    } = useDataState();
    const { setImageDataQuery } = useDataSetters();

    // State hooks for date, platform, and sensor
    const [dateOptions, setDateOptions] = useState([]);
    const [selectedDate, setSelectedDate] = useState(null);
    const [platformOptions, setPlatformOptions] = useState([]);
    const [selectedPlatform, setSelectedPlatform] = useState(null);
    const [sensorOptions, setSensorOptions] = useState([]);
    const [selectedSensor, setSelectedSensor] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const [plotOptions, setPlotOptions] = useState([]);
    const [selectedPlots, setSelectedPlots] = useState([]);
    const [accessionOptions, setAccessionOptions] = useState([]);
    const [selectedAccessions, setSelectedAccessions] = useState([]);
    const [rowColumnPairs, setRowColumnPairs] = useState("");

    const geoJSON = {
        type: "FeatureCollection",
        features: [],
    };

    const filterGeoJSON = (geoJSON, queryMethod, queryValues) => {
        switch (queryMethod) {
            case "accession":
                return geoJSON.features.filter((feature) => queryValues.includes(feature.properties.Label));
            case "plot":
                return geoJSON.features.filter((feature) => queryValues.includes(feature.properties.Plot));
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

    const handleSubmit = async () => {
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
            geoJSON: filteredResults, // Assuming this is your filtered GeoJSON object
            selectedYearGCP,
            selectedExperimentGCP,
            selectedLocationGCP,
            selectedPopulationGCP,
            selectedDate,
        };
        try {
            // Call Flask endpoint with the payload
            const response = await fetch(`${flaskUrl}/get_filtered_images`, {
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
            // Use imageData (filtered image names) as needed
        } catch (error) {
            console.error("Error retrieving image data:", error);
            setSubmitError("Error retrieving image data. Please try again.");
            setIsLoading(false);
        }
        setIsLoading(false);
    };

    // Fetch dates based on selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, and selectedPopulationGCP
    useEffect(() => {
        const fetchDates = async () => {
            setIsLoading(true);
            const dirPath = `${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`;
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
        }
    }, [selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP]);

    // Fetch platforms based on the newly included selectedDate
    useEffect(() => {
        const fetchPlatforms = async () => {
            if (!selectedDate) {
                setPlatformOptions([]);
                return;
            }
            setIsLoading(true);
            const dirPath = `${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${selectedDate}`;
            try {
                const response = await fetchData(`${flaskUrl}list_dirs/${dirPath}`);
                setPlatformOptions(response);
            } catch (error) {
                console.error("Error fetching platforms:", error);
            }
            setIsLoading(false);
        };

        fetchPlatforms();
    }, [selectedDate]);

    // Fetch sensors based on selected platform and date
    useEffect(() => {
        const fetchSensors = async () => {
            if (!selectedPlatform) {
                setSensorOptions([]);
                return;
            }
            setIsLoading(true);
            const dirPath = `${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${selectedDate}/${selectedPlatform}`;
            try {
                const response = await fetchData(`${flaskUrl}list_dirs/${dirPath}`);
                setSensorOptions(response);
            } catch (error) {
                console.error("Error fetching sensors:", error);
            }
            setIsLoading(false);
        };

        fetchSensors();
    }, [selectedPlatform, selectedDate]);

    return (
        <Grid container spacing={2}>
            <Grid item xs={4}>
                <Typography variant="h6">Select Data</Typography>
                {isLoading && <CircularProgress />}
                {/* Date selection */}
                <Autocomplete
                    options={dateOptions}
                    value={selectedDate}
                    onChange={(event, newValue) => {
                        setSelectedDate(newValue);
                        setSelectedPlatform(null); // Reset platform when date changes
                        setSelectedSensor(null); // Reset sensor when date changes
                    }}
                    renderInput={(params) => (
                        <TextField {...params} label="Date" placeholder="Select Date" margin="normal" />
                    )}
                    disabled={isLoading}
                />
                {/* Platform selection */}
                <Autocomplete
                    options={platformOptions}
                    value={selectedPlatform}
                    onChange={(event, newValue) => {
                        setSelectedPlatform(newValue);
                        setSelectedSensor(null); // Reset sensor selection when platform changes
                    }}
                    renderInput={(params) => (
                        <TextField {...params} label="Platform" placeholder="Select Platform" margin="normal" />
                    )}
                    disabled={isLoading || !selectedDate}
                />
                {/* Sensor selection */}
                <Autocomplete
                    options={sensorOptions}
                    value={selectedSensor}
                    onChange={(event, newValue) => {
                        setSelectedSensor(newValue);
                    }}
                    renderInput={(params) => (
                        <TextField {...params} label="Sensor" placeholder="Select Sensor" margin="normal" />
                    )}
                    disabled={isLoading || !selectedPlatform}
                />
                {/* Additional selection components and submission button would go here */}
            </Grid>
            <Autocomplete
                multiple
                options={plotOptions}
                value={selectedPlots}
                onChange={(event, newValue) => {
                    setSelectedPlots(newValue);
                }}
                renderInput={(params) => <TextField {...params} label="Plot Numbers" />}
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
                renderInput={(params) => <TextField {...params} label="Accessions" />}
                disabled={selectedPlots.length > 0 || rowColumnPairs.trim() !== ""}
            />
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
            {/* Submit button */}
            <Button onClick={handleSubmit} variant="contained" color="primary" style={{ marginTop: "10px" }}>
                Submit
            </Button>
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
