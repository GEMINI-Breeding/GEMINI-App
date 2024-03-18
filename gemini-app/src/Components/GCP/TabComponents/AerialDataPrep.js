import React, { useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import Grid from "@mui/material/Grid";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CircularProgress from "@mui/material/CircularProgress";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { NestedSection, FolderTab, FolderTabs } from "./Processing/CamerasAccordion";

import { useDataState, useDataSetters, fetchData } from "../../../DataContext";
import ImageViewer from "../ImageViewer";
import { useHandleProcessImages } from "../../Util/ImageViewerUtil";

import useTrackComponent from "../../../useTrackComponent";

function AerialDataPrep() {
    useTrackComponent("OrthoPrep");

    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedDateGCP,
        dateOptionsGCP,
        flaskUrl,
        imageList,
        isImageViewerOpen,
        selectedYearGCP,
        selectedExperimentGCP,
        selectedSensorGCP,
        selectedPlatformGCP,
        aerialPrepTab
    } = useDataState();

    const {
        setSelectedDateGCP,
        setDateOptionsGCP,
        setImageList,
        setGcpPath,
        setSidebarCollapsed,
        setTotalImages,
        setIsImageViewerOpen,
        setSelectedSensorGCP,
        setSelectedPlatformGCP,
    } = useDataSetters();

    // processing images and existing gcps
    const handleProcessImages = useHandleProcessImages();
    const selectedDateRef = useRef(selectedDateGCP);
    const [sensorData, setSensorData] = useState(null);
    const CustomComponent = {
        ortho: ImageViewer
    };

    // included aeriel-based platforms
    const includedPlatforms = ["Drone", "Phone"];

    // columns to render
    let columns = [
        { label: "Date", field: "date" },
        { label: "Orthomosaic", field: "ortho", actionType: "ortho", actionLabel: "Start" },
    ];

    // row data for nested section
    const constructRowData = (item, columns) => {
        const rowData = {};
        columns.forEach(column => {
            rowData[column.field] = item[column.field];
        });
        return rowData;
    };

    const handleOptionClick = (sensor, option) => {
        if (option.completed !== 2) {
            setSelectedDateGCP(option.label);
            setSelectedSensorGCP(sensor);
            setIsImageViewerOpen(true);
        }
    };

    useEffect(() => {
        console.log('sensorData has changed:', sensorData);
    }, [sensorData]);

    useEffect(() => {
        if (selectedDateRef.current !== selectedDateGCP) {
            handleProcessImages();
            selectedDateRef.current = selectedDateGCP;
        }
    }, [selectedDateGCP]);

    useEffect(() => {
        const fetchDataAndUpdate = async () => {
            if (selectedLocationGCP && selectedPopulationGCP) {
                try {
                    // check for existing raw drone data
                    const dates = await fetchData(
                        `${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`
                    );
                    // reset sensor data
                    let updatedData = {};

                    // iterate through each data and check if images exists
                    for (const date of dates) {
                        const folders = await fetchData(
                            `${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}`
                        );

                        // check if the 'Drone' folder exists
                        if (folders.includes("Drone") || folders.includes("Phone")) {
                            let platform = folders.includes("Drone") ? "Drone" : "Phone";
                            const sensors = await fetchData(
                                `${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/Drone`
                            );

                            for (const sensor of sensors) {
                                let ortho = 2; // Default to not completed

                                // Initialize sensor array if not already done
                                if (!updatedData[platform]) {
                                    updatedData[platform] = {};
                                }
                                if (!updatedData[platform][sensor]) {
                                    updatedData[platform][sensor] = [];
                                }

                                // check for Images folder
                                const imageFolders = await fetchData(
                                    `${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/Drone/${sensor}`
                                );

                                if (imageFolders.includes("Images")) {
                                    const images = await fetchData(
                                        `${flaskUrl}list_files/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/Drone/${sensor}/Images`
                                    );

                                    if (images.length === 0) {
                                        // if Images folder is empty
                                        ortho = 2;
                                    } else {
                                        try {
                                            const processedFiles = await fetchData(
                                                `${flaskUrl}list_files/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/Drone/${sensor}`
                                            );

                                            ortho = processedFiles.some((file) => file.endsWith(".tif")) ? true : false;
                                        } catch (error) {
                                            // if there's an error fetching processed files, or no .tif files found
                                            console.warn(
                                                `Processed data not found or error fetching processed data for date ${date} and sensor ${sensor}:`,
                                                error
                                            );
                                            ortho = false; // there are images, but no processed .tif files
                                        }
                                    }
                                } else {
                                    // if Images folder is not found
                                    ortho = 2;
                                }
                                // add entry with the determined 'ortho' status
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
                } catch (error) {
                    console.error("Error fetching Raw data:", error);
                }
            }
        };
        fetchDataAndUpdate();
    }, [selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP, flaskUrl, fetchData]);

    return (
        <Grid container direction="column" alignItems="center" style={{ width: "80%", margin: "0 auto" }}>
            <Typography variant="h4" component="h2" align="center">
                Aerial Datasets
            </Typography>

            <Box sx={{ padding: '10px', textAlign: 'center' }}>
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
            </Box>

            {sensorData && sensorData.length > 0 && (
                sensorData
                    .filter((platformData) => includedPlatforms.includes(platformData.title))
                    .map((platformData) => (
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
        </Grid>
    );
}

export default AerialDataPrep;
