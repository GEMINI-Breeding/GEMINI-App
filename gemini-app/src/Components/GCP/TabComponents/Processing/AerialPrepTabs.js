import React from "react";
import { Box, Grid, Typography } from "@mui/material";
import { useDataSetters, useDataState } from "../../../../DataContext";
import { NestedSection, FolderTab, FolderTabs } from "./CamerasAccordion";

import useTrackComponent from "../../../../useTrackComponent";

export default function AerialPrepTabs() {
    useTrackComponent("AerialPrep");

    const { aerialPrepTab } = useDataState();
    const { setAerialPrepTab } = useDataSetters();

    const handleChange = (event, newValue) => {
        setAerialPrepTab(newValue);
    };

    // Columns definition
    const columns = [
        { label: "Date", field: "date" },
        { label: "Orthomosaic", field: "ortho" },
        { label: "Labels", field: "labels" },
        { label: "Model", field: "model" },
    ];

    const iphoneData = [
        // RGB Camera accordion data
        {
            summary: "RGB Camera",
            data: [
                { date: "2022-06-20", ortho: true, labels: false, model: false },
                { date: "2022-07-25", ortho: true, labels: false, model: false },
                { date: "2022-08-01", ortho: true, labels: false, model: false },
            ],
            columns: columns,
        },
    ];

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
                        centered // This will center the tabs if the width of the tabs is less than the container
                    >
                        <FolderTab label="Label Traits" />
                        <FolderTab label="Teach Traits" />
                        <FolderTab label="Extract Traits" />
                    </FolderTabs>
                </Box>
                <Grid item container justifyContent="center">
                    <Box sx={{ width: "100%" }}>
                        {aerialPrepTab === 0 && (
                            <div>
                                <NestedSection
                                    title={"iPhone"}
                                    nestedData={iphoneData}
                                    activeTab={aerialPrepTab}
                                    trainModel={false}
                                />
                            </div>
                        )}
                        {aerialPrepTab === 1 && <div>Content for Tab 2</div>}
                        {aerialPrepTab === 2 && <div>Content for Tab 3</div>}
                        {aerialPrepTab === 3 && <div>Content for Tab 4</div>}
                    </Box>
                </Grid>
            </Grid>
        </Grid>
    );
}
