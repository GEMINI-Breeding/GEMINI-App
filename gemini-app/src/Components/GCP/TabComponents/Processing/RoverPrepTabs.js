import React, { useEffect, useState } from "react";
import { Box, Grid, Typography, FormControl, InputLabel, Select, MenuItem, Button } from "@mui/material";
import { useDataSetters, useDataState, fetchData } from "../../../../DataContext";
import { NestedSection, FolderTab, FolderTabs } from "./CamerasAccordion";
import { TrainMenu } from "./TrainModel"; // Import TrainMenu
import { LocateMenu } from "./LocatePlants"; // Import LocateMenu

import useTrackComponent from "../../../../useTrackComponent";

export default function RoverPrepTabs() {
    useTrackComponent("RoverPrep");

    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedYearGCP,
        selectedExperimentGCP,
        flaskUrl,
        roverPrepTab,
        processRunning,
        selectRoverTrait
    } = useDataState();
    const { setRoverPrepTab, setSelectRoverTrait } = useDataSetters();
    const [sensorData, setSensorData] = useState(null);
    const [columns, setColumns] = useState([]);

    // for trait selection
    const traitOptions = ['Flower', 'Pod', 'Leaf']

    // included ground-based platforms
    const includedPlatforms = ["Rover", "Amiga-Onboard", "Phone"];

    // components with action
    const CustomComponent = {
        train: TrainMenu,
        locate: LocateMenu,
    };

    // handles
    const handleChange = (event, newValue) => {
        setRoverPrepTab(newValue);
    };
    const handleAction = (item, column) => {
        console.log("Action triggered for:", item, column);
    };
    const handleTraitSelect = (event) => {
        setSelectRoverTrait(event.target.value);
    }

    // for any buttons
    const buttonStyle = {
        background: processRunning || selectRoverTrait === '' ? "grey" : "#1976d2",
        color: "white",
        borderRadius: "4px",
    };

    // row data for nested section
    const constructRowData = (item, columns) => {
        const rowData = {};
        columns.forEach(column => {
            rowData[column.field] = item[column.field];
        });
        return rowData;
    };

    // for train menu
    const [trainMenuOpen, setTrainMenuOpen] = useState(false);
    const handleOpenTrainMenu = () => { setTrainMenuOpen(true); };
    const handleCloseTrainMenu = () => { setTrainMenuOpen(false); };
    
    // use effects
    useEffect(() => {
        let newColumns;
        switch (roverPrepTab) {
            case 0: // For "Locate Plants"
                newColumns = [
                    { label: "Date", field: "date" },
                    { label: "Labels", field: "labels" },
                    { label: "Model", field: "model", actionType: "train", actionLabel: "Start" },
                    { label: "Locations (Lat/Lon)", field: "location", actionType: "locate", actionLabel: "Start" },
                ];
                break;
            case 1: // For "Label Traits"
                newColumns = [
                ];
                break;
            case 2: // For "Teach Traits"
                newColumns = [
                    { label: "Model", field: "model" },
                    { label: "Label Sets", field: "sets" }
                ];
                break;
            case 3: // For "Extract Traits"
                newColumns = [
                    // Define columns for Extract Traits
                ];
                break;
            default:
                newColumns = [];
        }
        setColumns(newColumns);
    }, [roverPrepTab]);

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

                                try {
                                    let train_files;
                                    let labels;
                                    let model;
                                    switch(roverPrepTab) {
                                        case 0: // For "Locate Plants"
                                            labels = 2; // Assume no folder for the sensor initially

                                            // const files = await fetchData(
                                            //     `${flaskUrl}list_files/Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}`
                                            // );

                                            // retrieve file data
                                            train_files = await fetchData(
                                                `${flaskUrl}check_runs/Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/Training/${platform}/${sensor} Plant Detection`
                                            );
                                            const locate_files = await fetchData(
                                                `${flaskUrl}check_runs/Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/Locate`
                                            )
                                            
                                            // check model status
                                            model = false;
                                            const filteredEntries = Object.entries(train_files).filter(([path, dates]) => {
                                                return dates.includes(date);
                                            });
                                            const filteredTrainFiles = Object.fromEntries(filteredEntries);
                                            if (Object.keys(filteredTrainFiles).length >= 1) {
                                                model = true;
                                            }

                                            // check location status
                                            let location;
                                            if (!model) {
                                                location = 0;
                                            } else {
                                                location = locate_files.length >= 1;
                                            }

                                            updatedData[platform][sensor].push({ date, labels, model, location });
                                            break;
                                        case 1: // For "Label Traits"
                                            break;
                                        case 2: // For "Teach Traits"
                                            train_files = await fetchData(
                                                `${flaskUrl}check_runs/Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/Training/${platform}/${sensor} ${selectRoverTrait} Detection`
                                            );
                                            
                                            // check model status
                                            const regex = selectRoverTrait ? `/${selectRoverTrait}-([^\/]+)/` : false;
                                            if (regex) {
                                                for (const [path, sets] of Object.entries(train_files)) {
                                                    const match = path.match(regex);
                                                    if (match) {
                                                        const modelId = match[1];
                                                        // Check if an entry with the same model and sets already exists
                                                        const alreadyExists = updatedData[platform][sensor].some(entry => entry.model === modelId && entry.sets === sets[0]);
                                                        
                                                        if (!alreadyExists) {
                                                            updatedData[platform][sensor].push({ model: modelId, sets: sets[0] });
                                                        }
                                                    }
                                                }
                                            }
                                            break;
                                        case 3: // For "Extract Traits"
                                            break;
                                    }
                                } catch (error) {
                                    console.warn(
                                        `Error fetching processed data for ${date}, ${platform}, ${sensor}:`,
                                        error
                                    );
                                    // If there's an error fetching the data, it could mean there's no folder for the sensor
                                    // In this case, labels should remain 2, model and location remain true
                                }
                            }
                        }
                    }

                    const processedData = Object.keys(updatedData).map((platform) => ({
                        title: platform,
                        nestedData: Object.keys(updatedData[platform]).map((sensor) => ({
                            summary: sensor,
                            data: updatedData[platform][sensor].map(item => constructRowData(item, columns)),
                            columns: columns, // Use the dynamically defined columns for this tab
                        })),
                    }));

                    setSensorData(processedData);
                } catch (error) {
                    console.error("Error fetching data:", error);
                }
            }
        };

        fetchDataAndUpdate();
    }, [selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP, flaskUrl, roverPrepTab, processRunning, columns, selectRoverTrait]);

    return (
        <Grid container direction="column" alignItems="center" style={{ width: "80%", margin: "0 auto" }}>
            <Typography variant="h4" component="h2" align="center">
                Ground Data Preparation
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

                <Grid item container justifyContent="center" sx={{ marginTop: '0px' }}>
                    <Box sx={{ width: "100%", padding: '0px', margin: '0px' }}>
                        {roverPrepTab === 0 && sensorData && (
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
                                            activeTab={roverPrepTab}
                                            handleAction={null}
                                            CustomComponent={CustomComponent}
                                        />
                                    ))}
                            </div>
                        )}
                        {roverPrepTab === 2 && sensorData && (
                            <div>
                                <Box sx={{ width: '100%', marginBottom: 2, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', paddingTop: '15px' }}>
                                    <FormControl sx={{ width: '15%', mr: 2 }}>
                                        <InputLabel id="demo-simple-select-label">Select Trait</InputLabel>
                                        <Select
                                            labelId="demo-simple-select-label"
                                            id="demo-simple-select"
                                            value={selectRoverTrait}
                                            label="Select Trait"
                                            onChange={handleTraitSelect}
                                        >
                                            {traitOptions.map((option) => (
                                                <MenuItem key={option} value={option}>{option}</MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                    <Button 
                                        onClick={handleOpenTrainMenu}
                                        style={buttonStyle}
                                        disabled={processRunning || selectRoverTrait === ''}
                                    >
                                        New Model
                                    </Button>
                                    <TrainMenu 
                                        open={trainMenuOpen} 
                                        onClose={handleCloseTrainMenu}
                                        activeTab={roverPrepTab}
                                    />
                                </Box>
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
                                            activeTab={roverPrepTab}
                                            handleAction={null}
                                            CustomComponent={CustomComponent}
                                        />
                                    ))}
                            </div>
                        )}
                        {/* {roverPrepTab > 0 && <div>Content for other tabs coming soon!</div>} */}
                    </Box>
                </Grid>
            </Grid>
        </Grid>
    );
}
