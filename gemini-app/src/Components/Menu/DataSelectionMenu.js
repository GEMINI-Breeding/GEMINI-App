import React, { useState, useEffect } from "react";
import { Autocomplete, TextField, Snackbar } from "@mui/material";
import { useDataState, useDataSetters, fetchData } from "../../DataContext";
import { getExperiments, getExperimentHierarchy } from "../../api/entities";
import { getOrthomosaicVersions } from "../../api/queries";
import { getFileUrl } from "../../api/files";

const DataSelectionMenu = ({ onTilePathChange, onGeoJsonPathChange, selectedMetric, setSelectedMetric }) => {
    const { genotypeOptions, selectedGenotypes, metricOptions } = useDataState();
    const { setGenotypeOptions, setSelectedGenotypes, setMetricOptions } = useDataSetters();

    //////////////////////////////////////////
    // Local state
    //////////////////////////////////////////
    const [nestedStructure, setNestedStructure] = useState({});
    const [snackbarOpen, setSnackbarOpen] = useState(false);
    const [availableVersions, setAvailableVersions] = useState([]);
    const [selectedValues, setSelectedValues] = useState({
        year: "",
        experiment: "",
        location: "",
        population: "",
        date: "",
        platform: "",
        sensor: "",
        version: "",
    });

    // Framework mode: store experiment list and hierarchy data
    const [experiments, setExperiments] = useState([]);
    const [hierarchy, setHierarchy] = useState(null);

    //////////////////////////////////////////
    // Fetch data based on backend mode
    //////////////////////////////////////////
    useEffect(() => {
        getExperiments()
            .then((data) => setExperiments(data))
            .catch((error) => console.error("Error fetching experiments:", error));
    }, []);

    // Framework mode: fetch hierarchy when experiment is selected
    useEffect(() => {
        if (selectedValues.experiment) {
            const exp = experiments.find(e => e.experiment_name === selectedValues.experiment);
            if (exp) {
                getExperimentHierarchy(exp.id)
                    .then((data) => setHierarchy(data))
                    .catch((error) => console.error("Error fetching experiment hierarchy:", error));
            }
        }
    }, [selectedValues.experiment, experiments]);

    //////////////////////////////////////////
    // Function to get options based on the current path
    //////////////////////////////////////////
    const getOptionsForField = (field) => {
        return getFrameworkOptionsForField(field);
    };

    const getFlaskOptionsForField = (field) => {
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

    const getFrameworkOptionsForField = (field) => {
        if (field === "experiment") {
            return experiments.map(e => e.experiment_name);
        }
        if (!hierarchy) return [];

        switch (field) {
            case "year":
                return hierarchy.seasons.map(s => s.season_name);
            case "location":
                return hierarchy.sites.map(s => s.site_name);
            case "population":
                return hierarchy.populations.map(p => p.population_name);
            case "date":
                return [...new Set(hierarchy.datasets.map(d => d.collection_date))].filter(Boolean).sort();
            case "platform":
                return hierarchy.sensor_platforms.map(sp => sp.sensor_platform_name);
            case "sensor":
                return hierarchy.sensors.map(s => s.sensor_name);
            default:
                return [];
        }
    };

    //////////////////////////////////////////
    // Fetch orthomosaic versions
    //////////////////////////////////////////
    const fetchOrthomosaicVersions = async () => {
        if (selectedValues["sensor"]) {
            try {
                const data = await getOrthomosaicVersions({
                    year: selectedValues["year"],
                    experiment: selectedValues["experiment"],
                    location: selectedValues["location"],
                    population: selectedValues["population"],
                    date: selectedValues["date"],
                    platform: selectedValues["platform"],
                    sensor: selectedValues["sensor"],
                });

                setAvailableVersions(data);

                // Auto-select first version if only one available
                if (data.length === 1) {
                    setSelectedValues(prev => ({ ...prev, version: data[0].versionName }));
                } else if (data.length === 0) {
                    setSelectedValues(prev => ({ ...prev, version: "" }));
                }
            } catch (error) {
                console.error('Error fetching orthomosaic versions:', error);
                setAvailableVersions([]);
            }
        }
    };

    // Fetch versions when sensor changes
    useEffect(() => {
        if (selectedValues["sensor"]) {
            fetchOrthomosaicVersions();
        } else {
            setAvailableVersions([]);
            setSelectedValues(prev => ({ ...prev, version: "" }));
        }
    }, [selectedValues["sensor"], selectedValues["year"], selectedValues["experiment"],
        selectedValues["location"], selectedValues["population"], selectedValues["date"],
        selectedValues["platform"]]);

    //////////////////////////////////////////
    // Handle selection change
    //////////////////////////////////////////
    const handleSelectionChange = (field, value) => {
        const newSelectedValues = { ...selectedValues, [field]: value };

        // Reset subsequent selections
        const fieldsOrder = ["experiment", "year", "location", "population", "date", "platform", "sensor", "version"];
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
        if (selectedValues["version"] && availableVersions.length > 0) {
            // Find the selected version details
            const selectedVersionData = availableVersions.find(v => v.versionName === selectedValues["version"]);

            let newTilePath;
            let newGeoJsonPath;

            if (selectedVersionData) {
                // GeoJSON path is the same for both versions
                newGeoJsonPath = getFileUrl(selectedVersionData.path);

                // Check if the Orthomosaic Version contains "AgRowStitch"
                if (selectedValues["version"].includes("AgRowStitch")) {
                    // AgRowStitch tile path
                    newTilePath = `files/Processed/${selectedValues["year"]}/${selectedValues["experiment"]}/${selectedValues["location"]}/${selectedValues["population"]}/${selectedValues["date"]}/${selectedValues["platform"]}/${selectedValues["sensor"]}/${selectedValues["version"]}/combined_mosaic_utm.tif`;
                } else {
                    // If not AgRowStitch, use the Drone path as fallback
                    newTilePath = `files/Processed/${selectedValues["year"]}/${selectedValues["experiment"]}/${selectedValues["location"]}/${selectedValues["population"]}/${selectedValues["date"]}/${selectedValues["platform"]}/${selectedValues["sensor"]}/${selectedValues["date"]}-RGB-Pyramid.tif`;
                }

                onTilePathChange(newTilePath);
                onGeoJsonPathChange(newGeoJsonPath);

                // Fetch data for GeoJSON
                fetchData(newGeoJsonPath)
                    .then((data) => {
                        const traitOutputLabels = data.features.map((f) => f.properties.accession);
                        const metricColumns = Object.keys(data.features[0].properties);
                        const excludedColumns = ["Tier", "Bed", "Plot", "Label", "Group", "geometry", "lon", "lat", "row", "column", "location", "plot", "population", "accession", "col"];
                        const metrics = metricColumns.filter((col) => !excludedColumns.includes(col));
                        setMetricOptions(metrics);
                        const uniqueTraitOutputLabels = [...new Set(traitOutputLabels)];
                        uniqueTraitOutputLabels.unshift("All Genotypes");
                        setGenotypeOptions(uniqueTraitOutputLabels);
                        if (!selectedGenotypes) {
                            setSelectedGenotypes(["All Genotypes"]);
                        }
                    })
                    .catch((error) => console.error("Error fetching genotypes:", error));
            }
        } else {
            // If no version is selected or no versions are available, default to Drone tile path
            const newTilePath = `files/Processed/${selectedValues["year"]}/${selectedValues["experiment"]}/${selectedValues["location"]}/${selectedValues["population"]}/${selectedValues["date"]}/Drone/${selectedValues["sensor"]}/${selectedValues["date"]}-RGB-Pyramid.tif`;
            const newGeoJsonPath = null;

            onTilePathChange(newTilePath);
            onGeoJsonPathChange(newGeoJsonPath);
        }

        // Check if any key selection criteria is missing and reset the path if necessary
        if (
            !selectedValues["year"] ||
            !selectedValues["experiment"] ||
            !selectedValues["location"] ||
            !selectedValues["population"] ||
            !selectedValues["date"] ||
            !selectedValues["platform"] ||
            !selectedValues["sensor"] ||
            !selectedValues["version"]
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

        if (!selectedValues["version"]) {
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
        selectedValues["version"],
        availableVersions,
    ]);


    //////////////////////////////////////////
    // Dynamically render Autocomplete components
    //////////////////////////////////////////
    const fieldsOrder = ["experiment", "year", "location", "population", "date", "platform", "sensor"];

    const fieldLabels = {
        year: "Year",
        experiment: "Experiment",
        location: "Location",
        population: "Population",
        date: "Date",
        platform: "Platform",
        sensor: "Sensor",
    };

    const autocompleteComponents = fieldsOrder.map((field) => {
        const label = fieldLabels[field];
        const options = getOptionsForField(field);

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
            {selectedValues["sensor"] && availableVersions.length > 0 ? (
                <Autocomplete
                    id="version-combo-box"
                    options={availableVersions.map(v => v.versionName)}
                    value={selectedValues["version"]}
                    onChange={(event, newValue) => handleSelectionChange("version", newValue)}
                    renderInput={(params) => <TextField {...params} label="Orthomosaic Version" />}
                    sx={{ mb: 2 }}
                />
            ) : null}
            {selectedValues["version"] ? (
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
