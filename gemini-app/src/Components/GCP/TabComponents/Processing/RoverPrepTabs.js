import React, { useEffect, useState } from "react";
import { Box, Grid, Typography } from "@mui/material";
import { useDataSetters, useDataState, fetchData } from "../../../../DataContext";
import { NestedSection, FolderTab, FolderTabs } from "./CamerasAccordion";
import { TrainMenu } from "./TrainModel"; // Import TrainMenu
import { LocateMenu } from "./LocatePlants"; // Import LocateMenu

import useTrackComponent from "../../../../useTrackComponent";

export default function RoverPrepTabs() {
    useTrackComponent("RoverPrep");

    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedYearGCP,
        selectedExperimentGCP,
        flaskUrl,
        roverPrepTab,
    } = useDataState();
    const { setRoverPrepTab } = useDataSetters();

    const [sensorData, setSensorData] = useState(null);

    const CustomComponent = {
        train: TrainMenu,
        locate: LocateMenu,
    };

    const columns = [
        { label: "Date", field: "date" },
        { label: "Labels", field: "labels" },
        { label: "Model", field: "model", actionType: "train", actionLabel: "Start" },
        { label: "Locations (Lat/Lon)", field: "location", actionType: "locate", actionLabel: "Start" },
    ];

    useEffect(() => {
        const fetchDataAndUpdate = async () => {
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
                                if (!updatedData[platform]) {
                                    updatedData[platform] = {};
                                }
                                if (!updatedData[platform][sensor]) {
                                    updatedData[platform][sensor] = [];
                                }

                                let labels = 2; // Assume no folder for the sensor initially
                                let model = true; // Assume model and location are true if sensor is listed
                                let location = true;

                                try {
                                    const files = await fetchData(
                                        `${flaskUrl}list_files/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}`
                                    );

                                    if (files.length === 0) {
                                        // No files found in the folder, implying no XML labels
                                        labels = 0;
                                    } else {
                                        // Check if any of the files end with .xml for labels
                                        labels = files.some((file) => file.endsWith(".xml")) ? 1 : 0;
                                    }
                                } catch (error) {
                                    console.warn(
                                        `Error fetching processed data for ${date}, ${platform}, ${sensor}:`,
                                        error
                                    );
                                    // If there's an error fetching the data, it could mean there's no folder for the sensor
                                    // In this case, labels should remain 2, model and location remain true
                                }

                                updatedData[platform][sensor].push({ date, labels, model, location });
                            }
                        }
                    }

                    const processedData = Object.keys(updatedData).map((platform) => ({
                        title: platform,
                        nestedData: Object.keys(updatedData[platform]).map((sensor) => ({
                            summary: sensor,
                            data: updatedData[platform][sensor].map(({ date, labels, model, location }) => ({
                                date,
                                labels,
                                model,
                                location,
                            })),
                            columns: columns,
                        })),
                    }));

                    setSensorData(processedData);
                } catch (error) {
                    console.error("Error fetching data:", error);
                }
            }
        };

        fetchDataAndUpdate();
    }, [selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP, flaskUrl, roverPrepTab]);

    const handleChange = (event, newValue) => {
        setRoverPrepTab(newValue);
    };

    const handleAction = (item, column) => {
        console.log("Action triggered for:", item, column);
    };

    const includedPlatforms = ["Rover", "Amiga-Onboard"];

    return (
        <Grid container direction="column" alignItems="center" style={{ width: "80%", margin: "0 auto" }}>
            <Typography variant="h4" component="h2" align="center">
                Ground Data Preparation
            </Typography>
            <br />
            <Grid item style={{ width: "100%" }}>
                <Box
                    sx={{
                        flexGrow: 1,
                        bgcolor: "background.paper",
                        display: "flex",
                        justifyContent: "center",
                        height: "auto",
                    }}
                >
                    <FolderTabs
                        value={roverPrepTab}
                        onChange={handleChange}
                        aria-label="styled tabs example"
                        variant="fullWidth"
                        scrollButtons="auto"
                        centered
                    >
                        <FolderTab label="Locate Plants" />
                        <FolderTab label="Label Traits" />
                        <FolderTab label="Teach Traits" />
                        <FolderTab label="Extract Traits" />
                    </FolderTabs>
                </Box>
                <Grid item container justifyContent="center">
                    <Box sx={{ width: "100%" }}>
                        {roverPrepTab === 0 && sensorData && (
                            <div>
                                {sensorData
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
                                            activeTab={roverPrepTab}
                                            handleAction={null}
                                            CustomComponent={CustomComponent}
                                        />
                                    ))}
                            </div>
                        )}
                        {roverPrepTab > 0 && <div>Content for other tabs coming soon!</div>}
                    </Box>
                </Grid>
            </Grid>
        </Grid>
    );
}
