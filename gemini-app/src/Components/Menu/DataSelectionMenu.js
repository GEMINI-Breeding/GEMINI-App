import React, { useState, useEffect } from "react";
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

    //////////////////////////////////////////
    // Fetch nested structure from database
    //////////////////////////////////////////
    const getData = async (url) => {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error("Network response was not ok");
        }
        return await response.json();
    };

    // Fetch initial years from database
    useEffect(() => {
        getData(`${flaskUrl}db/years`)
            .then((years) => {
                const yearsObj = {};
                years.forEach(year => {
                    yearsObj[year] = {};
                });
                setNestedStructure(yearsObj);
            })
            .catch((error) => console.error("Error fetching years:", error));
    }, [flaskUrl]);

    // Fetch experiments when year is selected
    useEffect(() => {
        const year = selectedValues.year;
        if (!year) return;
        
        getData(`${flaskUrl}db/experiments?year=${encodeURIComponent(year)}`)
            .then((experiments) => {
                setNestedStructure(prev => {
                    const updated = { ...prev };
                    if (!updated[year]) updated[year] = {};
                    experiments.forEach(exp => {
                        updated[year][exp] = {};
                    });
                    return updated;
                });
            })
            .catch((error) => console.error("Error fetching experiments:", error));
    }, [selectedValues.year, flaskUrl]);

    // Fetch locations when experiment is selected
    useEffect(() => {
        const { year, experiment } = selectedValues;
        if (!year || !experiment) return;
        
        getData(`${flaskUrl}db/locations?year=${encodeURIComponent(year)}&experiment=${encodeURIComponent(experiment)}`)
            .then((locations) => {
                setNestedStructure(prev => {
                    const updated = { ...prev };
                    if (!updated[year][experiment]) updated[year][experiment] = {};
                    locations.forEach(loc => {
                        updated[year][experiment][loc] = {};
                    });
                    return updated;
                });
            })
            .catch((error) => console.error("Error fetching locations:", error));
    }, [selectedValues.year, selectedValues.experiment, flaskUrl]);

    // Fetch populations when location is selected
    useEffect(() => {
        const { year, experiment, location } = selectedValues;
        if (!year || !experiment || !location) return;
        
        getData(`${flaskUrl}db/populations?year=${encodeURIComponent(year)}&experiment=${encodeURIComponent(experiment)}&location=${encodeURIComponent(location)}`)
            .then((populations) => {
                setNestedStructure(prev => {
                    const updated = { ...prev };
                    if (!updated[year][experiment][location]) updated[year][experiment][location] = {};
                    populations.forEach(pop => {
                        updated[year][experiment][location][pop] = {};
                    });
                    return updated;
                });
            })
            .catch((error) => console.error("Error fetching populations:", error));
    }, [selectedValues.year, selectedValues.experiment, selectedValues.location, flaskUrl]);

    // Fetch dates when population is selected
    useEffect(() => {
        const { year, experiment, location, population } = selectedValues;
        if (!year || !experiment || !location || !population) return;
        
        getData(`${flaskUrl}db/dates?year=${encodeURIComponent(year)}&experiment=${encodeURIComponent(experiment)}&location=${encodeURIComponent(location)}&population=${encodeURIComponent(population)}`)
            .then((dates) => {
                setNestedStructure(prev => {
                    const updated = { ...prev };
                    if (!updated[year][experiment][location][population]) {
                        updated[year][experiment][location][population] = {};
                    }
                    dates.forEach(date => {
                        updated[year][experiment][location][population][date] = {};
                    });
                    return updated;
                });
            })
            .catch((error) => console.error("Error fetching dates:", error));
    }, [selectedValues.year, selectedValues.experiment, selectedValues.location, selectedValues.population, flaskUrl]);

    // Fetch platforms when date is selected
    useEffect(() => {
        const { year, experiment, location, population, date } = selectedValues;
        if (!year || !experiment || !location || !population || !date) return;
        
        getData(`${flaskUrl}db/platforms?year=${encodeURIComponent(year)}&experiment=${encodeURIComponent(experiment)}&location=${encodeURIComponent(location)}&population=${encodeURIComponent(population)}&date=${encodeURIComponent(date)}`)
            .then((platforms) => {
                setNestedStructure(prev => {
                    const updated = { ...prev };
                    if (!updated[year][experiment][location][population][date]) {
                        updated[year][experiment][location][population][date] = {};
                    }
                    platforms.forEach(platform => {
                        updated[year][experiment][location][population][date][platform] = {};
                    });
                    return updated;
                });
            })
            .catch((error) => console.error("Error fetching platforms:", error));
    }, [selectedValues.year, selectedValues.experiment, selectedValues.location, selectedValues.population, selectedValues.date, flaskUrl]);

    // Fetch sensors when platform is selected
    useEffect(() => {
        const { year, experiment, location, population, date, platform } = selectedValues;
        if (!year || !experiment || !location || !population || !date || !platform) return;
        
        getData(`${flaskUrl}db/sensors?year=${encodeURIComponent(year)}&experiment=${encodeURIComponent(experiment)}&location=${encodeURIComponent(location)}&population=${encodeURIComponent(population)}&date=${encodeURIComponent(date)}&platform=${encodeURIComponent(platform)}`)
            .then((sensors) => {
                setNestedStructure(prev => {
                    const updated = { ...prev };
                    if (!updated[year][experiment][location][population][date][platform]) {
                        updated[year][experiment][location][population][date][platform] = {};
                    }
                    sensors.forEach(sensor => {
                        updated[year][experiment][location][population][date][platform][sensor] = {};
                    });
                    return updated;
                });
            })
            .catch((error) => console.error("Error fetching sensors:", error));
    }, [selectedValues.year, selectedValues.experiment, selectedValues.location, selectedValues.population, selectedValues.date, selectedValues.platform, flaskUrl]);

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
    // Fetch orthomosaic versions
    //////////////////////////////////////////
    const fetchOrthomosaicVersions = async () => {
        if (selectedValues["sensor"]) {
            try {
                const response = await fetch(`${flaskUrl}get_orthomosaic_versions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        year: selectedValues["year"],
                        experiment: selectedValues["experiment"],
                        location: selectedValues["location"],
                        population: selectedValues["population"],
                        date: selectedValues["date"],
                        platform: selectedValues["platform"],
                        sensor: selectedValues["sensor"],
                    }),
                });

                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }

                const data = await response.json();
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
        const fieldsOrder = ["year", "experiment", "location", "population", "date", "platform", "sensor", "version"];
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
                newGeoJsonPath = `${flaskUrl}${selectedVersionData.path}`;

                // Check if the Orthomosaic Version contains "AgRowStitch"
                if (selectedValues["version"].includes("AgRowStitch")) {
                    // AgRowStitch tile path
                    newTilePath = `files/Processed/${selectedValues["year"]}/${selectedValues["experiment"]}/${selectedValues["location"]}/${selectedValues["population"]}/${selectedValues["date"]}/${selectedValues["platform"]}/${selectedValues["sensor"]}/${selectedValues["version"]}/combined_mosaic_utm.tif`;
                } else {
                    // If not AgRowStitch, use the Drone path as fallback
                    newTilePath = `files/Processed/${selectedValues["year"]}/${selectedValues["experiment"]}/${selectedValues["location"]}/${selectedValues["population"]}/${selectedValues["date"]}/${selectedValues["platform"]}/${selectedValues["sensor"]}/${selectedValues["date"]}-RGB-Pyramid.tif`;
                }

                console.log("New GeoJSON Path:", newGeoJsonPath);
                console.log("New Tile Path:", newTilePath);

                onTilePathChange(newTilePath);
                onGeoJsonPathChange(newGeoJsonPath);
                
                // Fetch data for GeoJSON
                fetchData(newGeoJsonPath)
                    .then((data) => {
                        const traitOutputLabels = data.features.map((f) => f.properties.accession);
                        const metricColumns = Object.keys(data.features[0].properties);
                        const excludedColumns = ["Tier", "Bed", "Plot", "Label", "Group", "geometry", "lon", "lat", "row", "column", "location", "plot", "population", "accession", "col"];
                        const metrics = metricColumns.filter((col) => !excludedColumns.includes(col));
                        console.log("metrics: ", metrics);
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
    const fieldsOrder = ["year", "experiment", "location", "population", "date", "platform", "sensor"];
    const autocompleteComponents = fieldsOrder.map((field, index) => {
        const label = field.charAt(0).toUpperCase() + field.slice(1); // Capitalize the first letter
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
