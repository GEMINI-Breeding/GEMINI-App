import React, { useState, useEffect, useRef } from "react";

// material-ui components
import { Box, Grid, Typography, FormControl, InputLabel, Select, MenuItem, Button } from "@mui/material";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import { NestedSection, FolderTab, FolderTabs } from "../GCP/TabComponents/Processing/CamerasAccordion";

// gemini-app components
import useTrackComponent from "../../useTrackComponent";
import { fetchData, useDataSetters, useDataState } from "../../DataContext";
import TableViewTab from "./TableTab";
import GraphTab from "./GraphTab";
import DownloadsTab from "./DownloadsTab";

import GCPPickerSelectionMenu from "../Menu/CollapsibleSidebar";

const tableTitleStyle = {
    fontSize: "1.25rem", // Adjust for desired size
    fontWeight: "normal",
    textAlign: "center",
    //textTransform: "none", // Add this line
};

const StatsMenuMain = () => {
    useTrackComponent("StatsMenuMain");

    // Shared Global States
    const { 
        flaskUrl,
        selectedYearGCP,
        selectedExperimentGCP,
        selectedLocationGCP,
        selectedPopulationGCP,
        isTableMenuInitiated,
        isSidebarCollapsed,
    } = useDataState();

    // Shared Global Setters
    const { 
        setIsTableMenuInitiated,
        setSidebarCollapsed,
    } = useDataSetters();
    
    // Local States
    const [selectedTableTab, setSelectedTableTab] = useState(0);
    
    const handleChange = (event, newValue) => {
        setSelectedTableTab(newValue);
        if (!isSidebarCollapsed) {
            setSidebarCollapsed(true);
        }
    };


    useEffect(() => {
        const fetchDataAndUpdate = async () => {
            // Check if selectedYearGCP is null
            if (selectedPopulationGCP === null) {
                console.log("selectedPopulationGCP is null");
                setIsTableMenuInitiated(false);
                // Open collapse-menu
                if (isSidebarCollapsed) {
                    setSidebarCollapsed(false);
                }
                return;
            }
        }
        fetchDataAndUpdate();     
    }, [selectedPopulationGCP]);

    return (
        /*
        Option 1: Use the following code snippet to render the StatsMenuMain component
        */
        // <Grid container direction="column" style={{ width: "100%", height: "100%" }}>
        //     {isTableMenuInitiated && (
        //         <Grid item alignItems="center" alignSelf="center" style={{ width: "80%" }}>
        //             <Tabs value={selectedTableTab} onChange={handleChange} centered variant="fullWidth">
        //                 <Tab label="Table View" style={tableTitleStyle} />
        //                 <Tab label="Graph View" style={tableTitleStyle} />
        //                 <Tab label="Downloads" style={tableTitleStyle} />
        //             </Tabs>
        //         </Grid>
        //     )}
        //     {isTableMenuInitiated && (
        //         <Grid item container style={{ flexGrow: 1, overflow: "auto" }}>
        //             {selectedTableTab === 0 && <TableViewTab />}
        //             {selectedTableTab === 1 && <GraphTab />}
        //             {/* {selectedTableTab === 2 && <DownloadsTab />} */}
        //         </Grid>
        //     )}
        // </Grid>
        
        /*
        Option 2: Use the following code snippet to render the StatsMenuMain component
        */
        <Grid container direction="column" style={{ width: "100%", height: "100%" }}>
            <TableViewTab />
        </Grid>
    );

};

export default StatsMenuMain;
