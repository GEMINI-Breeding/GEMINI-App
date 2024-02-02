import React, { useEffect, useState } from "react";
import { Box, Grid, Typography } from "@mui/material";
import { useDataSetters, useDataState, fetchData } from "../../../../DataContext";
import { NestedSection, FolderTab, FolderTabs } from "./CamerasAccordion";
import AskAnalyzeModal from "./AskAnalyzeModal";

import useTrackComponent from "../../../../useTrackComponent";

export default function AerialPrepTabs() {
    useTrackComponent("AerialPrep");

    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedYearGCP,
        selectedExperimentGCP,
        flaskUrl,
        aerialPrepTab,
    } = useDataState();

    const { setAerialPrepTab } = useDataSetters();

    const [sensorData, setSensorData] = useState(null);

    // Columns definition
    const columns = [
        { label: "Date", field: "date" },
        { label: "Orthomosaic", field: "ortho" },
        { label: "Traits", field: "traits" },
        { label: "Process", field: "process", actionType: "process", actionLabel: "Process" },
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

                                // Assume the entry is not completed by default
                                let completed = false;

                                // Try to fetch processed files to check if completed
                                try {
                                    const files = await fetchData(
                                        `${flaskUrl}list_files/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}`
                                    );
                                    completed = files.some((file) => file.endsWith(".tif"));
                                } catch (error) {
                                    console.warn(
                                        `Processed data not found or error fetching processed data for date ${date}, platform ${platform}, and sensor ${sensor}:`,
                                        error
                                    );
                                }

                                // Always add the entry, but completed status depends on processed files check
                                updatedData[platform][sensor].push({ date, completed });
                            }
                        }
                    }

                    // Convert the updatedData object to an array format suitable for rendering
                    const processedData = Object.keys(updatedData).map((platform) => ({
                        title: platform,
                        nestedData: Object.keys(updatedData[platform]).map((sensor) => ({
                            summary: sensor,
                            data: updatedData[platform][sensor].map(({ date, completed }) => ({
                                date,
                                ortho: completed,
                                traits: "[]", // Placeholder for traits data
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
    }, [selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP, flaskUrl, fetchData]);

    console.log("sensorData", sensorData);

    const CustomComponent = {
        process: AskAnalyzeModal,
    };

    const handleChange = (event, newValue) => {
        setAerialPrepTab(newValue);
    };

    // Action handler
    const handleAction = (item, column) => {
        console.log("Action triggered for:", item, column);
        // Define what should happen when the button is clicked
    };

    const includedPlatforms = ["Drone"];

    return (
        <Grid container direction="column" alignItems="center" style={{ width: "80%", margin: "0 auto" }}>
            <Typography variant="h4" component="h2" align="center">
                Aerial Data Preparation
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
                        value={aerialPrepTab}
                        onChange={handleChange}
                        aria-label="styled tabs example"
                        variant="fullWidth"
                        scrollButtons="auto"
                        centered
                    >
                        <FolderTab label="Aerial Traits" />
                        <FolderTab label="Teach Traits" />
                    </FolderTabs>
                </Box>
                <Grid item container justifyContent="center">
                    <Box sx={{ width: "100%" }}>
                        {aerialPrepTab === 0 && sensorData && (
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
                                            activeTab={aerialPrepTab}
                                            handleAction={null}
                                            CustomComponent={CustomComponent}
                                        />
                                    ))}
                            </div>
                        )}
                        {aerialPrepTab === 1 && (
                            <div style={{ textAlign: "center", verticalAlign: "middle" }}>
                                <h4>Trainable aerial data models coming soon!</h4>
                            </div>
                        )}
                    </Box>
                </Grid>
            </Grid>
        </Grid>
    );
}
