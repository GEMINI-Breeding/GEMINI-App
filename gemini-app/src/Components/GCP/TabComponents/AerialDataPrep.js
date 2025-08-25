import React, { useState, useEffect, useRef } from "react";
import { Box, Grid, Typography, Tabs, Tab, CircularProgress } from "@mui/material";
import { NestedSection } from "./Processing/CamerasAccordion";
import OrthoTable from '../../StatsMenu/OrthoTable';
import { useDataState, useDataSetters, fetchData } from "../../../DataContext";
import ImageViewer from "../ImageViewer";
import { useHandleProcessImages } from "../../Util/ImageViewerUtil";
import DynamicFeedIcon from '@mui/icons-material/DynamicFeed';
import ViewModuleIcon from '@mui/icons-material/ViewModule';

import useTrackComponent from "../../../useTrackComponent";
import Snackbar from "@mui/material/Snackbar";

function AerialDataPrep() {
    useTrackComponent("OrthoPrep");

    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedDateGCP,
        flaskUrl,
        selectedYearGCP,
        selectedExperimentGCP,
        selectedSensorGCP,
        selectedPlatformGCP,
        aerialPrepTab,
        isGCPReady,
        prepGcpFilePath,
        isImageViewerReady,
        isImageViewerOpen
    } = useDataState();

    const {
        setSelectedDateGCP,
        setIsImageViewerOpen,
        setSelectedSensorGCP,
        setImageIndex, // Reset image index to 0,
        setImageList,
    } = useDataSetters();

    const [submitError, setSubmitError] = useState("");
    const [activeTab, setActiveTab] = useState(0);
    const [loading, setLoading] = useState(true); // New loading state

    // processing images and existing gcps
    const handleProcessImages = useHandleProcessImages();
    const selectedDateRef = useRef(selectedDateGCP);
    const selectedExperimentRef = useRef(selectedExperimentGCP);
    const selectedSensorRef = useRef(selectedSensorGCP);
    const selectedPlatformRef = useRef(selectedPlatformGCP);
    const [sensorData, setSensorData] = useState(null);
    const CustomComponent = {
        ortho: ImageViewer,
        orthoTable: OrthoTable
    };

    // columns to render
    let columns = [
        { label: "Date", field: "date" },
        { label: "Orthomosaic", field: "ortho", actionType: "ortho", actionLabel: "Start" },
    ];

    const handleTabChange = (event, newValue) => {
        setActiveTab(newValue);
    };

    // row data for nested section
    const constructRowData = (item, columns) => {
        const rowData = {};
        columns.forEach(column => {
            rowData[column.field] = item[column.field];
        });
        return rowData;
    };

    useEffect(() => {
        console.log('sensorData has changed:', sensorData);
    }, [sensorData]);

    useEffect(() => {
        if (selectedDateRef.current !== selectedDateGCP || 
            selectedExperimentRef.current !== selectedExperimentGCP ||
            selectedSensorRef.current !== selectedSensorGCP ||
            selectedPlatformRef.current !== selectedPlatformGCP) {
            
            console.log("Selection changed - refreshing images:", {
                dateChange: `${selectedDateRef.current} -> ${selectedDateGCP}`,
                experimentChange: `${selectedExperimentRef.current} -> ${selectedExperimentGCP}`,
                sensorChange: `${selectedSensorRef.current} -> ${selectedSensorGCP}`,
                platformChange: `${selectedPlatformRef.current} -> ${selectedPlatformGCP}`
            });
            
            setImageIndex(0); // Reset image index to 0
            setImageList([]);
            handleProcessImages();
            
            // Update all refs to current values
            selectedDateRef.current = selectedDateGCP;
            selectedExperimentRef.current = selectedExperimentGCP;
            selectedSensorRef.current = selectedSensorGCP;
            selectedPlatformRef.current = selectedPlatformGCP;
        } else {
            console.log("No selection changes detected, skipping image processing.");
        }
    }, [isImageViewerReady, selectedDateGCP, selectedExperimentGCP, selectedSensorGCP, selectedPlatformGCP]);

    const handleOptionClick = (sensor, option) => {
        if (option.completed !== 2) {
            setSelectedDateGCP(option.label);
            setSelectedSensorGCP(sensor);
            setIsImageViewerOpen(true);
        }
    };

    useEffect(() => {
        const fetchDataAndUpdate = async () => {
            setLoading(true); // Start loading
            if (selectedLocationGCP && selectedPopulationGCP) {
                try {
                    const dates = await fetchData(
                        `${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`
                    );
                    let updatedData = {};

                    for (const date of dates) {
                        const platforms = await fetchData(
                            `${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}`
                        );

                        for (const platform of platforms) {

                            const sensors = await fetchData(
                                `${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}`
                            );

                            for (const sensor of sensors) {
                                let ortho = 2; 

                                if (!updatedData[platform]) {
                                    updatedData[platform] = {};
                                }
                                if (!updatedData[platform][sensor]) {
                                    updatedData[platform][sensor] = [];
                                }

                                const imageFolders = await fetchData(
                                    `${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}`
                                );

                                if (imageFolders.includes("Images")) {
                                    
                                    // list folders inside the Images directory
                                    const imageSubfolders = await fetchData(
                                    `${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/Images`
                                    );

                                    // check if "top" folder exists inside Images
                                    let images;
                                    if (imageSubfolders.includes("top")) {
                                    console.log(`Top folder exists for date ${date} and sensor ${sensor}. Only looking at top view.`);
                                    images = await fetchData(
                                        `${flaskUrl}list_files/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/Images/top`
                                    );
                                    } else {
                                    // fallback
                                    images = await fetchData(
                                        `${flaskUrl}list_files/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/Images`
                                    );
                                    }

                                    if (images.length === 0) {
                                        console.warn(
                                            `No images found for date ${date} and sensor ${sensor}.`
                                        );
                                        ortho = 2;
                                    } else {
                                        try {
                                            const processedFiles = await fetchData(
                                                `${flaskUrl}list_files/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}`
                                            );

                                            ortho = processedFiles.some((file) => file.endsWith(".tif")) ? true : false;
                                        } catch (error) {
                                            console.warn(
                                                `Processed data not found or error fetching processed data for date ${date} and sensor ${sensor}:`,
                                                error
                                            );
                                            ortho = false;
                                        }
                                    }
                                } else {
                                    ortho = 2;
                                }

                                updatedData[platform][sensor].push({ date, ortho });
                            }
                        }
                    }
                    const processedData = Object.keys(updatedData).map((platform) => ({
                        title: platform,
                        nestedData: Object.keys(updatedData[platform]).map((sensor) => ({
                            summary: sensor,
                            data: updatedData[platform][sensor].map(item => constructRowData(item, columns)),
                            columns: columns,
                        })),
                    }));
                    setSensorData(processedData);
                    console.log("Processed sensor data:", processedData);
                } catch (error) {
                    console.error("Error fetching Raw data:", error);
                    setSubmitError("Could not fetch data from date ", error);
                } finally {
                    setLoading(false); // Stop loading
                }
            }
        };
        fetchDataAndUpdate();
    }, [selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP, flaskUrl, fetchData]);

    const titleStyle = {
        fontSize: "1.25rem", // Adjust for desired size
        fontWeight: "normal",
        textAlign: "center",
    };

    return (
        <Grid container direction="column" alignItems="center" style={{ width: "80%", margin: "0 auto" }}>
            {loading ? (
                <Box
                    sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        height: '100vh',
                        flexDirection: 'column',
                    }}
                >
                    <CircularProgress />
                    <Typography variant="h6" sx={{ marginTop: 2 }}>
                        Loading data...
                    </Typography>
                </Box>
            ) : (
                <>
                    <Grid item alignItems="center" alignSelf="center" style={{ width: "80%", paddingTop: "0px" }}>
                        <Tabs 
                            value={activeTab} 
                            onChange={handleTabChange} 
                            aria-label="mosaic tabs" 
                            sx={{ marginBottom: 2 }} 
                            centered 
                            variant="fullWidth"
                        >
                            <Tab 
                                value={0}
                                label="Generate Mosaics" 
                                style={titleStyle}
                                icon={<DynamicFeedIcon />}
                                iconPosition="start"
                            />
                            <Tab 
                                value={1}
                                label="Manage Mosaics" 
                                style={titleStyle}
                                icon={<ViewModuleIcon />}
                                iconPosition="start"
                            />
                        </Tabs>
                    </Grid>

                    <Box sx={{ width: '100%', marginTop: 0.5 }}>
                        {activeTab === 0 && (
                            <>
                                {sensorData && sensorData.length > 0 && isGCPReady && (
                                    sensorData.map((platformData) => (
                                        <NestedSection
                                            key={platformData.title}
                                            title={platformData.title}
                                            nestedData={platformData.nestedData.map((sensorData) => ({
                                                summary: sensorData.summary,
                                                data: sensorData.data,
                                                columns: sensorData.columns,
                                            }))}
                                            activeTab={aerialPrepTab}
                                            handleAction={null}
                                            CustomComponent={CustomComponent}
                                        />
                                    ))
                                )}
                            </>
                        )}

                        {activeTab === 1 && (
                            <OrthoTable />
                        )}
                    </Box>
                </>
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

export default AerialDataPrep;
