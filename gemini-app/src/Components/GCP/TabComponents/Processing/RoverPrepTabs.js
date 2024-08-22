import React, { useEffect, useState } from "react";
import { Box, Grid, Typography, FormControl, InputLabel, Select, MenuItem, Button } from "@mui/material";
import { useDataSetters, useDataState, fetchData } from "../../../../DataContext";
import { NestedSection, FolderTab, FolderTabs } from "./CamerasAccordion";
import { LabelsMenu } from "./DropLabels"; // Import LabelDropzones
import { TrainMenu } from "./TrainModel"; // Import TrainMenu
import { LocateMenu } from "./LocatePlants"; // Import LocateMenu
import { ExtractMenu } from "./ExtractTraits"; // Import ExtractMenu

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
    const includedPlatforms = ["Rover", "Amiga-Onboard", "Phone", "T4"];

    // components with action
    const CustomComponent = {
        train: TrainMenu,
        locate: LocateMenu,
        labels: LabelsMenu
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

    // for extract menu
    const [extractMenuOpen, setExtractMenuOpen] = useState(false);
    const handleOpenExtractMenu = () => { setExtractMenuOpen(true); };
    const handleCloseExtractMenu = () => { setExtractMenuOpen(false); };

    // use effects
    useEffect(() => {
        let newColumns;
        switch (roverPrepTab) {
            case 0: // For "Locate Plants"
                newColumns = [
                    { label: "Date", field: "date" },
                    { label: "Labels", field: "labels", actionType: "labels", actionLabel: "Start"},
                    { label: "Model", field: "model", actionType: "train", actionLabel: "Start" },
                    { label: "Locations (Lat/Lon)", field: "location", actionType: "locate", actionLabel: "Start" },
                ];
                break;
            case 1: // For "Label Traits"
                newColumns = [
                    { label: "Date", field: "date" },
                    { label: "Labels", field: "labels", actionType: "labels", actionLabel: "Start"}
                ];
                break;
            case 2: // For "Teach Traits"
                newColumns = [
                    { label: "Model", field: "model" },
                    { label: "Date(s)", field: "sets" },
                    { label: "Platform", field: "platform"},
                    { label: "Sensor", field: "sensor"},
                    { label: "Batch Size", field: "batch" },
                    { label: "Epochs", field: "epochs" },
                    { label: "Image Size", field: "imgsz" },
                    { label: "Performance", field: "map" },
                ];
                break;
            case 3: // For "Extract Traits"
                newColumns = [
                    { label: "Extractions", field: "date"},
                    { label: "Localization Date", field: "locate"},
                    { label: "Trait Model ID", field: "model"},
                    { label: "Locations ID", field: "id"},
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
                                    let locate;
                                    let files;
                                    switch(roverPrepTab) {
                                        case 0: // For "Locate Plants"
                                            // labels = false; // Assume no folder for the sensor initially

                                            files = await fetchData(
                                                `${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}`
                                            );

                                            if (Object.keys(files).length) {
                                                // retrieve labels data
                                                try {
                                                    const labels_files = await fetchData(
                                                        `${flaskUrl}check_labels/Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/Labels/Plant Detection/annotations`
                                                    );
                                                    labels = labels_files.length >= 1;
                                                } catch(error) {
                                                    labels = false;
                                                }

                                                // retrieve file data
                                                train_files = await fetchData(
                                                    `${flaskUrl}check_runs/Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/Training/${platform}/${sensor} Plant Detection`
                                                );
                                                const locate_files = await fetchData(
                                                    `${flaskUrl}check_runs/Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/Locate`
                                                )
                                                
                                                // check model status
                                                const filteredEntries = Object.entries(train_files).filter(([path, dates]) => {
                                                    return dates.includes(date);
                                                });
                                                const filteredTrainFiles = Object.fromEntries(filteredEntries);
                                                if (labels === false) {
                                                    model = 0;
                                                } else if (labels === true && Object.keys(filteredTrainFiles).length === 0) {
                                                    model = false;
                                                }
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
                                            }

                                            break;
                                        case 1: // For "Label Traits"
                                            files = await fetchData(
                                                `${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}`
                                            );

                                            if (Object.keys(files).length) {
                                                // retrieve labels data
                                                try {
                                                    const labels_files = await fetchData(
                                                        `${flaskUrl}check_labels/Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/Labels/${selectRoverTrait} Detection/annotations`
                                                    );
                                                    labels = labels_files.length >= 1;
                                                } catch(error) {
                                                    labels = false;
                                                }
                                                updatedData[platform][sensor].push({ date, labels });
                                            }
                                            break;
                                        case 2: // For "Teach Traits"
                                            train_files = await fetchData(
                                                `${flaskUrl}check_runs/Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/Training/${platform}/${sensor} ${selectRoverTrait} Detection`
                                            );
                                            
                                            // check model and label sets status
                                            const regex = selectRoverTrait ? `/${selectRoverTrait}-([^\/]+)/` : false;
                                            if (regex) {
                                                for (const [path, modelInfo] of Object.entries(train_files)) {
                                                    const match = path.match(regex);
                                                    if (match) {
                                                        const modelId = match[1];
                                                        const modelData = {
                                                            model: String(modelId),
                                                            platform: String(platform),
                                                            sensor: String(sensor),
                                                            sets: modelInfo.dates.map(date => String(date)),
                                                            batch: String(modelInfo.batch),
                                                            epochs: String(modelInfo.epochs),
                                                            imgsz: String(modelInfo.imgsz),
                                                            map: String(modelInfo.map)
                                                        };
                                        
                                                        // Check if an entry with the same model already exists
                                                        const existingIndex = updatedData[platform][sensor].findIndex(entry => entry.model === modelId);
                                                        if (existingIndex === -1) {
                                                            // If the model ID is not found, add a new entry
                                                            updatedData[platform][sensor].push(modelData);
                                                        } else {
                                                            // Optionally update the existing entry, if necessary
                                                            updatedData[platform][sensor][existingIndex] = {
                                                                ...updatedData[platform][sensor][existingIndex],
                                                                ...modelData
                                                            };
                                                        }
                                                    }
                                                }
                                            }
                                            break;
                                        case 3: // For "Extract Traits"
                                            const geojsons = await fetchData(
                                                `${flaskUrl}list_files/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}`
                                            );
                                            const filteredFiles = geojsons.filter(file => file.includes(selectRoverTrait));
                                            
                                            if (filteredFiles.length >= 1) {
                                                const extract_files = await fetchData(
                                                    `${flaskUrl}check_runs/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}`
                                                );
                                                console.log(extract_files)
                                                locate = extract_files[selectRoverTrait].locate;
                                                model = extract_files[selectRoverTrait].model;
                                                const id = extract_files[selectRoverTrait].id
                                                updatedData[platform][sensor].push({ date, model, id, locate });
                                            }
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
                        <FolderTab label="1. Locate Plants" />
                        <FolderTab label="2. Label Traits" />
                        <FolderTab label="3. Train Traits" />
                        <FolderTab label="4. Extract Traits" />
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
                        {roverPrepTab === 1 && sensorData && (
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
                        {roverPrepTab === 3 && sensorData && (
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
                                        onClick={handleOpenExtractMenu}
                                        style={buttonStyle}
                                        disabled={processRunning || selectRoverTrait === ''}
                                    >
                                        Extract Traits
                                    </Button>
                                    <ExtractMenu
                                        open={extractMenuOpen} 
                                        onClose={handleCloseExtractMenu}
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
