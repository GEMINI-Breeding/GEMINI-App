import React, { useEffect, useState } from "react";
import {
    Accordion,
    AccordionSummary,
    AccordionDetails,
    Grid,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Dialog,
    DialogTitle,
    Button,
    Box,
    Typography,
    LinearProgress,
    IconButton,
    DialogContent,
    DialogContentText,
    DialogActions
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { fetchData, useDataSetters, useDataState } from "../../../../DataContext";

function ExtractMenu({ open, onClose, item, platform, sensor }) {

    const { 
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedYearGCP,
        selectedExperimentGCP,
        flaskUrl,
        closeMenu,
        isExtracting,
        batchSizeExtract,
        processRunning,
        selectRoverTrait,
        roverPrepTab
    } = useDataState();

    const {
        setIsExtracting,
        setBatchSizeExtract,
        setProcessRunning,
        setCloseMenu,
    } = useDataSetters();

    // for recommended models
    const [bestLocate, setBestLocate] = useState(null)
    const [bestModel, setBestModel] = useState(null)

    // for extracting traits
    const [error, setError] = useState(null);
    const handleExtract = async () => {
        try {
            setIsExtracting(true);
            setProcessRunning(true);
            const payload = {
                batchSize: batchSizeExtract,
                location: selectedLocationGCP,
                population: selectedPopulationGCP,
                year: selectedYearGCP,
                experiment: selectedExperimentGCP,
                date: selections.date,
                sensor: selections.sensor,
                platform: selections.platform,
                model: selections.model,
                summary: selections.locate,
                trait: selectRoverTrait
            };
            
            const response = await fetch(`${flaskUrl}extract_traits`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });

            if (response.ok) {
                const data = await response.json();
                console.log("Response from server:", data);
            } else {
                const errorData = await response.json();
                console.error("Error details:", errorData);
                // throw new Error(errorData.message || "Error occurred, press Stop");

                alert("Error: " + errorData.error);
            }
        } catch (error) {
            console.error("There was an error sending the request", error)
            setError(error.message);
        }
    };
    const handleClose = () => {
        setCloseMenu(false);
        if (!isExtracting) {
            onClose();
            setSelections({
                trait: '',
                platform: '',
                sensor: '',
                date: '',
                locate: '',
                model: '',
                options: {
                    platforms: [],
                    sensors: [],
                    dates: [],
                    locates: [],
                    models: [],
                }
            });
        }
    };

    // for selecting trait model and locations file
    const [updatedDataState, setUpdatedDataState] = useState({});
    const [selections, setSelections] = useState({
        trait: '',
        platform: '',
        sensor: '',
        date: '',
        locate: '',
        model: '',
        options: {
            platforms: [],
            sensors: [],
            dates: [],
            locates: [],
            models: [],
        }
    });

    // For model training in Teach Traits
    useEffect(() => {
        const fetchParamsAndUpdate = async () => {
            try {
                let updatedData = {};
                let locate_files = {};
                let train_files = {};
                const dates = await fetchData(
                    `${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`
                );

                for (const date of dates) {
                    const platforms = await fetchData(
                        `${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}`
                    );

                    for (const platform of platforms) {
                        const sensors = await fetchData(
                            `${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}`
                        );

                        for (const sensor of sensors) {
                            
                            // get locate files
                            locate_files = await fetchData(
                                `${flaskUrl}check_runs/Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/Locate`
                            )
                            if (Object.keys(locate_files).length === 0) {
                                locate_files = false;
                            }
                            
                            // get model files
                            train_files = await fetchData(
                                `${flaskUrl}check_runs/Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/Training/${platform}/${sensor} ${selectRoverTrait} Detection`
                            );
                            if (Object.keys(train_files).length === 0) {
                                train_files = false;
                            }
                            
                            if (!updatedData[platform]) {
                                updatedData[platform] = {};
                            }
                            if (!updatedData[platform][sensor]) {
                                updatedData[platform][sensor] = [];
                            }

                            // it should only store dates that have a locate.csv
                            updatedData[platform][sensor].push({ date, locate_files, train_files });
                        }
                    }
                }
                setUpdatedDataState(updatedData);
                console.log("Updated Data State: ", updatedDataState)
            } catch(error) {
                console.error("Error fetching model information: ", error)
            }
        };
        fetchParamsAndUpdate();
    }, [selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP, processRunning, roverPrepTab, selectRoverTrait]);

    useEffect(() => {

        const fetchBestFiles = async () => {
            try {
                const platforms = Object.keys(updatedDataState || {});
                const sensors = selections.platform ? Object.keys(updatedDataState[selections.platform] || {}) : [];
                const dates = selections.platform && selections.sensor ? (updatedDataState[selections.platform][selections.sensor] || []).map(item => item.date) : [];
                const locates = selections.platform && selections.sensor 
                    ? [...new Set((updatedDataState[selections.platform][selections.sensor] || [])
                        .filter(item => item.locate_files !== false)  // Filter out items where locate_files is false
                        .flatMap(item => item.locate_files))]  // Remove duplicates by converting to Set and back to array
                    : [];
                const models = selections.platform && selections.sensor 
                    ? [...new Set((updatedDataState[selections.platform][selections.sensor] || [])
                        .filter(item => item.train_files !== false)  // Filter out items where train_files is false
                        .flatMap(item => Object.keys(item.train_files)))]  // Remove duplicates
                    : [];

                console.log("All locates: ", locates)
                console.log("All models: ", models)

                const locateResponse = await fetch(`${flaskUrl}best_locate_file`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(locates),
                });
                if (locateResponse.ok) {
                    const bestLocateData = await locateResponse.json();
                    setBestLocate(bestLocateData)
                } else {
                    const errorData = await locateResponse.json();
                    console.error("Error details: ", errorData)
                    alert("Error fetching best locate file: " + errorData.error);
                }
                
                const modelResponse = await fetch(`${flaskUrl}best_model_file`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(models),
                });
                if (modelResponse.ok) {
                    const bestModelData = await modelResponse.json();
                    setBestModel(bestModelData)
                } else {
                    const errorData = await modelResponse.json();
                    console.error("Error details: ", errorData)
                    alert("Error fetching best model file: " + errorData.error);
                }
        
                setSelections({
                    ...selections,
                    options: {
                        platforms,
                        sensors,
                        dates,
                        locates,
                        models,
                    },
                    platform: platforms.includes(selections.platform) ? selections.platform : '',
                    sensor: sensors.includes(selections.sensor) ? selections.sensor : '',
                    date: dates.includes(selections.date) ? selections.date : '',
                    locate: locates.includes(selections.locate) ? selections.locate : '',
                    model: models.includes(selections.model) ? selections.model : '',
                });
            } catch (error) {
                console.log("Error updating option state.")
                alert("Error updating option state.")
            }
        };

        if (selectRoverTrait) {
            fetchBestFiles();
        }
    }, [updatedDataState, selectRoverTrait, selections.platform, selections.sensor]);

    useEffect(() => {
        // console.log("updatedDataState: ", updatedDataState);
        console.log("selections", selections)
    }, [updatedDataState, selections]);

    return (
        <>
            <Dialog 
                open={open && !isExtracting && !closeMenu} 
                onClose={handleClose}
            >
                <DialogTitle>Extract Traits</DialogTitle>
                {!isExtracting && (
                    <>
                        <Box sx={{ display: 'flex', justifyContent: 'center', paddingBottom: '10px' }}>
                            <Grid container spacing={1} alignItems="center" justifyContent="center" style={{ maxWidth: '300px', margin: 'auto' }}>
                                <Grid item xs={10}>
                                    <FormControl fullWidth>
                                        <InputLabel id="platform-select-label">Platform</InputLabel>
                                        <Select
                                            labelId="platform-select-label"
                                            label="Platform"
                                            value={selections.platform}
                                            onChange={e => setSelections({ ...selections, platform: e.target.value })}
                                            disabled={!selections.options.platforms.length}
                                        >
                                            {selections.options.platforms.map(platform => (
                                                <MenuItem key={platform} value={platform}>{platform}</MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                </Grid>
                                <Grid item xs={10}>
                                    <FormControl fullWidth>
                                        <InputLabel id="sensor-select-label">Sensor</InputLabel>
                                        <Select
                                            labelId="sensor-select-label"
                                            label="Sensor"
                                            value={selections.sensor}
                                            onChange={e => setSelections({ ...selections, sensor: e.target.value })}
                                            disabled={!selections.platform || !selections.options.sensors.length}
                                        >
                                            {selections.options.sensors.map(sensor => (
                                                <MenuItem key={sensor} value={sensor}>{sensor}</MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                </Grid>
                                <Grid item xs={10}>
                                    <FormControl fullWidth>
                                        <InputLabel id="date-select-label">Date</InputLabel>
                                        <Select
                                            labelId="date-select-label"
                                            label="Date"
                                            value={selections.date}
                                            onChange={e => setSelections({ ...selections, date: e.target.value })}
                                            disabled={!selections.sensor || !selections.options.dates.length}
                                        >
                                            {selections.options.dates.map(date => (
                                                <MenuItem key={date} value={date}>{date}</MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                </Grid>
                                <Grid item xs={10}>
                                    <FormControl fullWidth>
                                        <InputLabel id="locate-select-label">Locations ID</InputLabel>
                                        <Select
                                            labelId="locate-select-label"
                                            label="Locate"
                                            value={selections.locate}
                                            onChange={e => {
                                                const selectedValue = e.target.value;
                                
                                                if (selectedValue === "Best") {
                                                    // Check if any of the locates match the bestLocate
                                                    const bestLocateMatch = selections.options.locates.find(locate => {
                                                        const match = locate.match(/Locate-([^\/]+)\/locate\.csv$/);
                                                        return match && match[1] === bestLocate;
                                                    });
                                
                                                    if (bestLocateMatch) {
                                                        setSelections({ ...selections, locate: bestLocateMatch });
                                                    } else {
                                                        alert("Best locate file not found in the available options: ", bestLocate);
                                                    }
                                                } else {
                                                    setSelections({ ...selections, locate: selectedValue });
                                                }
                                            }}
                                            disabled={!selections.date || !selections.options.locates.length}
                                        >
                                            <MenuItem value="Best">Best</MenuItem> {/* Add "Best" option */}
                                            {selections.options.locates.map(locate => {
                                                const match = locate.match(/Locate-([^\/]+)\/locate\.csv$/);
                                                let displayName = match ? match[1] : "Unknown";
                                                displayName = displayName.replace("Locate-", "");
                                                return (
                                                    <MenuItem key={locate} value={locate}>{displayName}</MenuItem>
                                                );
                                            })}
                                        </Select>
                                    </FormControl>
                                </Grid>
                                <Grid item xs={10}>
                                    <FormControl fullWidth>
                                        <InputLabel id="model-select-label">Trait Model ID</InputLabel>
                                        <Select
                                            labelId="model-select-label"
                                            label="Model"
                                            value={selections.model}
                                            onChange={e => {
                                                const selectedValue = e.target.value;

                                                if (selectedValue === "Best") {
                                                    // Check if any of the models match the bestModel
                                                    const bestModelMatch = selections.options.models.find(model => {
                                                        const match = model.match(/-([^\/]+)\/weights/);
                                                        return match && match[1] === bestModel;
                                                    });

                                                    if (bestModelMatch) {
                                                        setSelections({ ...selections, model: bestModelMatch });
                                                    } else {
                                                        alert("Error: Best model file not found in the available options.");
                                                    }
                                                } else {
                                                    setSelections({ ...selections, model: selectedValue });
                                                }
                                            }}
                                            disabled={!selections.locate || !selections.options.models.length}
                                        >
                                            <MenuItem value="Best">Best</MenuItem> {/* Add "Best" option */}
                                            {selections.options.models.map(model => {
                                                const match = model.match(/-([^\/]+)\/weights/);
                                                let displayName = match ? match[1] : "Unknown";
                                                return (
                                                    <MenuItem key={model} value={model}>{displayName}</MenuItem>
                                                );
                                            })}
                                        </Select>
                                    </FormControl>
                                </Grid>
                                <Grid item xs={12} sx={{ display: 'flex', justifyContent: 'center' }}>
                                    <Box sx={{
                                        display: 'flex', 
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        paddingBottom: '10px'
                                    }}>
                                        <Button
                                            onClick={handleExtract}
                                            // onClick={() => {}}
                                            style={{
                                                backgroundColor: "#1976d2",
                                                color: "white",
                                                borderRadius: "4px",
                                                marginTop: "10px",
                                                margin: "0 auto"
                                            }}
                                        >
                                            {" "}
                                            Extract
                                        </Button>
                                        <Typography variant="body2" sx={{ color: 'orange', marginTop: '8px' }}>
                                            Warning: This can take up to 8 hours!
                                        </Typography>
                                    </Box>
                                </Grid>
                            </Grid>
                        </Box>
                        <AdvancedMenu
                            batchSizeExtract={batchSizeExtract}
                            setBatchSizeLocate={setBatchSizeExtract}
                        />
                    </>
                )}
            </Dialog>
            <Dialog open={closeMenu} onClose={handleClose}>
                <DialogTitle>Extractions Complete</DialogTitle>
                    <Button 
                        onClick={handleClose} 
                        style={{ 
                            color: "gray", 
                            borderColor: "gray", 
                            borderWidth: "1px", 
                            borderStyle: "solid", 
                            backgroundColor: "white", 
                            borderRadius: "4px", 
                            marginTop: "10px",
                            padding: "5px 10px"
                        }}>
                        Close
                    </Button>
            </Dialog>
        </>
    );
}

function AdvancedMenu({ batchSizeExtract, setBatchSizeLocate }) {

    const handleBatchSizeChange = (event) => {
        setBatchSizeLocate(event.target.value);
    };

    const resetToDefault = () => {
        setBatchSizeLocate(32);
    };

    return (
        <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls="advanced-content" id="advanced-header">
                <Typography>Advanced</Typography>
            </AccordionSummary>
            <AccordionDetails>
                <Grid container spacing={2} alignItems="center" >
                    {/* Batch Size Dropdown */}
                    <Grid item xs={7}>
                        <FormControl fullWidth>
                            <InputLabel>Batch Size</InputLabel>
                            <Select value={batchSizeExtract} label="Batch Size" onChange={handleBatchSizeChange}>
                                <MenuItem value={32}>32</MenuItem>
                                <MenuItem value={64}>64</MenuItem>
                                <MenuItem value={128}>128</MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>

                    {/* Default Button */}
                    <Grid item xs={7}>
                        <Button
                            onClick={resetToDefault}
                            style={{
                                color: "gray", // Gray text
                                borderColor: "gray", // Gray border
                                borderWidth: "1px",
                                borderStyle: "solid",
                                backgroundColor: "white", // White background
                                borderRadius: "4px",
                                marginTop: "10px",
                            }}
                        >
                            Default
                        </Button>
                    </Grid>
                </Grid>
            </AccordionDetails>
        </Accordion>
    );
}

function ExtractProgressBar({ currentExtractProgress, onStopExtracting, onDoneExtracting }) {
    // const { setCurrentExtractProgress, setIsExtracting, setProcessRunning, setCloseMenu } = useDataSetters();
    const [expanded, setExpanded] = useState(false);
    const validProgress = Number.isFinite(currentExtractProgress) ? currentExtractProgress : 0;

    const handleExpandClick = () => {
        setExpanded(!expanded);
    };

    // const handleDone = () => {
    //     setIsExtracting(false);
    //     setCurrentExtractProgress(0); // Reset progress
    //     setProcessRunning(false);
    //     setCloseMenu(false);
    // };

    const isExtractingComplete = currentExtractProgress >= 100;

    return (
        <Box sx={{ backgroundColor: "white", padding: "10px", border: "1px solid #e0e0e0", boxSizing: "border-box" }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "start" }}>
                <Typography variant="body2" sx={{ marginRight: "10px" }}>
                    Extracting in Progress...
                </Typography>
                <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center" }}>
                    <Box sx={{ width: "100%", mr: 1 }}>
                        <LinearProgress variant="determinate" value={validProgress} />
                    </Box>
                    <Box sx={{ minWidth: 35, mr: 1 }}>
                        <Typography variant="body2" color="text.secondary">{`${Math.round(
                            validProgress
                        )}%`}</Typography>
                    </Box>
                </Box>
                <Button
                    onClick={isExtractingComplete ? onDoneExtracting : onStopExtracting}
                    style={{
                        backgroundColor: isExtractingComplete ? "green" : "red",
                        color: "white",
                        alignSelf: "center",
                    }}
                >
                    {isExtractingComplete ? "DONE" : "STOP"}
                </Button>
                <IconButton
                    onClick={handleExpandClick}
                    sx={{ transform: expanded ? "rotate(0deg)" : "rotate(180deg)" }}
                >
                    <ExpandMoreIcon />
                </IconButton>
            </Box>
        </Box>
    );
}

export { ExtractMenu, ExtractProgressBar };
