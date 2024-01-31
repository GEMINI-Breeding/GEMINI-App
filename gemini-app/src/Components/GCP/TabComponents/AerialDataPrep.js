import React, { useEffect, useRef, useState } from "react";
import Grid from "@mui/material/Grid";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CircularProgress from "@mui/material/CircularProgress";

import { useDataState, useDataSetters, fetchData } from "../../../DataContext";
import ImageViewer from "../ImageViewer";
import { useHandleProcessImages } from "../../Util/ImageViewerUtil";

import useTrackComponent from "../../../useTrackComponent";

function AerialDataPrep() {
    useTrackComponent("AerialDataPrep");

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

    const handleProcessImages = useHandleProcessImages();

    const selectedDateRef = useRef(selectedDateGCP);
    const [sensorData, setSensorData] = useState({});

    useEffect(() => {
        const fetchDataAndUpdate = async () => {
            if (selectedLocationGCP && selectedPopulationGCP) {
                try {
                    const dates = await fetchData(
                        `${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`
                    );

                    let updatedSensorData = {};

                    for (const date of dates) {
                        const folders = await fetchData(
                            `${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}`
                        );

                        // Check if the 'Drone' folder exists
                        if (folders.includes("Drone")) {
                            const sensors = await fetchData(
                                `${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/Drone`
                            );

                            for (const sensor of sensors) {
                                try {
                                    const files = await fetchData(
                                        `${flaskUrl}list_files/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/Drone/${sensor}`
                                    );
                                    const completed = files.some((file) => file.endsWith("Pyramid.tif"));

                                    if (!updatedSensorData[sensor]) {
                                        updatedSensorData[sensor] = [];
                                    }
                                    updatedSensorData[sensor].push({ label: date, completed });
                                } catch (error) {
                                    console.warn(
                                        `Error fetching processed data for date ${date} and sensor ${sensor}:`,
                                        error
                                    );
                                }
                            }
                        }
                    }

                    setSensorData(updatedSensorData);
                } catch (error) {
                    console.error("Error fetching Raw data:", error);
                }
            }
        };

        fetchDataAndUpdate();
    }, [selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP, flaskUrl, fetchData]);

    const handleOptionClick = (sensor, option) => {
        setSelectedDateGCP(option.label);
        setSelectedSensorGCP(sensor);
        setIsImageViewerOpen(true);
    };

    useEffect(() => {
        if (selectedDateRef.current !== selectedDateGCP) {
            handleProcessImages();
            selectedDateRef.current = selectedDateGCP;
        }
    }, [selectedDateGCP]);

    if (imageList.length > 0 && isImageViewerOpen) {
        return (
            <Grid container direction="column" alignItems="center" style={{ width: "80%", margin: "0 auto" }}>
                <ImageViewer />
            </Grid>
        );
    } else if (isImageViewerOpen) {
        // Return a curcular loading indicator in the center of the page
        return (
            <Grid container direction="column" alignItems="center" style={{ width: "80%", margin: "0 auto" }}>
                <Grid item style={{ marginTop: "50px" }}>
                    <CircularProgress />
                </Grid>
            </Grid>
        );
    }

    return (
        <Grid container direction="column" alignItems="center" style={{ width: "80%", margin: "0 auto" }}>
            <Typography variant="h4" component="h2" align="center">
                Aerial Datasets
            </Typography>

            <Typography variant="body1" component="p" align="left" style={{ marginTop: "20px" }}>
                Image datasets are organized by sensor type and date. datasets with a checkmark have been processed into
                an orthomosaic. Click on a dataset to begin the process of ground control point identification. After
                labeling the final image, you will be able to initialize orthomosaic generation.
            </Typography>

            {Object.keys(sensorData).map((sensor) => (
                <div key={sensor} style={{ width: "50%" }}>
                    <Typography variant="h6" component="h3" align="center" style={{ marginTop: "20px" }}>
                        {sensor}
                    </Typography>
                    <List style={{ width: "100%" }}>
                        {sensorData[sensor].map((option, index) => (
                            <div key={sensor + "-" + index}>
                                <ListItemButton onClick={() => handleOptionClick(sensor, option)}>
                                    <Grid container alignItems="center">
                                        <Grid item style={{ width: "calc(100% - 64px)" }}>
                                            {" "}
                                            {/* Adjusted width to leave space for the checkmark */}
                                            <ListItemText
                                                primary={option.label}
                                                primaryTypographyProps={{ fontSize: "1.25rem" }}
                                            />
                                        </Grid>
                                        <Grid item>
                                            {option.completed && (
                                                <CheckCircleIcon style={{ color: "green", marginLeft: "24px" }} />
                                            )}{" "}
                                            {/* Added margin here */}
                                        </Grid>
                                    </Grid>
                                </ListItemButton>
                                {index !== sensorData[sensor].length - 1 && <Divider />}
                            </div>
                        ))}
                    </List>
                </div>
            ))}
        </Grid>
    );
}

export default AerialDataPrep;
