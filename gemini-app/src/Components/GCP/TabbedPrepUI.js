import React, { useState } from "react";
import Grid from "@mui/material/Grid";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import DynamicFeedIcon from '@mui/icons-material/DynamicFeed';
import EditRoadIcon from '@mui/icons-material/EditRoad';
import QueryStatsIcon from '@mui/icons-material/QueryStats';

import { useDataState, useDataSetters } from "../../DataContext";

import PlotBoundaryPrep from "./TabComponents/PlotBoundaryPrep";
import AerialDataPrep from "./TabComponents/AerialDataPrep";
import Processing from "./TabComponents/Processing";

import useTrackComponent from "../../useTrackComponent";
import AerialPrepTabs from "./TabComponents/Processing/AerialPrepTabs";

function TabbedPrepUI({ selectedTab = null }) {
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

    // Use the selectedTab prop if provided, otherwise use the context state
    const activeTab = selectedTab !== null ? selectedTab : selectedTabPrep;

    const handleChange = (event, newValue) => {
        // Only update the context state if no selectedTab prop is provided
        if (selectedTab === null) {
            setSelectedTabPrep(newValue);
        }
    };

    const titleStyle = {
        fontSize: "1.25rem", // Adjust for desired size
        fontWeight: "normal",
        textAlign: "center",
    };

    return (
        <Grid container direction="column" style={{ width: "100%", minHeight: "100%", paddingTop: "20px" }}>
            {/* Only show tabs when selectedTab prop is not provided (legacy mode) */}
            {isPrepInitiated && selectedTab === null && (
                <Grid item alignItems="center" alignSelf="center" style={{ width: "80%", paddingTop: "0px" }}>
                    <Tabs value={activeTab} onChange={handleChange} centered variant="fullWidth">
                        <Tab 
                            label="Mosaic Generation" 
                            style={titleStyle} 
                            icon={<DynamicFeedIcon />}
                            iconPosition="start"
                        />
                        <Tab 
                            label="Plot Association" 
                            style={titleStyle} 
                            icon={<EditRoadIcon />}
                            iconPosition="start"
                        />
                        <Tab 
                            label="Processing" 
                            style={titleStyle} 
                            icon={<QueryStatsIcon />}
                            iconPosition="start"
                        />
                    </Tabs>
                </Grid>
            )}
            {/* Show content when isPrepInitiated OR when selectedTab is provided from sidebar */}
            {(isPrepInitiated || selectedTab !== null) && (
                <Grid item container style={{ flexGrow: 1, overflow: "auto" }}>
                    {activeTab === 0 && <AerialDataPrep />}
                    {activeTab === 1 && <PlotBoundaryPrep />}
                    {activeTab === 2 && <Processing />}
                </Grid>
            )}
        </Grid>
    );
}

export default TabbedPrepUI;
