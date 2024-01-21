import React from "react";
import { Box, Grid, Typography } from "@mui/material";
import { useDataSetters, useDataState } from "../../../../DataContext";
import { NestedSection, FolderTab, FolderTabs } from "./CamerasAccordion";
import AskAnalyzeModal from "./AskAnalyzeModal"; // Import AskAnalyzeModal

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
        { label: "Traits", field: "traits" },
        { label: "Process", field: "process", actionType: "process", actionLabel: "Process" },
    ];

    // Action handler
    const handleAction = (item, column) => {
        console.log("Action triggered for:", item, column);
        // Define what should happen when the button is clicked
    };

    const iphoneData = [
        {
            summary: "RGB Camera",
            data: [
                { date: "2022-06-20", ortho: true, traits: "[]", process: false },
                { date: "2022-07-25", ortho: true, traits: "[]", process: false },
                { date: "2022-08-01", ortho: true, traits: "[]", process: false },
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
                        centered
                    >
                        <FolderTab label="Aerial Traits" />
                        <FolderTab label="Teach Traits" />
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
                                    handleAction={null}
                                    CustomComponent={AskAnalyzeModal}
                                />
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
