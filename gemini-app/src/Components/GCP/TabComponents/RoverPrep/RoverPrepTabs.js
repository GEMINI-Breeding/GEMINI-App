import React from "react";
import { Box, Grid, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import { useDataSetters, useDataState } from "../../../../DataContext";
import { NestedSection } from "./CamerasAccordion";

import useTrackComponent from "../../../../useTrackComponent";

// Custom styled component for the Tabs
const FolderTabs = styled(Tabs)({
    borderBottom: "1px solid #e0e0e0",
    "& .MuiTabs-indicator": {
        display: "none", // Hide the default indicator
    },
    justifyContent: "center", // Center the tabs
    flexGrow: 1,
    minWidth: 0,
});

// Custom styled component for the Tab
const FolderTab = styled(Tab)({
    textTransform: "none",
    fontWeight: "bold",
    marginRight: "4px", // Space between tabs
    color: "black",
    backgroundColor: "#f5f5f5", // Default non-selected background color
    "&.Mui-selected": {
        backgroundColor: "#fff", // Selected tab background color
        borderTop: "3px solid #000", // Mimic the folder divider look
        borderLeft: "1px solid #e0e0e0",
        borderRight: "1px solid #e0e0e0",
        borderBottom: "none", // This ensures the selected tab merges with the content area
        color: "black",
    },
    "&:hover": {
        backgroundColor: "#fff", // Hover background color
        opacity: 1,
    },
    borderRadius: "8px 8px 0 0", // Round the top corners
});

export default function NavTabs() {
    useTrackComponent("RoverPrep");

    const { roverPrepTab } = useDataState();
    const { setRoverPrepTab } = useDataSetters();

    const handleChange = (event, newValue) => {
        setRoverPrepTab(newValue);
    };

    // Columns definition
    const columns = [
        { label: "Date", field: "date" },
        { label: "Labels", field: "labels" },
        { label: "Model", field: "model" },
        { label: "Locations (Lat/Lon)", field: "location" },
    ];

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
        }
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
                        centered // This will center the tabs if the width of the tabs is less than the container
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
                                <NestedSection title={"Amiga"} nestedData={amigaData} activeTab={roverPrepTab} />
                                <NestedSection title={"iPhone"} nestedData={iphoneData} activeTab={roverPrepTab} />
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
