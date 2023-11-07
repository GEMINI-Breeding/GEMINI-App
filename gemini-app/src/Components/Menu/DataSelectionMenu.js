import React, { useState, useEffect, useRef } from "react";
import { Autocomplete, TextField } from "@mui/material";

import { useDataState, useDataSetters, fetchData } from "../../DataContext";

const DataSelectionMenu = ({ onTilePathChange, onGeoJsonPathChange, selectedMetric, setSelectedMetric }) => {
    const {
        locationOptions,
        selectedLocation,
        populationOptions,
        selectedPopulation,
        genotypeOptions,
        selectedGenotypes,
        dateOptions,
        selectedDate,
        sensorOptions,
        selectedSensor,
        metricOptions,
        flaskUrl,
        selectedTraitsGeoJsonPath,
        nowDroneProcessing,
    } = useDataState();

    const {
        setLocationOptions,
        setSelectedLocation,
        setPopulationOptions,
        setSelectedPopulation,
        setGenotypeOptions,
        setSelectedGenotypes,
        setDateOptions,
        setSelectedDate,
        setSensorOptions,
        setSelectedSensor,
        setMetricOptions,
        setSelectedTraitsGeoJsonPath,
        setNowDroneProcessing,
    } = useDataSetters();

    useEffect(() => {
        // Fetch locations initially
        fetchData(`${flaskUrl}list_dirs/Processed/`)
            .then(setLocationOptions)
            .catch((error) => console.error("Error:", error));
    }, []);

    const prevLocationRef = useRef(null);
    const prevPopulationRef = useRef(null);
    const prevDateRef = useRef(null);

    useEffect(() => {
        // Check if location has changed
        if (selectedLocation !== prevLocationRef.current) {
            setSelectedPopulation(null);
            setSelectedDate(null);
            setSelectedSensor(null);
        }

        // Check if population has changed
        if (selectedPopulation !== prevPopulationRef.current) {
            setSelectedDate(null);
            setSelectedSensor(null);
        }

        // Check if date has changed
        if (selectedDate !== prevDateRef.current) {
            setSelectedSensor(null);
        }

        // Logic for when a sensor is selected
        if (selectedLocation && selectedPopulation && selectedDate && selectedSensor) {
            const newTilePath = `files/Processed/${selectedLocation}/${selectedPopulation}/${selectedDate}/Drone/${selectedDate}-P4-RGB-Pyramid.tif`;
            const newGeoJsonPath = `${flaskUrl}files/Processed/${selectedLocation}/${selectedPopulation}/${selectedDate}/Results/${selectedDate}-${selectedSensor}-Traits-WGS84.geojson`;

            onTilePathChange(newTilePath);
            onGeoJsonPathChange(newGeoJsonPath);

            // Fetch genotypes from the new GeoJSON path
            fetchData(newGeoJsonPath)
                .then((data) => {
                    // Get all unique plot labels
                    const traitOutputLabels = data.features.map((f) => f.properties.Label);
                    // Get all property names
                    const metricColumns = Object.keys(data.features[0].properties);
                    // Filter property names based on an exclusion list
                    const excludedColumns = ["Tier", "Bed", "Plot", "Label", "Group", "geometry"];
                    const metricOptions = metricColumns.filter((col) => !excludedColumns.includes(col));
                    setMetricOptions(metricOptions);
                    const uniqueTraitOutputLabels = [...new Set(traitOutputLabels)];
                    uniqueTraitOutputLabels.unshift("All Genotypes");
                    setGenotypeOptions(uniqueTraitOutputLabels);
                    if (selectedGenotypes == null) {
                        setSelectedGenotypes(["All Genotypes"]);
                    }
                })
                .catch((error) => {
                    console.error("newGeoJsonPath not loaded:", error);
                    setNowDroneProcessing(true);
                });
        }

        // Fetch sensors if no sensor is selected
        else if (selectedLocation && selectedPopulation && selectedDate && !selectedSensor) {
            fetchData(`${flaskUrl}list_dirs/Processed/${selectedLocation}/${selectedPopulation}/${selectedDate}`)
                .then((data) => {
                    // Check if 'Drone' folder exists
                    if (data.includes("Drone")) {
                        // Fetch contents of the 'Drone' folder
                        fetchData(
                            `${flaskUrl}list_files/Processed/${selectedLocation}/${selectedPopulation}/${selectedDate}/Drone`
                        )
                            .then((droneData) => {
                                console.log("Contents of Drone folder:", droneData);
                                // If the 'Drone' folder contains a file ending in 'Pyramid.tif', then add 'Drone' to the sensor options
                                if (droneData.filter((item) => item.endsWith("Pyramid.tif")).length > 0) {
                                    setSensorOptions(data.filter((item) => item !== "Results"));
                                } else {
                                    setSensorOptions(data.filter((item) => item !== "Drone" && item !== "Results"));
                                }
                            })
                            .catch((error) => console.error("Error fetching contents of Drone folder:", error));
                    }
                })
                .catch((error) => console.error("Error:", error));
        }

        // Fetch dates if no date is selected
        else if (selectedLocation && selectedPopulation && !selectedDate) {
            fetchData(`${flaskUrl}list_dirs/Processed/${selectedLocation}/${selectedPopulation}`)
                .then(setDateOptions)
                .catch((error) => console.error("Error:", error));
        }

        // Fetch populations if no population is selected
        else if (selectedLocation && !selectedPopulation) {
            fetchData(`${flaskUrl}list_dirs/Processed/${selectedLocation}`)
                .then(setPopulationOptions)
                .catch((error) => console.error("Error:", error));
        }

        // Check if any key selection criteria is missing and reset the path if necessary
        if (!selectedLocation || !selectedSensor || !selectedMetric) {
            onGeoJsonPathChange(null);
        }

        if (!selectedLocation || !selectedPopulation || !selectedDate || !selectedSensor) {
            onTilePathChange(null);
        }

        // Update ref values at the end
        prevLocationRef.current = selectedLocation;
        prevPopulationRef.current = selectedPopulation;
        prevDateRef.current = selectedDate;
    }, [selectedLocation, selectedPopulation, selectedDate, selectedSensor, selectedMetric, selectedGenotypes]);

    useEffect(() => {
        // Process drone tiff file if needed
        if (nowDroneProcessing) {
            const fetchUrl = `${flaskUrl}process_drone_tiff/${selectedLocation}/${selectedPopulation}/${selectedDate}`;
            fetchData(fetchUrl)
                .then(() => {
                    console.log("Drone tiff file processed!");
                    setNowDroneProcessing(false);
                })
                .catch((error) => console.error("Error:", error));
        }
    }, [nowDroneProcessing]);

    return (
        <>
            <Autocomplete
                id="location-combo-box"
                options={locationOptions}
                value={selectedLocation}
                onChange={(event, newValue) => {
                    setSelectedLocation(newValue);
                    setSelectedPopulation(null);
                    setSelectedDate(null);
                    setSelectedSensor(null);
                    setSelectedMetric(null);
                }}
                renderInput={(params) => <TextField {...params} label="Location" />}
                sx={{ mb: 2 }}
            />

            {selectedLocation !== null ? (
                <Autocomplete
                    id="population-combo-box"
                    options={populationOptions}
                    value={selectedPopulation}
                    onChange={(event, newValue) => {
                        setSelectedPopulation(newValue);
                        setSelectedGenotypes(null);
                        setSelectedDate(null);
                        setSelectedSensor(null);
                        setSelectedMetric(null);
                    }}
                    renderInput={(params) => <TextField {...params} label="Population" />}
                    sx={{ mb: 2 }}
                />
            ) : null}

            {selectedPopulation !== null ? (
                <Autocomplete
                    id="date-combo-box"
                    options={dateOptions}
                    value={selectedDate}
                    onChange={(event, newValue) => {
                        setSelectedDate(newValue);
                        setSelectedSensor(null);
                        setSelectedMetric(null);
                    }}
                    renderInput={(params) => <TextField {...params} label="Date" />}
                    sx={{ mb: 2 }}
                />
            ) : null}

            {selectedDate !== null ? (
                <Autocomplete
                    id="sensor-combo-box"
                    options={sensorOptions}
                    value={selectedSensor}
                    onChange={(event, newValue) => {
                        setSelectedSensor(newValue);
                        setSelectedMetric(null);
                    }}
                    renderInput={(params) => <TextField {...params} label="Sensing Platform" />}
                    sx={{ mb: 2 }}
                />
            ) : null}

            {selectedSensor !== null ? (
                <Autocomplete
                    id="metric-combo-box"
                    options={metricOptions}
                    value={selectedMetric}
                    onChange={(event, newValue) => {
                        setSelectedMetric(newValue);
                    }}
                    renderInput={(params) => <TextField {...params} label="Trait Metric" />}
                    sx={{ mb: 2 }}
                />
            ) : null}

            {selectedMetric !== null ? (
                <Autocomplete
                    multiple
                    id="genotype-combo-box"
                    options={genotypeOptions}
                    value={selectedGenotypes}
                    onChange={(event, newValue) => {
                        // If "All Genotypes" is selected along with other options
                        if (newValue.includes("All Genotypes") && newValue.length > 1) {
                            if (selectedGenotypes.includes("All Genotypes")) {
                                // This means that "All Genotypes" was already selected, so we remove other selections
                                newValue = newValue.filter((val) => val !== "All Genotypes");
                            } else {
                                // This means "All Genotypes" was freshly selected, so we only keep it and remove others
                                newValue = ["All Genotypes"];
                            }
                        }

                        if (newValue.length === 0 || (newValue.length === 1 && newValue[0] !== "All Genotypes")) {
                            if (!genotypeOptions.includes("All Genotypes")) {
                                setGenotypeOptions((prevOptions) => ["All Genotypes", ...prevOptions]);
                            }
                        } else if (!newValue.includes("All Genotypes") && genotypeOptions.includes("All Genotypes")) {
                            setGenotypeOptions((prevOptions) => prevOptions.filter((val) => val !== "All Genotypes"));
                        }

                        setSelectedGenotypes(newValue);
                    }}
                    renderInput={(params) => <TextField {...params} label="Genotype" />}
                    sx={{ mb: 2 }}
                />
            ) : null}
        </>
    );
};

export default DataSelectionMenu;
