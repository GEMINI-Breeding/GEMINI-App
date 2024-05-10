import React, { useState } from "react";
import Grid from "@mui/material/Grid";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";

import { useDataState, useDataSetters } from "../../DataContext";

import PlotBoundaryPrep from "./TabComponents/PlotBoundaryPrep";
import AerialDataPrep from "./TabComponents/AerialDataPrep";

import useTrackComponent from "../../useTrackComponent";
import RoverPrepTabs from "./TabComponents/Processing/RoverPrepTabs";
import AerialPrepTabs from "./TabComponents/Processing/AerialPrepTabs";

function TabbedPrepUI() {
    useTrackComponent("TabbedPrepUI");

    const {
        locationOptionsGCP,
        selectedLocationGCP,
        populationOptionsGCP,
        selectedPopulationGCP,
        dateOptionsGCP,
        selectedDateGCP,
        radiusMeters,
        flaskUrl,
        gcpPath,
        isSidebarCollapsed,
        isPrepInitiated,
        selectedTabPrep,
    } = useDataState();

    const {
        setLocationOptionsGCP,
        setSelectedLocationGCP,
        setPopulationOptionsGCP,
        setSelectedPopulationGCP,
        setDateOptionsGCP,
        setSelectedDateGCP,
        setImageList,
        setGcpPath,
        setSidebarCollapsed,
        setTotalImages,
        setSelectedTabPrep,
    } = useDataSetters();

    const handleChange = (event, newValue) => {
        setSelectedTabPrep(newValue);
    };

    const titleStyle = {
        fontSize: "1.25rem", // Adjust for desired size
        fontWeight: "normal",
        textAlign: "center",
    };

    return (
        <Grid container direction="column" style={{ width: "100%", height: "100%" }}>
            {isPrepInitiated && (
                <Grid item alignItems="center" alignSelf="center" style={{ width: "80%" }}>
                    <Tabs value={selectedTabPrep} onChange={handleChange} centered variant="fullWidth">
                        <Tab label="Orthomosaic Generation" style={titleStyle} />
                        <Tab label="Plot Boundary Preparation" style={titleStyle} />
                        <Tab label="Aerial Processing" style={titleStyle} />
                        <Tab label="Ground-based Processing" style={titleStyle} />
                    </Tabs>
                </Grid>
            )}
            {isPrepInitiated && (
                <Grid item container style={{ flexGrow: 1, overflow: "auto" }}>
                    {selectedTabPrep === 0 && <AerialDataPrep />}
                    {selectedTabPrep === 1 && <PlotBoundaryPrep />}
                    {selectedTabPrep === 2 && <AerialPrepTabs />}
                    {selectedTabPrep === 3 && <RoverPrepTabs />}
                </Grid>
            )}
        </Grid>
    );
}

export default TabbedPrepUI;
