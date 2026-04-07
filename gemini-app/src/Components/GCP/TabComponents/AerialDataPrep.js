import React, { useState, useEffect, useRef } from "react";
import { Box, Grid, Typography, Tabs, Tab, CircularProgress } from "@mui/material";
import { NestedSection } from "./Processing/CamerasAccordion";
import OrthoTable from '../../StatsMenu/OrthoTable';
import { useDataState, useDataSetters } from "../../../DataContext";
import { listDirs, listFiles } from "../../../api/files";
import ImageViewer from "../ImageViewer";
import { useHandleProcessImages } from "../../Util/ImageViewerUtil";
import DynamicFeedIcon from '@mui/icons-material/DynamicFeed';
import ViewModuleIcon from '@mui/icons-material/ViewModule';

import useTrackComponent from "../../../useTrackComponent";

function AerialDataPrep() {
    useTrackComponent("OrthoPrep");

    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedDateGCP,
        selectedYearGCP,
        selectedExperimentGCP,
        selectedSensorGCP,
        selectedPlatformGCP,
        aerialPrepTab,
        isGCPReady,
        prepGcpFilePath,
        isImageViewerReady,
        isImageViewerOpen,
        isOrthoProcessing
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
    const [loading, setLoading] = useState(true);
    const [refreshKey, setRefreshKey] = useState(0);

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
            if (!selectedLocationGCP || !selectedPopulationGCP) {
                setLoading(false);
                return;
            }
            setLoading(true);
            try {
                    const dates = await listDirs(
                        `${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`
                    );
                    let updatedData = {};

                    for (const date of dates) {
                        const platforms = await listDirs(
                            `${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}`
                        );

                        for (const platform of platforms) {

                            const sensors = await listDirs(
                                `${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}`
                            );

                            for (const sensor of sensors) {
                                let ortho = 2; 

                                if (!updatedData[platform]) {
                                    updatedData[platform] = {};
                                }
                                if (!updatedData[platform][sensor]) {
                                    updatedData[platform][sensor] = [];
                                }

                                const imageFolders = await listDirs(
                                    `${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}`
                                );

                                if (imageFolders.includes("Images")) {
                                    // Check if there are any images without actually loading them
                                    // const imageSubfolders = await fetchData(
                                    //     `${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/Images`
                                    // );

                                    // // Just check if top folder exists, don't load files yet
                                    // let hasImages = false;
                                    // if (imageSubfolders.includes("top")) {
                                    //     console.log(`Top folder exists for date ${date} and sensor ${sensor}.`);
                                    //     // We assume if top folder exists, it has images
                                    //     hasImages = true;
                                    // } else {
                                    //     // Check if Images folder has any content (could be files or subfolders)
                                    //     hasImages = imageSubfolders.length > 0;
                                    // }
                                    let hasImages = true;

                                    if (!hasImages) {
                                        console.warn(
                                            `No images found for date ${date} and sensor ${sensor}.`
                                        );
                                        ortho = 2;
                                    } else {
                                        try {
                                            const processedFiles = await listFiles(
                                                `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}`
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
                    console.error("Error fetching data:", error);
                    setSubmitError("Could not fetch data: " + error.message);
                } finally {
                    setLoading(false);
                }
        };
        if (activeTab === 0) {
            fetchDataAndUpdate();
        }
    }, [selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP, activeTab, refreshKey]);

    // Increment refreshKey when ortho processing finishes (user clicks DONE)
    // so the checkbox replaces the Start button without manual navigation
    const prevOrthoProcessing = useRef(isOrthoProcessing);
    useEffect(() => {
        if (prevOrthoProcessing.current && !isOrthoProcessing) {
            setRefreshKey(k => k + 1);
        }
        prevOrthoProcessing.current = isOrthoProcessing;
    }, [isOrthoProcessing]);

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
                                {sensorData && sensorData.length > 0 ? (
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
                                ) : (
                                    <Typography variant="body1" sx={{ textAlign: 'center', mt: 4, color: 'text.secondary' }}>
                                        No image data found for this experiment. Upload drone images first via Prepare → Upload.
                                    </Typography>
                                )}
                            </>
                        )}

                        {activeTab === 1 && (
                            <OrthoTable />
                        )}
                    </Box>
                </>
            )}

            {submitError && (
                <Typography variant="body2" color="error" sx={{ textAlign: 'center', mt: 2 }}>
                    {submitError}
                </Typography>
            )}
        </Grid>
    );
}

export default AerialDataPrep;