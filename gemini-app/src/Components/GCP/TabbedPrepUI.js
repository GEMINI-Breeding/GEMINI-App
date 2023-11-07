import React, { useState } from "react";
import Grid from "@mui/material/Grid";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";

import { useDataState, useDataSetters } from "../../DataContext";

import PlotBoundaryPrep from "./TabComponents/PlotBoundaryPrep";
import AerialDataPrep from "./TabComponents/AerialDataPrep";

function TabbedPrepUI() {
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
    } = useDataSetters();

    const [selectedTab, setSelectedTab] = useState(0);

    const handleChange = (event, newValue) => {
        setSelectedTab(newValue);
    };

    const titleStyle = {
        fontSize: "1.25rem", // Adjust for desired size
        fontWeight: "normal",
        textAlign: "center",
    };

    return (
        <Grid container direction="column" style={{ width: "100%", height: "100%" }}>
            {isPrepInitiated && (
                <Grid item>
                    <Tabs value={selectedTab} onChange={handleChange} centered variant="fullWidth">
                        <Tab label="Plot Boundary Preparation" style={titleStyle} />
                        <Tab label="Aerial Data Preparation" style={titleStyle} />
                        <Tab label="Ground-based Data Preparation" style={titleStyle} />
                    </Tabs>
                </Grid>
            )}
            {isPrepInitiated && (
                <Grid item container style={{ flexGrow: 1, overflow: "auto" }}>
                    {selectedTab === 0 && <PlotBoundaryPrep />}
                    {selectedTab === 1 && <AerialDataPrep />}
                    {selectedTab === 2 && <div>Component for Tab 3</div>}
                </Grid>
            )}
        </Grid>
    );
}

export default TabbedPrepUI;
