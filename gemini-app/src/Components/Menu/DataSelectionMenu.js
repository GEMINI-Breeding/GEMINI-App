import React, { useState, useEffect, useRef } from "react";
import { Autocomplete, TextField, Snackbar } from "@mui/material";

import { useDataState, useDataSetters, fetchData } from "../../DataContext";

const DataSelectionMenu = ({ onTilePathChange, onGeoJsonPathChange, selectedMetric, setSelectedMetric }) => {
    const { genotypeOptions, selectedGenotypes, metricOptions, flaskUrl } = useDataState();

    const { setGenotypeOptions, setSelectedGenotypes, setMetricOptions } = useDataSetters();

    //////////////////////////////////////////
    // Local state
    //////////////////////////////////////////
    const [nestedStructure, setNestedStructure] = useState({});
    const [snackbarOpen, setSnackbarOpen] = useState(false);
    const [selectedValues, setSelectedValues] = useState({
        year: "",
        experiment: "",
        location: "",
        population: "",
        date: "",
        platform: "",
        sensor: "",
    });

    //////////////////////////////////////////
    // Fetch nested structure
    //////////////////////////////////////////
    const getData = async (url) => {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error("Network response was not ok");
        }
        return await response.json();
    };

    useEffect(() => {
        getData(`${flaskUrl}list_dirs_nested_processed`)
            .then((data) => setNestedStructure(data))
            .catch((error) => console.error("Error fetching nested structure:", error));

        console.log("nestedStructure", nestedStructure);
    }, []);

    //////////////////////////////////////////
    // Helper functions
    //////////////////////////////////////////

    const handleGenotypeChange = (event, newValue) => {
        if (newValue.includes("All Genotypes") && newValue.length > 1) {
            if (selectedGenotypes.includes("All Genotypes")) {
                newValue = newValue.filter((val) => val !== "All Genotypes");
            } else {
                newValue = ["All Genotypes"];
            }
        }
        setSelectedGenotypes(newValue);
    };

    //////////////////////////////////////////
    // Function to get options based on the current path
    //////////////////////////////////////////
    const getOptionsForField = (field) => {
        let options = [];
        let currentLevel = nestedStructure;
        const fieldsOrder = ["year", "experiment", "location", "population", "date", "platform", "sensor"];

        for (const key of fieldsOrder) {
            if (key === field) break;
            currentLevel = currentLevel[selectedValues[key]] || {};
        }

        if (currentLevel) {
            options = Object.keys(currentLevel);
        }

        return options;
    };

    //////////////////////////////////////////
    // Handle selection change
    //////////////////////////////////////////
    const handleSelectionChange = (field, value) => {
        const newSelectedValues = { ...selectedValues, [field]: value };

        // Reset subsequent selections
        const fieldsOrder = ["year", "experiment", "location", "population", "date", "platform", "sensor"];
        const currentIndex = fieldsOrder.indexOf(field);
        fieldsOrder.slice(currentIndex + 1).forEach((key) => {
            newSelectedValues[key] = "";
        });

        setSelectedValues(newSelectedValues);
    };

    //////////////////////////////////////////
    // Fetch data and update options if all fields are selected
    //////////////////////////////////////////
    useEffect(() => {
        if (selectedValues["platform"]) {
            let newTilePath;
            if (!selectedValues["sensor"]) {
                newTilePath = `files/Processed/${selectedValues["year"]}/${selectedValues["experiment"]}/${selectedValues["location"]}/${selectedValues["population"]}/${selectedValues["date"]}/Drone/RGB/${selectedValues["date"]}-RGB-Pyramid.tif`;
            } else {
                newTilePath = `files/Processed/${selectedValues["year"]}/${selectedValues["experiment"]}/${selectedValues["location"]}/${selectedValues["population"]}/${selectedValues["date"]}/Drone/${selectedValues["sensor"]}/${selectedValues["date"]}-RGB-Pyramid.tif`;
            }
            const newGeoJsonPath = `${flaskUrl}files/Processed/${selectedValues["year"]}/${selectedValues["experiment"]}/${selectedValues["location"]}/${selectedValues["population"]}/${selectedValues["date"]}/${selectedValues["platform"]}/${selectedValues["sensor"]}/${selectedValues["date"]}-${selectedValues["platform"]}-${selectedValues["sensor"]}-Traits-WGS84.geojson`;
            console.log(newGeoJsonPath)
            onTilePathChange(newTilePath);
            onGeoJsonPathChange(newGeoJsonPath);
            
            fetchData(newGeoJsonPath)
                .then((data) => {
                    // console.log("map features: ", data.features);
                    const traitOutputLabels = data.features.map((f) => f.properties.accession);
                    // console.log("traitOutputLabels: ", traitOutputLabels);
                    const metricColumns = Object.keys(data.features[0].properties);
                    const excludedColumns = ["Tier", "Bed", "Plot", "Label", "Group", "geometry", "lon", "lat", "row", "column", "location", "plot", "population", "accession", "col"];
                    const metrics = metricColumns.filter((col) => !excludedColumns.includes(col));
                    console.log("metrics: ", metrics);
                    setMetricOptions(metrics);
                    const uniqueTraitOutputLabels = [...new Set(traitOutputLabels)];
                    // console.log("uniqueTraitOutputLabels: ", uniqueTraitOutputLabels);
                    uniqueTraitOutputLabels.unshift("All Genotypes");
                    setGenotypeOptions(uniqueTraitOutputLabels);
                    if (!selectedGenotypes) {
                        setSelectedGenotypes(["All Genotypes"]);
                    }
                })
                .catch((error) => console.error("Error fetching genotypes:", error));
        }

        // Check if any key selection criteria is missing and reset the path if necessary
        if (
            !selectedValues["year"] ||
            !selectedValues["experiment"] ||
            !selectedValues["location"] ||
            !selectedValues["population"] ||
            !selectedValues["date"] ||
            !selectedValues["platform"] ||
            !selectedValues["sensor"]
        ) {
            onGeoJsonPathChange(null);
        }

        if (
            !selectedValues["year"] ||
            !selectedValues["experiment"] ||
            !selectedValues["location"] ||
            !selectedValues["population"] ||
            !selectedValues["date"] ||
            !selectedValues["platform"]
        ) {
            onTilePathChange(null);
        }

        if (!selectedValues["sensor"]) {
            setSelectedMetric(null);
        }
    }, [
        selectedValues["year"],
        selectedValues["experiment"],
        selectedValues["location"],
        selectedValues["population"],
        selectedValues["date"],
        selectedValues["platform"],
        selectedValues["sensor"],
    ]);

    //////////////////////////////////////////
    // Dynamically render Autocomplete components
    //////////////////////////////////////////
    const fieldsOrder = ["year", "experiment", "location", "population", "date", "platform", "sensor"];
    const autocompleteComponents = fieldsOrder.map((field, index) => {
        const label = field.charAt(0).toUpperCase() + field.slice(1); // Capitalize the first letter
        const options = getOptionsForField(field);

        //////////////////////////////////////////
        // Fetch geojson data for download

        return (
            <Autocomplete
                key={field}
                id={`${field}-autocomplete`}
                options={options}
                value={selectedValues[field]}
                onChange={(event, newValue) => handleSelectionChange(field, newValue)}
                renderInput={(params) => <TextField {...params} label={label} />}
                sx={{ mb: 2 }}
            />
        );
    });

    return (
        <>
            {autocompleteComponents}
            {selectedValues["sensor"] ? (
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
            {selectedMetric ? (
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
                        // console.log("genotype options", genotypeOptions);
                        setSelectedGenotypes(newValue);
                    }}
                    renderInput={(params) => <TextField {...params} label="Genotype" />}
                    sx={{ mb: 2 }}
                />
            ) : null}
            <Snackbar
                open={snackbarOpen}
                message="Tiff file does not exist for the selected criteria"
                autoHideDuration={3000}
                onClose={() => setSnackbarOpen(false)}
            />
        </>
    );
};

export default DataSelectionMenu;
