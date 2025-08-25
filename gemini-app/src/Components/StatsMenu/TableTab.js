import React, { useState, useEffect, useRef } from "react";
import { Box, Grid, Typography } from "@mui/material";
import Snackbar from "@mui/material/Snackbar";

import { NestedSection, FolderTab, FolderTabs } from "./StatsAccordion.js";
import useTrackComponent from "../../useTrackComponent.js";
import { fetchData, useDataSetters, useDataState } from "../../DataContext.js";

import LoadTableModal from "./LoadTableModal.js";
import LoadGraphModal from "./LoadGraphModal.js";


const TableViewTab = () => {
    useTrackComponent("TableViewTab");

    const { 
        flaskUrl,
        selectedYearGCP,
        selectedExperimentGCP,
        selectedLocationGCP,
        selectedPopulationGCP,
        isTableMenuInitiated,
        tableViewTabNo
    } = useDataState();

    const { 
        setTableViewTabNo 
    } = useDataSetters();

    const handleChange = (event, newValue) => {
        setTableViewTabNo(newValue);
    };

    const CustomComponent = {
        loadTable: LoadTableModal,
        loadGraph: LoadGraphModal,
    };
    
    // Local states
    const [sensorData, setSensorData] = useState("");
    const [submitError, setSubmitError] = useState("");


    // Columns to render or send data to the nested section
    let tableColumns = [
        { label: "Date", field: "date", showColumn: true},
        { label: "Orthomosaic", field: "versionName", showColumn: true},
        { label: "Table", field: "isGeojsonExist", actionType: "loadTable", actionLabel: "Load", showColumn: true},
        // { label: "Graph", field: "isGeojsonExist", actionType: "loadGraph", actionLabel: "Load", showColumn: true},
        // { label: "Download", field: "enableDownload", actionType: "loadDownload", actionLabel: "Download",showColumn: true},
        { label: "FileName", field: "geoJsonFile", showColumn: false},
        { label: "VersionType", field: "versionType", showColumn: false},
        { label: "Version", field: "version", showColumn: false},
    ];

    // row data for nested section
    const constructRowData = (item, columns) => {
        const rowData = {};
        columns.forEach(column => {
            //console.log("column.field:", column.field);
            rowData[column.field] = item[column.field];
        });
        return rowData;
    };

    useEffect(() => {
        //console.log('[TableTab] sensorData has changed:', sensorData);
    }, [sensorData]);
    
    // const includedPlatforms = ["Drone", "Rover","Amiga-Onboard", "T4"];
    
    const constructUrl = (path, ...args) => `${flaskUrl}${path}/${args.join('/')}`;

    const fetchDataAndUpdate = async (date, platform, sensor, updatedData) => {
        let isGeojsonExist = 2; // Default to not completed
        let enableDownload = 2;
        // Initialize sensor array if not already done
        if (!updatedData[platform]) {
            updatedData[platform] = {};
        }
        if (!updatedData[platform][sensor]) {
            updatedData[platform][sensor] = [];
        }
        let geoJsonFile = "";
        
        // Check for orthomosaic versions using the new endpoint
        try {
            const response = await fetch(`${flaskUrl}/get_orthomosaic_versions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date,
                    platform,
                    sensor
                })
            });
            
            if (response.ok) {
                const versionsResponse = await response.json();
                
                if (versionsResponse && versionsResponse.length > 0) {
                    // Add each version as a separate entry
                    for (const version of versionsResponse) {
                        isGeojsonExist = true;
                        enableDownload = true;
                        geoJsonFile = `${flaskUrl}${version.path}`;
                        if (version.versionName === undefined){
                            continue;
                        }
                        updatedData[platform][sensor].push({
                            date, 
                            isGeojsonExist, 
                            enableDownload, 
                            geoJsonFile: geoJsonFile,
                            versionName: version.versionName,
                            versionType: version.versionType,
                            version: version.version
                        });
                    }
                }
            }
        } catch (error) {
            console.warn(`No orthomosaic versions found for ${date} ${platform} ${sensor}:`, error);
            
            // Fallback: check for traditional geojson files in sensor directory
            try {
                const processedFiles = await fetchData(
                    constructUrl('list_files/Processed', selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP, date, platform, sensor)
                );
                for (const file of processedFiles) {
                    if (file.endsWith(".geojson")) {
                        isGeojsonExist = true;
                        enableDownload = true;
                        geoJsonFile = constructUrl('files/Processed', selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP, date, platform, sensor, file);
                        
                        updatedData[platform][sensor].push({
                            date, 
                            isGeojsonExist, 
                            enableDownload, 
                            geoJsonFile: geoJsonFile,
                            versionName: 'Main',
                            versionType: 'legacy',
                            version: 'main'
                        });
                    }
                }
            } catch (fallbackError) {
                console.warn(`No processed files found for ${date} ${platform} ${sensor}:`, fallbackError);
                isGeojsonExist = false;
                setSubmitError(`Processed data not found for date ${date} and sensor ${sensor}`)
            }
        }
    }

    useEffect(() => {
        const fetchTableDataAndUpdate = async () => {
            if (selectedPopulationGCP) {
                try {
                    // Check for existing processed drone data
                    const dates = await fetchData(
                        constructUrl('list_dirs/Processed', selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP)
                    );
                    // reset sensor data
                    let updatedData = {};

                    // iterate through each data and check if images exists
                    for (const date of dates) {
                        //console.log("date:", date);
                        const platforms = await fetchData(
                            constructUrl('list_dirs/Processed', selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP, date)
                        );

                        for (const platform of platforms) {
                            // if (includedPlatforms.includes(platform)) {
                            const sensors = await fetchData(
                                constructUrl('list_dirs/Processed', selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP, date, platform)
                            );

                            for (const sensor of sensors) {
                                await fetchDataAndUpdate(date, platform, sensor, updatedData);
                            }
                            // }
                        }
                    }
                    //@TODO: Restructure the hierarchy to Dates -> Platforms -> Sensors -> Data
                    const processedData = Object.keys(updatedData).map((platform) => ({
                        title: platform,
                        nestedData: Object.keys(updatedData[platform]).map((sensor) => ({
                            summary: sensor,
                            data: updatedData[platform][sensor].map(item => constructRowData(item, tableColumns)),
                            columns: tableColumns,
                        })),
                    }));
                    setSensorData(processedData);
                } catch (error) {
                    console.error("Error fetching Raw data:", error);
                    setSubmitError("Could not fetch data from date ", error)
                }
            }
        };
        fetchTableDataAndUpdate();
    }, [selectedPopulationGCP]);

    

    return (
        <Grid container direction="column" alignItems="center" style={{ width: "80%", margin: "0 auto" }}>
            {sensorData && sensorData.length > 0 ? (
                <Typography variant="h4" component="h2" align="center" style={{ padding: '16px' }}>
                    Statistics
                </Typography>
            ) : (
                <Typography variant="h4" component="h2" align="center" style={{ padding: '16px' }}>
                    Use the ☰ button to select a dataset
                </Typography>
            )} 

            {/* <Box sx={{ padding: '10px', textAlign: 'center' }}>
                <Typography variant="body1" component="p">
                    Image datasets are organized by sensor type and date.
                </Typography>
                <Typography variant="body1" component="p">
                    Datasets with a checkmark have been processed into an orthomosaic.
                </Typography>
                <Typography variant="body1" component="p">
                    Click on a dataset to begin the process of ground control point identification.
                </Typography>
                <Typography variant="body1" component="p">
                    After labeling the final image, you will be able to initialize orthomosaic generation.
                </Typography>
            </Box> */}

            {sensorData && sensorData.length > 0 && (
                sensorData
                    // .filter((platformData) => includedPlatforms.includes(platformData.title))
                    .map((platformData) => (
                    <NestedSection
                        key={platformData.title}
                        title={platformData.title}
                        nestedData={platformData.nestedData.map((sensorData) => ({
                            summary: sensorData.summary,
                            data: sensorData.data,
                            columns: sensorData.columns,
                        }))}
                        activeTab={tableViewTabNo}
                        handleAction={null}
                        CustomComponent={CustomComponent}
                    />
                ))
            )}


            <Snackbar
                open={submitError !== ""}
                autoHideDuration={6000}
                onClose={() => setSubmitError("")}
                message={submitError}
            />
        </Grid>

 
    );
}

export default TableViewTab;