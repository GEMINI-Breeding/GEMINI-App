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
    IconButton
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { fetchData, useDataSetters, useDataState } from "../../../../DataContext";
import { DataGrid } from '@mui/x-data-grid';

function LocateMenu({ open, onClose, item, platform, sensor }) {

    const { 
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedYearGCP,
        selectedExperimentGCP,
        flaskUrl,
        batchSizeLocate,
        isLocating,
        closeMenu,
        processRunning,
        roverPrepTab
    } = useDataState();

    const {
        setBatchSizeLocate,
        setIsLocating,
        setProcessRunning,
        setCloseMenu,
    } = useDataSetters();

    const handleLocate = async () => {
        try {
            setIsLocating(true);
            setProcessRunning(true);
            const payload = {
                batchSize: batchSizeLocate,
                location: selectedLocationGCP,
                population: selectedPopulationGCP,
                year: selectedYearGCP,
                experiment: selectedExperimentGCP,
                date: item.date,
                sensor: sensor,
                platform: platform,
                model: selectedLocateModel,
                id: selectedModelId
            };
            
            const response = await fetch(`${flaskUrl}locate_plants`, {
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
                
                // Raise error dialog of error message (500 message)
                // message from backend: return jsonify({"error": error_output}), 500
                alert("Error: " + errorData.error);
            }
        } catch (error) {
            console.error("There was an error sending the request", error)

            // Raise error dialog of error message
            alert("Error: " + error);
        }
    };

    const handleClose = () => {
        setCloseMenu(false);
        if (!isLocating) {
            onClose();
        }
    };

    // For model and locate information
    const [selectedLocateModel, setSelectedLocateModel] = useState('');
    const [selectedModelId, setSelectedModelId] = useState('')
    const [modelOptions, setModelOptions] = useState([])
    const [rowsData, setRowsData] = useState([]);
    const columns = [
        { field: 'id', headerName: 'Locations ID' },
        { field: 'model', headerName: 'Model ID Used', width: 120 },
        { field: 'date', headerName: 'Date' },
        { field: 'platform', headerName: 'Platform' },
        { field: 'sensor', headerName: 'Sensor' },
        // { field: 'count', headerName: 'Total Stand Count', width: 135 },
        { field: 'performance', headerName: 'Performance',
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
    const handleModelChange = (event) => {
        const selectedID = event.target.value;
    
        if (selectedID === 'Best') {
            const bestModel = modelOptions.reduce((best, current) => {
                return current.performance > best.performance ? current : best;
            }, modelOptions[0]);
            
            if (bestModel) {
                setSelectedModelId(bestModel.id);
                setSelectedLocateModel(bestModel.path);
                console.log('Selected best model for locate: ', bestModel);
            }
        } else {
            const selectedModelOption = modelOptions.find(model => model.id === selectedID);
            if (selectedModelOption) {
                setSelectedModelId(selectedID);
                setSelectedLocateModel(selectedModelOption.path);
                console.log('Selected model for locate: ', selectedModelOption);
            }
        }
    };

    useEffect(() => {
        const fetchDataAndUpdate = async () => {
            try {
                // obtain model train files
                const train_files = await fetchData(
                    `${flaskUrl}check_runs/Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/Training/${platform}/${sensor} Plant Detection`
                );
                const filteredEntries = Object.entries(train_files).filter(([path, dates]) => {
                    return dates.includes(item?.date);
                });
                const filteredTrainFiles = Object.fromEntries(filteredEntries);
                const options = Object.keys(filteredTrainFiles).map((path, index) => {
                    // This pattern matches any alphanumeric string (ID) that comes after "Plant-" and before "/weights"
                    const match = path.match(/Plant-([A-Za-z0-9]+)\/weights/);
                    const id = match ? match[1] : `unknown-${index}`; // Fallback ID in case there's no match

                    return { id, path, performance: Math.random() * 100 }; // Add random performance scores for demo purposes
                });

                // Add a "Best" option with the highest performance
                setModelOptions([...options, { id: 'Best', path: '', performance: -1 }]);

                // obtain locate run files
                const locate_files = await fetchData(
                    `${flaskUrl}check_runs/Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${item?.date}/${platform}/${sensor}/Locate`
                );

                const response = await fetch(`${flaskUrl}get_locate_info`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(locate_files),
                });
                if (response.ok) {
                    const data = await response.json();
                    setRowsData(data);
                    console.log("Response from server:", data);
                } else {
                    const errorData = await response.json();
                    console.error("Error details:", errorData);
                }
            } catch (error) {
                console.error("Error fetching model information: ", error);
            }
        };
        fetchDataAndUpdate();
    }, [selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP, processRunning, roverPrepTab]);


    return (
        <>
            <Dialog 
                open={open && !isLocating && !closeMenu} 
                onClose={handleClose}
                sx={{
                    '& .MuiDialog-paper': {
                        minWidth: '600px', // Set a minimum width that accommodates your DataGrid comfortably
                        minHeight: '200px', // Set a minimum height based on your content needs
                        maxWidth: '95%', // Optionally set a max width relative to the viewport
                        maxHeight: '90%', // Optionally set a max height relative to the viewport
                        overflow: 'hidden' // Manages overflow if inner contents are larger than the dialog
                    }
                }}
                // maxWidth="sm"
            >
                <DialogTitle>Locations</DialogTitle>
                {!isLocating && (
                    <>
                        {rowsData.length > 0 && (
                            <Box sx={{ padding: '10px' }}>
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
                        <Box sx={{ padding: '10px' }}>
                        <Grid container spacing={2} alignItems="center" justifyContent="center">
                                <Grid item>
                                    <Typography variant="body1">Model ID:</Typography>
                                </Grid>
                                <Grid>
                                    <FormControl sx={{ width: '200px', mx: 'auto', padding: '10px' }}>
                                        {/* <InputLabel id="model-select-label">ID</InputLabel> */}
                                        <Select
                                            // labelId="model-select-label"
                                            // id="model-select"
                                            value={selectedModelId}
                                            // label="ID"
                                            onChange={handleModelChange}
                                        >
                                            {modelOptions.map((option) => (
                                                <MenuItem key={option.id} value={option.id}>
                                                    {option.id}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                </Grid>
                            </Grid>
                        </Box>
                        <Box sx={{
                            display: 'flex', 
                            flexDirection: 'column',
                            alignItems: 'center',
                            paddingBottom: '10px'
                        }}>
                            <Button
                                onClick={handleLocate}
                                style={{
                                    backgroundColor: "#1976d2",
                                    color: "white",
                                    borderRadius: "4px",
                                    marginTop: "10px",
                                    margin: "0 auto"
                                }}
                            >
                                {" "}
                                Locate
                            </Button>
                            <Typography variant="body2" sx={{ color: 'orange', marginTop: '8px' }}>
                                Warning: This can take up to 4 hours!
                            </Typography>
                        </Box>
                        <AdvancedMenu
                            batchSizeLocate={batchSizeLocate}
                            setBatchSizeLocate={setBatchSizeLocate}
                        />
                    </>
                )}
            </Dialog>
            <Dialog open={closeMenu} onClose={handleClose}>
                <DialogTitle>Locations Complete</DialogTitle>
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

function AdvancedMenu({ batchSizeLocate, setBatchSizeLocate }) {

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
                            <Select value={batchSizeLocate} label="Batch Size" onChange={handleBatchSizeChange}>
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

function LocateProgressBar({ currentLocateProgress, onStopLocating }) {
    const { setCurrentLocateProgress, setIsLocating, setProcessRunning, setCloseMenu } = useDataSetters();
    const [expanded, setExpanded] = useState(false);
    const validProgress = Number.isFinite(currentLocateProgress) ? currentLocateProgress : 0;

    const handleExpandClick = () => {
        setExpanded(!expanded);
    };

    const handleDone = () => {
        setIsLocating(false);
        setCurrentLocateProgress(0); // Reset progress
        setProcessRunning(false);
        setCloseMenu(false);
    };

    const isLocatingComplete = currentLocateProgress >= 100;

    return (
        <Box sx={{ backgroundColor: "white", padding: "10px", border: "1px solid #e0e0e0", boxSizing: "border-box" }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "start" }}>
                <Typography variant="body2" sx={{ marginRight: "10px" }}>
                    Locating in Progress...
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
                    onClick={isLocatingComplete ? handleDone : onStopLocating}
                    style={{
                        backgroundColor: isLocatingComplete ? "green" : "red",
                        color: "white",
                        alignSelf: "center",
                    }}
                >
                    {isLocatingComplete ? "DONE" : "STOP"}
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

export { LocateMenu, LocateProgressBar };
