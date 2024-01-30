import React, { useState, useEffect, useRef } from "react";
import { Autocomplete, TextField, Button } from "@mui/material";

import { fetchData, useDataSetters, useDataState } from "../../DataContext";

const GCPPickerSelectionMenu = ({
    onCsvChange,
    onImageFolderChange,
    onRadiusChange,
    selectedMetric,
    setSelectedMetric,
}) => {
    const {
        locationOptionsGCP,
        selectedLocationGCP,
        populationOptionsGCP,
        selectedPopulationGCP,
        yearOptionsGCP,
        selectedYearGCP,
        experimentOptionsGCP,
        selectedExperimentGCP,
        dateOptionsGCP,
        selectedDateGCP,
        radiusMeters,
        flaskUrl,
        gcpPath,
        isSidebarCollapsed,
    } = useDataState();

    const {
        setLocationOptionsGCP,
        setSelectedLocationGCP,
        setPopulationOptionsGCP,
        setSelectedPopulationGCP,
        setYearOptionsGCP,
        setSelectedYearGCP,
        setExperimentOptionsGCP,
        setSelectedExperimentGCP,
        setDateOptionsGCP,
        setSelectedDateGCP,
        setImageList,
        setGcpPath,
        setSidebarCollapsed,
        setTotalImages,
        setIsPrepInitiated,
    } = useDataSetters();

    useEffect(() => {
        fetchData(`${flaskUrl}list_dirs/Raw/`)
            .then(setYearOptionsGCP)
            .catch((error) => console.error("Error:", error));
    }, []);

    useEffect(() => {
        if (selectedYearGCP) {
            fetchData(`${flaskUrl}list_dirs/Raw/${selectedYearGCP}/`)
                .then(setExperimentOptionsGCP)
                .catch((error) => console.error("Error:", error));
        } else {
            setExperimentOptionsGCP([]);
        }
    }, [selectedYearGCP]);

    useEffect(() => {
        if (selectedYearGCP && selectedExperimentGCP) {
            fetchData(`${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/`)
                .then(setLocationOptionsGCP)
                .catch((error) => console.error("Error:", error));
        } else {
            setLocationOptionsGCP([]);
        }
    }, [selectedYearGCP, selectedExperimentGCP]);

    useEffect(() => {
        if (selectedYearGCP && selectedExperimentGCP && selectedLocationGCP) {
            fetchData(`${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/`)
                .then(setPopulationOptionsGCP)
                .catch((error) => console.error("Error:", error));
        } else {
            setPopulationOptionsGCP([]);
        }
    }, [selectedYearGCP, selectedExperimentGCP, selectedLocationGCP]);

    const initiatePrep = () => {
        setIsPrepInitiated(true);
        if (!isSidebarCollapsed) {
            setSidebarCollapsed(true);
        }
    };

    return (
        <>
            <Autocomplete
                id="year-combo-box"
                options={yearOptionsGCP}
                value={selectedYearGCP}
                onChange={(event, newValue) => {
                    setSelectedYearGCP(newValue);
                    setSelectedExperimentGCP(null);
                    setSelectedLocationGCP(null);
                    setSelectedPopulationGCP(null);
                    setSelectedDateGCP(null);
                }}
                renderInput={(params) => <TextField {...params} label="Year" />}
                sx={{ mb: 2 }}
            />

            {selectedYearGCP !== null ? (
                <Autocomplete
                    id="experiment-combo-box"
                    options={experimentOptionsGCP}
                    value={selectedExperimentGCP}
                    onChange={(event, newValue) => {
                        setSelectedExperimentGCP(newValue);
                        setSelectedLocationGCP(null);
                        setSelectedPopulationGCP(null);
                        setSelectedDateGCP(null);
                    }}
                    renderInput={(params) => <TextField {...params} label="Experiment" />}
                    sx={{ mb: 2 }}
                />
            ) : null}

            {selectedExperimentGCP !== null ? (
                <Autocomplete
                    id="location-combo-box"
                    options={locationOptionsGCP}
                    value={selectedLocationGCP}
                    onChange={(event, newValue) => {
                        setSelectedLocationGCP(newValue);
                        setSelectedPopulationGCP(null);
                        setSelectedDateGCP(null);
                    }}
                    renderInput={(params) => <TextField {...params} label="Location" />}
                    sx={{ mb: 2 }}
                />
            ) : null}

            {selectedLocationGCP !== null ? (
                <Autocomplete
                    id="population-combo-box"
                    options={populationOptionsGCP}
                    value={selectedPopulationGCP}
                    onChange={(event, newValue) => {
                        setSelectedPopulationGCP(newValue);
                        setSelectedDateGCP(null);
                    }}
                    renderInput={(params) => <TextField {...params} label="Population" />}
                    sx={{ mb: 2 }}
                />
            ) : null}

            <Button variant="contained" color="primary" onClick={initiatePrep}>
                Begin Data Preparation
            </Button>
        </>
    );
};

export default GCPPickerSelectionMenu;
