import React, { useState, useEffect, useRef } from "react";

// material-ui components
import { Box, Grid, Typography, FormControl, InputLabel, Select, MenuItem, Button } from "@mui/material";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import { NestedSection, FolderTab, FolderTabs } from "../GCP/TabComponents/Processing/CamerasAccordion";

// gemini-app components
import useTrackComponent from "../../useTrackComponent";
import { fetchData, useDataSetters, useDataState } from "../../DataContext";
import TableTab from "./TableTab";
import GraphTab from "./GraphTab";
import DownloadsTab from "./DownloadsTab";


const tableTitleStyle = {
    fontSize: "1.25rem", // Adjust for desired size
    fontWeight: "normal",
    textAlign: "center",
    //textTransform: "none", // Add this line
};

const TableMenuMain = () => {
    useTrackComponent("TableMenuMain");

    const { 
        flaskUrl,
        selectedYearGCP,
        selectedExperimentGCP,
        selectedLocationGCP,
        selectedPopulationGCP,

    } = useDataState();

    const [sensorData, setSensorData] = useState(null);
    const { setRoverPrepTab, setSelectRoverTrait } = useDataSetters();

    const [isTableInitiated, setIsTableInitiated] = useState(false);
    const [selectedTableTab, setSelectedTableTab] = useState(0);

    // ColorMap state management; see DataContext.js
    const { isSidebarCollapsed } = useDataState();
    const { setSidebarCollapsed } = useDataSetters();
    
    const handleChange = (event, newValue) => {
        setSelectedTableTab(newValue);
        if (!isSidebarCollapsed) {
            setSidebarCollapsed(true);
        }
    };


    useEffect(() => {
        const fetchDataAndUpdate = async () => {

            // check for existing raw drone data
            const dates = await fetchData(
                `${flaskUrl}list_dirs/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`
            );
            console.log(dates); 
            // // iterate through each data and check if images exists
            // for (const date of dates) {
            //     const folders = await fetchData(
            //         `${flaskUrl}list_dirs/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}`
            //     );
            // }

            // try {
            //     const processedFiles = await fetchData(
            //         `${flaskUrl}list_files/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/Drone/${sensor}`
            //     );

            //     ortho = processedFiles.some((file) => file.endsWith(".tif")) ? true : false;
            // } catch (error) {
            //     // if there's an error fetching processed files, or no .tif files found
            //     console.warn(
            //         `Processed data not found or error fetching processed data for date ${date} and sensor ${sensor}:`,
            //         error
            //     );
            //     ortho = false; // there are images, but no processed .tif files
            //     setSubmitError(`Processed data not found or error fetching processed data for date ${date} and sensor ${sensor}`)
            // }
        }
        fetchDataAndUpdate();     
    },[selectedYearGCP]);

    // useEffect(() => {
    //     if (selectedTraitsCsvPath) {
    //         fetch(selectedTraitsCsvPath)
    //             .then((response) => response.json())
    //             .then((data) => setGeojsonData(data))
    //             .catch((error) => console.error("Error fetching:", error));
    //     }
    // }, [selectedTraitsCsvPath]);

    // useEffect(() => {
    //     const fetchDataAndUpdate = async () => {
    //         // check for existing raw drone data
    //         const dates = await fetchData(
    //             `${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`
    //         );
    //     }
    // }, []);

    return (
        <Grid container direction="column" style={{ width: "100%", height: "100%" }}>
            {(
                <Grid item alignItems="center" alignSelf="center" style={{ width: "80%" }}>
                    <Tabs value={selectedTableTab} onChange={handleChange} centered variant="fullWidth">
                        <Tab label="Table View" style={tableTitleStyle} />
                        <Tab label="Graph View" style={tableTitleStyle} />
                        <Tab label="Downloads" style={tableTitleStyle} />
                    </Tabs>
                </Grid>
            )}
            {(
                <Grid item container style={{ flexGrow: 1, overflow: "auto" }}>
                    {selectedTableTab === 0 && <TableTab />}
                    {selectedTableTab === 1 && <GraphTab />}
                    {selectedTableTab === 2 && <DownloadsTab />}
                </Grid>
            )}
        </Grid>
    );

};

export default TableMenuMain;
