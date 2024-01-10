import React, { useEffect, useRef } from "react";
import Grid from "@mui/material/Grid";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

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
        radiusMeters,
        isSidebarCollapsed,
        imageList,
        isImageViewerOpen,
    } = useDataState();

    const {
        setSelectedLocationGCP,
        setSelectedPopulationGCP,
        setSelectedDateGCP,
        setDateOptionsGCP,
        setImageList,
        setGcpPath,
        setSidebarCollapsed,
        setTotalImages,
        setIsImageViewerOpen,
    } = useDataSetters();

    const handleProcessImages = useHandleProcessImages();

    // Create a ref for the selected date
    const selectedDateRef = useRef(selectedDateGCP);

    useEffect(() => {
        const fetchDataAndUpdate = async () => {
            if (selectedLocationGCP && selectedPopulationGCP) {
                try {
                    const dates = await fetchData(
                        `${flaskUrl}list_dirs/Raw/${selectedLocationGCP}/${selectedPopulationGCP}`
                    );

                    const orthoCheckPromises = dates.map(async (date) => {
                        const files = await fetchData(
                            `${flaskUrl}list_files/Processed/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/Drone`
                        );
                        return files.some((file) => file.endsWith("Pyramid.tif"));
                    });

                    const isOrthoGenerated = await Promise.all(orthoCheckPromises);

                    const updatedDates = dates.map((date, index) => ({
                        label: date,
                        completed: isOrthoGenerated[index],
                    }));

                    setDateOptionsGCP(updatedDates);
                } catch (error) {
                    console.error("Error:", error);
                }
            }
        };

        fetchDataAndUpdate();
    }, [selectedLocationGCP, selectedPopulationGCP]);

    const handleOptionClick = (option) => {
        // Set date to option.label
        setSelectedDateGCP(option.label);
        setIsImageViewerOpen(true);
        console.log("Selected date", selectedDateGCP);
    };

    // Check to see if the selected date has changed from the ref
    // and if it has, then run the handleProcessImages function
    useEffect(() => {
        if (selectedDateRef.current !== selectedDateGCP) {
            handleProcessImages();
            selectedDateRef.current = selectedDateGCP;
        }
    }, [selectedDateGCP]);

    if (imageList.length > 0 && isImageViewerOpen) {
        console.log("imageList", imageList);
        console.log("imageList[0].image_path", imageList[0].image_path);
        console.log(selectedDateGCP, selectedLocationGCP, selectedPopulationGCP);

        return (
            <Grid container direction="column" alignItems="center" style={{ width: "80%", margin: "0 auto" }}>
                <ImageViewer />
            </Grid>
        );
    }

    return (
        <Grid container direction="column" alignItems="center" style={{ width: "50%", margin: "0 auto" }}>
            <Typography variant="h4" component="h2" align="center">
                Aerial Datasets
            </Typography>

            {/* RGB Section */}
            <Typography variant="h6" component="h3" align="center" style={{ marginTop: "20px" }}>
                RGB
            </Typography>
            <List style={{ width: "100%" }}>
                {dateOptionsGCP.map((option, index) => (
                    <div key={"rgb-" + index}>
                        <ListItemButton onClick={() => handleOptionClick(option)}>
                            <Grid container alignItems="center">
                                <Grid item xs={10}>
                                    <ListItemText
                                        primary={option.label}
                                        primaryTypographyProps={{ fontSize: "1.25rem" }}
                                    />
                                </Grid>
                                <Grid item xs={2}>
                                    {option.completed && <CheckCircleIcon style={{ color: "green" }} />}
                                </Grid>
                            </Grid>
                        </ListItemButton>
                        {index !== dateOptionsGCP.length - 1 && <Divider />}
                    </div>
                ))}
            </List>
        </Grid>
    );
}

export default AerialDataPrep;
