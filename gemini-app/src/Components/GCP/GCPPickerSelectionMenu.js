import React, { useState, useEffect, useRef } from "react";
import { Autocomplete, TextField, Button } from "@mui/material";

import { useDataSetters, useDataState } from "../../DataContext";
import { getExperiments, getExperimentHierarchy } from "../../api/entities";

const GCPPickerSelectionMenu = () => {
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
        gcpPath,
        isSidebarCollapsed,
        isGCPReady
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
        setIsGCPReady
    } = useDataSetters();

    // State for framework experiment list and hierarchy
    const [experiments, setExperiments] = useState([]);
    const [hierarchy, setHierarchy] = useState(null);

    useEffect(() => {
        getExperiments()
            .then((data) => {
                setExperiments(data);
                setExperimentOptionsGCP(data.map(e => e.experiment_name));
            })
            .catch((error) => console.error("Error:", error));
    }, []);

    useEffect(() => {
        if (selectedExperimentGCP) {
            const exp = experiments.find(e => e.experiment_name === selectedExperimentGCP);
            if (exp) {
                getExperimentHierarchy(exp.id)
                    .then((data) => {
                        setHierarchy(data);
                        setYearOptionsGCP(data.seasons.map(s => s.season_name));
                        setLocationOptionsGCP(data.sites.map(s => s.site_name));
                        setPopulationOptionsGCP(data.populations.map(p => p.population_name));
                    })
                    .catch((error) => console.error("Error:", error));
            }
        }
    }, [selectedYearGCP, selectedExperimentGCP]);


    const initiatePrep = () => {
        if(selectedPopulationGCP !== null){
            setIsPrepInitiated(true);
            setIsGCPReady(true);
            if (!isSidebarCollapsed) {
                setSidebarCollapsed(true);
            }
        }
    };

    // Experiment first, then Year/Location/Population populated from hierarchy
    const showYear = selectedExperimentGCP !== null;
    const showLocation = selectedExperimentGCP !== null;
    const showPopulation = selectedExperimentGCP !== null;

    return (
        <>
            <Autocomplete
                id="experiment-combo-box"
                options={experimentOptionsGCP}
                value={selectedExperimentGCP}
                onChange={(event, newValue) => {
                    setSelectedExperimentGCP(newValue);
                    setSelectedYearGCP(null);
                    setSelectedLocationGCP(null);
                    setSelectedPopulationGCP(null);
                    setSelectedDateGCP(null);
                    setIsGCPReady(false);
                }}
                renderInput={(params) => <TextField {...params} label="Experiment" />}
                sx={{ mb: 2 }}
            />

            {showYear ? (
                <Autocomplete
                    id="year-combo-box"
                    options={yearOptionsGCP}
                    value={selectedYearGCP}
                    onChange={(event, newValue) => {
                        setSelectedYearGCP(newValue);
                        setIsGCPReady(false);
                    }}
                    renderInput={(params) => <TextField {...params} label="Year" />}
                    sx={{ mb: 2 }}
                />
            ) : null}

            {showLocation ? (
                <Autocomplete
                    id="location-combo-box"
                    options={locationOptionsGCP}
                    value={selectedLocationGCP}
                    onChange={(event, newValue) => {
                        setSelectedLocationGCP(newValue);
                        setSelectedPopulationGCP(null);
                        setIsGCPReady(false);
                    }}
                    renderInput={(params) => <TextField {...params} label="Location" />}
                    sx={{ mb: 2 }}
                />
            ) : null}

            {showPopulation ? (
                <Autocomplete
                    id="population-combo-box"
                    options={populationOptionsGCP}
                    value={selectedPopulationGCP}
                    onChange={(event, newValue) => {
                        setSelectedPopulationGCP(newValue);
                        setIsGCPReady(false);
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
