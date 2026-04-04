import React, { useState, useEffect, useRef } from "react";
import { Autocomplete, TextField, Button } from "@mui/material";

import { fetchData, useDataSetters, useDataState } from "../../DataContext";
import { BACKEND_MODE } from "../../api/config";
import { getExperiments, getExperimentHierarchy } from "../../api/entities";

const TableSelectionMenu = () => {
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
    } = useDataSetters();


    const { isTableMenuInitiated } = useDataState();
    const { setIsTableMenuInitiated } = useDataSetters();

    const [experiments, setExperiments] = useState([]);

    useEffect(() => {
        if (BACKEND_MODE === 'framework') {
            getExperiments()
                .then((data) => {
                    setExperiments(data);
                    setExperimentOptionsGCP(data.map(e => e.experiment_name));
                })
                .catch((error) => console.error("Error:", error));
        } else {
            fetchData(`${flaskUrl}list_dirs/Raw/`)
                .then(setYearOptionsGCP)
                .catch((error) => console.error("Error:", error));
        }
    }, []);

    useEffect(() => {
        if (BACKEND_MODE === 'framework') {
            if (selectedExperimentGCP) {
                const exp = experiments.find(e => e.experiment_name === selectedExperimentGCP);
                if (exp) {
                    getExperimentHierarchy(exp.id)
                        .then((data) => {
                            setYearOptionsGCP(data.seasons.map(s => s.season_name));
                            setLocationOptionsGCP(data.sites.map(s => s.site_name));
                            setPopulationOptionsGCP(data.populations.map(p => p.population_name));
                        })
                        .catch((error) => console.error("Error:", error));
                }
            }
            return;
        }
        if (selectedYearGCP) {
            fetchData(`${flaskUrl}list_dirs/Raw/${selectedYearGCP}/`)
                .then(setExperimentOptionsGCP)
                .catch((error) => console.error("Error:", error));
        } else {
            setExperimentOptionsGCP([]);
        }
    }, [selectedYearGCP, selectedExperimentGCP]);

    useEffect(() => {
        if (BACKEND_MODE === 'framework') return;
        if (selectedYearGCP && selectedExperimentGCP) {
            fetchData(`${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/`)
                .then(setLocationOptionsGCP)
                .catch((error) => console.error("Error:", error));
        } else {
            setLocationOptionsGCP([]);
        }
    }, [selectedYearGCP, selectedExperimentGCP]);

    useEffect(() => {
        if (BACKEND_MODE === 'framework') return;
        if (selectedYearGCP && selectedExperimentGCP && selectedLocationGCP) {
            fetchData(`${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/`)
                .then(setPopulationOptionsGCP)
                .catch((error) => console.error("Error:", error));
        } else {
            setPopulationOptionsGCP([]);
        }
    }, [selectedYearGCP, selectedExperimentGCP, selectedLocationGCP]);

    const initiateTableMenu = () => {
        console.log("selectedPopulationGCP: ",selectedPopulationGCP);
        if(selectedPopulationGCP){
            console.log("Table Menu Initiated");
            setIsTableMenuInitiated(true);
            if (!isSidebarCollapsed) {
                setSidebarCollapsed(true);
            }
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

            <Button variant="contained" color="primary" onClick={initiateTableMenu}>
                OK
            </Button>
        </>
    );
};

export default TableSelectionMenu;
