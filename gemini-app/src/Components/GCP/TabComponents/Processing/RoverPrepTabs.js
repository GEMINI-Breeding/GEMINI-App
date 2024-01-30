import React, { useEffect, useState } from "react";
import { Box, Grid, Typography } from "@mui/material";
import { useDataSetters, useDataState } from "../../../../DataContext";
import { NestedSection, FolderTab, FolderTabs } from "./CamerasAccordion";
import { TrainMenu } from "./TrainModel"; // Import TrainMenu
import LocateMenu from "./LocatePlants"; // Import LocateMenu

import useTrackComponent from "../../../../useTrackComponent";

export default function RoverPrepTabs() {
    useTrackComponent("RoverPrep");

    const { roverPrepTab } = useDataState();
    const { setRoverPrepTab } = useDataSetters();

    const CustomComponent = {
        train: TrainMenu,
        locate: LocateMenu,
    };

    const handleChange = (event, newValue) => {
        setRoverPrepTab(newValue);
    };

    // Columns definition
    const columns = [
        { label: "Date", field: "date" },
        { label: "Labels", field: "labels" },
        { label: "Model", field: "model", actionType: "train", actionLabel: "Start" }, // Added actionType and actionLabel
        { label: "Locations (Lat/Lon)", field: "location", actionType: "locate", actionLabel: "Start" },
    ];

    // Action handler
    const handleAction = (item, column) => {
        console.log("Action triggered for:", item, column);
        // Define what should happen when the button is clicked
        // This is not needed if all that should happen is for
        // the custom component to be rendered
    };

    const amigaData = [
        // RGB Camera accordion data
        {
            summary: "RGB Camera",
            data: [
                { date: "2022-06-20", labels: true, model: false, location: false },
                { date: "2022-07-25", labels: true, model: false, location: false },
                { date: "2022-08-01", labels: true, model: false, location: false },
            ],
            columns: columns,
        },
    ];

    const iphoneData = [
        // RGB Camera accordion data
        {
            summary: "RGB Camera",
            data: [
                { date: "2022-06-20", labels: true, model: false, location: false },
                { date: "2022-07-25", labels: true, model: false, location: false },
                { date: "2022-08-01", labels: true, model: false, location: false },
            ],
            columns: columns,
        },
    ];

    return (
        <Grid container direction="column" alignItems="center" style={{ width: "80%", margin: "0 auto" }}>
            <Typography variant="h4" component="h2" align="center">
                Rover Data Preparation
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
                        {roverPrepTab === 0 && (
                            <div>
                                <NestedSection
                                    title={"Amiga"}
                                    nestedData={amigaData}
                                    activeTab={roverPrepTab}
                                    handleAction={null}
                                    CustomComponent={CustomComponent}
                                />
                                <NestedSection
                                    title={"iPhone"}
                                    nestedData={iphoneData}
                                    activeTab={roverPrepTab}
                                    handleAction={null}
                                    CustomComponent={CustomComponent}
                                />
                            </div>
                        )}
                        {roverPrepTab === 1 && <div>Content for Tab 2</div>}
                        {roverPrepTab === 2 && <div>Content for Tab 3</div>}
                        {roverPrepTab === 3 && <div>Content for Tab 4</div>}
                    </Box>
                </Grid>
            </Grid>
        </Grid>
    );
}
