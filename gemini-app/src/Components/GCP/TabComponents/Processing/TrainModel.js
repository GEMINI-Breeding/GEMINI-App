import React, { useEffect, useState } from "react";
import {
    Accordion,
    AccordionSummary,
    AccordionDetails,
    Typography,
    Grid,
    Button,
    Dialog,
    DialogTitle,
    Select,
    MenuItem,
    InputLabel,
    FormControl,
    LinearProgress,
    Box,
    IconButton,
    Menu,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { DataGrid } from '@mui/x-data-grid';
import { fetchData, useDataSetters, useDataState } from "../../../../DataContext";
import { LineChart } from "@mui/x-charts/LineChart";

function TrainMenu({ open, onClose, item, activeTab, platform, sensor }) {
    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedYearGCP,
        selectedExperimentGCP,
        flaskUrl,
        epochs,
        batchSize,
        imageSize,
        isTraining,
        processRunning,
        roverPrepTab,
        selectRoverTrait
    } = useDataState();

    const { 
        setEpochs, 
        setBatchSize, 
        setImageSize, 
        setIsTraining, 
        setProcessRunning, 
        setCurrentEpoch, 
        setTrainingData, 
        setChartData 
    } = useDataSetters();

    // for training model
    const handleTrainModel = async () => {
        try {
            setIsTraining(true);
            setProcessRunning(true);
            setCurrentEpoch(0); // Reset epochs
            setTrainingData(null);
            setChartData({ x: [], y: [] }); // Reset chart data
            const payload = {
                epochs: epochs,
                batchSize: batchSize,
                imageSize: imageSize,
                location: selectedLocationGCP,
                population: selectedPopulationGCP,
                year: selectedYearGCP,
                experiment: selectedExperimentGCP,
                // date: item.date,
                // platform: platform,
                // sensor: sensor,
            };
            console.log("Payload:", payload);

            if (activeTab === 0) {
                payload.trait = "Plant";
                payload.date = item.date;
                payload.platform = platform;
                payload.sensor = sensor;
            } else if (activeTab === 2) {
                payload.trait = selectRoverTrait;
                payload.date = selections.date;
                payload.platform = selections.platform;
                payload.sensor = selections.sensor;
            }

            const response = await fetch(`${flaskUrl}train_model`, {
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
            }
        } catch (error) {
            console.error("There was an error sending the request", error);
        }
    };
    const handleClose = () => {
        if (!isTraining) {
            onClose();
            setSelections({
                trait: '',
                platform: '',
                sensor: '',
                date: '',
                options: {
                    platforms: [],
                    sensors: [],
                    dates: []
                }
            });
        }
    };

    // for model selection in Teach Traits
    const [updatedDataState, setUpdatedDataState] = useState({});
    const [selections, setSelections] = useState({
        trait: '',
        platform: '',
        sensor: '',
        date: '',
        options: {
            platforms: [],
            sensors: [],
            dates: []
        }
    });

    // State to hold grid rows data and columns
    const [rowsData, setRowsData] = useState([]);
    const columns = [
        { field: 'id', headerName: 'Model ID' },
        { field: 'dates', headerName: 'Date' },
        { field: 'platform', headerName: 'Platform' },
        { field: 'sensor', headerName: 'Sensor' },
        { field: 'epochs', headerName: 'Epochs' },
        { field: 'batch', headerName: 'Batch Size' },
        { field: 'imgsz', headerName: 'Image Size' },
        { field: 'map', headerName: 'Performance',
            renderCell: (params) => (
                <Box
                    sx={{
                        backgroundColor: '#add8e6',
                        color: 'black',
                        padding: '6px',
                        borderRadius: '4px',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        width: '100%',
                        height: '100%',
                    }}
                    >
                    {params.value}
                </Box>
            ),
         }
    ];

    // For data grid formation
    useEffect(() => {
        const fetchDataAndUpdate = async () => {
            try {
                // obtain train files
                const train_files = await fetchData(
                    `${flaskUrl}check_runs/Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/Training/${platform}/${sensor} Plant Detection`
                );
                
                const filteredEntries = Object.entries(train_files)
                const filteredTrainFiles = Object.fromEntries(filteredEntries);

                // retrieve information of models
                const response = await fetch(`${flaskUrl}get_model_info`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(filteredTrainFiles),
                });
                if (response.ok) {
                    const data = await response.json();
                    // if batch is -1, replace with Auto
                    data.forEach((item) => {
                        if (item.batch == -1) {
                            item.batch = "Auto";
                        }
                    });
                    setRowsData(data)
                    console.log("Response from server:", data);
                } else {
                    const errorData = await response.json();
                    console.error("Error details:", errorData);
                }
            } catch(error) {
                console.error("Error fetching model information: ", error)
            }
        };
        fetchDataAndUpdate();
    }, [flaskUrl, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, platform, sensor, item, processRunning]);

    // For model training in Teach Traits
    useEffect(() => {
        const fetchParamsAndUpdate = async () => {
            try {
                let updatedData = {};
                const dates = await fetchData(
                    `${flaskUrl}list_dirs/Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`
                );
                for (const date of dates) {
                    try {
                        const platforms = await fetchData(
                            `${flaskUrl}list_dirs/Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}`
                        );
                        if (date.includes("Training")) {
                            continue;
                        }
            
                        for (const platform of platforms) {
                            try {
                                const sensors = await fetchData(
                                    `${flaskUrl}list_dirs/Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}`
                                );
            
                                for (const sensor of sensors) {
                                    try {
                                        const traits = await fetchData(
                                            `${flaskUrl}list_dirs/Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/Labels`
                                        );
                                        for (const trait of traits) {
                                            if (!updatedData[trait]) {
                                                updatedData[trait] = {};
                                            }
                                            if (!updatedData[trait][platform]) {
                                                updatedData[trait][platform] = {};
                                            }
                                            if (!updatedData[trait][platform][sensor]) {
                                                updatedData[trait][platform][sensor] = [];
                                            }
                                            updatedData[trait][platform][sensor].push({ date });
                                        }
                                    } catch (err) {
                                        console.error("Error fetching trait data:", err);
                                    }
                                }
                            } catch (err) {
                                console.error("Error fetching sensor data:", err);
                            }
                        }
                    } catch (err) {
                        console.error("Error fetching platform data:", err);
                    }
                }
                console.log("Processed data: ", updatedData);
                setUpdatedDataState(updatedData);
            } catch (err) {
                console.error("Error fetching initial date data:", err);
            }
        };
        fetchParamsAndUpdate();
    }, [selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP, processRunning, roverPrepTab, selectRoverTrait]);

    useEffect(() => {
        const traitKey = selectRoverTrait ? `${selectRoverTrait} Detection` : '';
    
        if (traitKey && updatedDataState[traitKey]) {
            const platforms = Object.keys(updatedDataState[traitKey] || {});
            const sensors = selections.platform ? Object.keys(updatedDataState[traitKey][selections.platform] || {}) : [];
            const dates = selections.platform && selections.sensor ? (updatedDataState[traitKey][selections.platform][selections.sensor] || []).map(item => item.date) : [];
    
            setSelections({
                ...selections,
                options: {
                    platforms,
                    sensors,
                    dates
                },
                platform: platforms.includes(selections.platform) ? selections.platform : '',
                sensor: sensors.includes(selections.sensor) ? selections.sensor : '',
                date: dates.includes(selections.date) ? selections.date : ''
            });
        }
    }, [updatedDataState, selectRoverTrait, selections.platform, selections.sensor]);

    // useEffect(() => {
    //     console.log("updatedDataState: ", updatedDataState);
    //     // console.log("selections", selections)
    // }, [updatedDataState, selections]);

    return (
        <>
            <Dialog 
                open={open && !isTraining} 
                onClose={handleClose}
                sx={{
                    '& .MuiDialog-paper': {
                        minWidth: '300px', // Set a minimum width that accommodates your DataGrid comfortably
                        // minHeight: '300px', // Set a minimum height based on your content needs
                        maxWidth: '95%', // Optionally set a max width relative to the viewport
                        maxHeight: '90%', // Optionally set a max height relative to the viewport
                        overflow: 'hidden' // Manages overflow if inner contents are larger than the dialog
                    }
                }}
            >
                <DialogTitle>Training</DialogTitle>
                {!isTraining && roverPrepTab == 0 && (
                    // Render the Train Model button and Advanced Menu
                    <>
                        {rowsData.length > 0 && (
                            <Box sx={{
                                display: 'flex',
                                flexDirection: 'column',
                                padding: '10px',
                                overflow: 'auto'
                            }}>
                                <DataGrid
                                    rows={rowsData}
                                    columns={columns}
                                    initialState={{
                                    pagination: {
                                        paginationModel: {
                                        pageSize: 5,
                                        },
                                    },
                                    }}
                                    pageSizeOptions={[5]}
                                    disableRowSelectionOnClick
                                />
                            </Box>
                        )}
                        <Box sx={{
                            display: 'flex', 
                            flexDirection: 'column',
                            alignItems: 'center',
                            paddingBottom: '10px'
                        }}>
                            <Button
                                onClick={handleTrainModel}
                                style={{
                                    backgroundColor: "#1976d2",
                                    color: "white",
                                    borderRadius: "4px",
                                }}
                            >
                                Train Model
                            </Button>
                            <Typography variant="body2" sx={{ color: 'orange', marginTop: '8px' }}>
                                Warning: This can take up to 2 hours!
                            </Typography>
                        </Box>
                        <AdvancedMenu
                            epochs={epochs}
                            setEpochs={setEpochs}
                            batchSize={batchSize}
                            setBatchSize={setBatchSize}
                            imageSize={imageSize}
                            setImageSize={setImageSize}
                        />
                    </>
                )}
                {!isTraining && roverPrepTab == 2 && (
                    <>
                        <Box sx={{ width: '100%', paddingBottom: '10px' }}>
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
                                <Grid item xs={12} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                    <Box sx={{
                                        display: 'flex', 
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        paddingBottom: '10px'
                                    }}>
                                        <Button
                                            onClick={handleTrainModel}
                                            style={{
                                                backgroundColor: "#1976d2",
                                                color: "white",
                                                borderRadius: "4px",
                                            }}
                                        >
                                            Train Model
                                        </Button>
                                        <Typography variant="body2" sx={{ color: 'orange', marginTop: '8px' }}>
                                            Warning: This can take up to 2 hours!
                                        </Typography>
                                    </Box>
                                </Grid>
                            </Grid>
                        </Box>
                        <AdvancedMenu
                            epochs={epochs}
                            setEpochs={setEpochs}
                            batchSize={batchSize}
                            setBatchSize={setBatchSize}
                            imageSize={imageSize}
                            setImageSize={setImageSize}
                        />
                    </>
                )}
            </Dialog>
        </>
    );
}

function TrainingProgressBar({ progress, onStopTraining, trainingData, epochs, chartData, currentEpoch }) {
    const  { flaskUrl } = useDataState();
    const { setChartData, setIsTraining, setTrainingData, setCurrentEpoch, setProcessRunning } = useDataSetters();
    const [expanded, setExpanded] = useState(false);
    const validProgress = Number.isFinite(progress) ? progress : 0;

    const handleExpandClick = () => {
        setExpanded(!expanded);
    };

    const handleDone = async () => {
        try{
            const response = await fetch(`${flaskUrl}done_training`, { method: "POST" });
            console.log("Training is done.");
            setIsTraining(false);
            setCurrentEpoch(0); // Reset epochs
            setTrainingData(null);
            setChartData({ x: [], y: [] }); // Reset chart data
            setProcessRunning(false);
        } catch (error) {
            console.error("Error:", error);
        }
    };

    const isTrainingComplete = currentEpoch >= epochs;

    useEffect(() => {
        if (trainingData) {
            setChartData((prevData) => ({
                x: [...prevData.x, trainingData.epoch],
                y: [...prevData.y, trainingData.map],
            }));
            // console.log("Chart data:", chartData);
        }
    }, [trainingData]);

    return (
        <Box sx={{ backgroundColor: "white", padding: "10px", border: "1px solid #e0e0e0", boxSizing: "border-box" }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "start" }}>
                <Typography variant="body2" sx={{ marginRight: "10px" }}>
                    {validProgress < 1 ? "Preparing dataset..." : "Training in Progress..."}
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
                    onClick={isTrainingComplete ? handleDone : onStopTraining}
                    style={{
                        backgroundColor: isTrainingComplete ? "green" : "red",
                        color: "white",
                        alignSelf: "center",
                    }}
                >
                    {isTrainingComplete ? "DONE" : "STOP"}
                </Button>
                <IconButton
                    onClick={handleExpandClick}
                    sx={{ transform: expanded ? "rotate(0deg)" : "rotate(180deg)" }}
                >
                    <ExpandMoreIcon />
                </IconButton>
            </Box>
            {expanded && (
                <Box sx={{ marginTop: "10px", width: "100%", height: "300px" }}>
                    <LineChart
                        xAxis={[{ label: "Epoch", max: epochs, min: 0, data: chartData.x }]}
                        yAxis={[{ label: "mAP", max: 1, min: 0 }]}
                        series={[
                            {
                                data: chartData.y,
                                showMark: false,
                            },
                        ]}
                    />
                </Box>
            )}
        </Box>
    );
}

function AdvancedMenu({ epochs, setEpochs, batchSize, setBatchSize, imageSize, setImageSize }) {
    const handleEpochsChange = (event) => {
        setEpochs(event.target.value);
    };

    const handleBatchSizeChange = (event) => {
        setBatchSize(event.target.value);
    };

    const handleImageSizeChange = (event) => {
        setImageSize(event.target.value);
    };

    const resetToDefault = () => {
        setEpochs(100);
        setBatchSize(-1);
        setImageSize(640);
    };

    return (
        <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls="advanced-content" id="advanced-header">
                <Typography>Advanced</Typography>
            </AccordionSummary>
            <AccordionDetails>
                <Grid container spacing={2} alignItems="center">
                    {/* Epochs Dropdown */}
                    <Grid item xs={4}>
                        <FormControl fullWidth>
                            <InputLabel>Epochs</InputLabel>
                            <Select value={epochs} label="Epochs" onChange={handleEpochsChange}>
                                <MenuItem value={50}>50</MenuItem>
                                <MenuItem value={100}>100</MenuItem>
                                <MenuItem value={150}>150</MenuItem>
                                <MenuItem value={200}>200</MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>

                    {/* Batch Size Dropdown */}
                    <Grid item xs={4}>
                        <FormControl fullWidth>
                            <InputLabel>Batch Size</InputLabel>
                            <Select value={batchSize} label="Batch Size" onChange={handleBatchSizeChange}>
                                <MenuItem value={-1}>Auto</MenuItem>
                                <MenuItem value={16}>16</MenuItem>
                                <MenuItem value={32}>32</MenuItem>
                                <MenuItem value={64}>64</MenuItem>
                                <MenuItem value={128}>128</MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>

                    {/* Image Size Dropdown */}
                    <Grid item xs={4}>
                        <FormControl fullWidth>
                            <InputLabel>Image Size</InputLabel>
                            <Select value={imageSize} label="Image Size" onChange={handleImageSizeChange}>
                                <MenuItem value={320}>320</MenuItem>
                                <MenuItem value={640}>640</MenuItem>
                                <MenuItem value={1280}>1280</MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>

                    {/* Default Button */}
                    <Grid item xs={12}>
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

export { TrainMenu, TrainingProgressBar };
