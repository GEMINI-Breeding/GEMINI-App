import React, { useEffect } from 'react';
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
    LinearProgressProps,
    Box
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useDataSetters, useDataState } from '../../../../DataContext';

function TrainMenu({ open, onClose, locateDate, activeTab, sensor }) {

    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        flaskUrl,
        epochs,
        batchSize,
        imageSize,
        isTraining,
        progress,
        currentEpoch,
        showResults,
        processRunning
    } = useDataState();

    const {
        setEpochs,
        setBatchSize,
        setImageSize,
        setIsTraining,
        setProgress,
        setCurrentEpoch,
        setShowResults,
        setProcessRunning
    } = useDataSetters();

    useEffect(() => {
        let interval;
        if (isTraining) {
            interval = setInterval(async () => {
                try {
                    const response = await fetch(`${flaskUrl}get_training_progress`);
                    if (response.ok) {
                        const data = await response.json();
                        console.log('Epoch: ', data.epoch, 'Epochs: ', epochs); // Logging for debugging
                        const progressPercentage = epochs > 0 ? (data.epoch / epochs) * 100 : 0;
                        setProgress(isNaN(progressPercentage) ? 0 : progressPercentage);
                        setCurrentEpoch(data.epoch); // Update current epoch
                    } else {
                        console.error("Failed to fetch training progress");
                    }
                } catch (error) {
                    console.error("Error fetching training progress", error);
                }
            }, 5000); // Poll every 5 seconds
        }
        return () => clearInterval(interval);
    }, [isTraining, flaskUrl, epochs]);

    useEffect(() => {
        if (currentEpoch >= epochs) {
            setIsTraining(false);
            setShowResults(true);
        }
    }, [currentEpoch, epochs]);

    const handleTrainModel = async () => {
        try {
            setIsTraining(true);
            setProcessRunning(true);
            const payload = {
                epochs: epochs,
                batchSize: batchSize,
                imageSize: imageSize,
                location: selectedLocationGCP,
                population: selectedPopulationGCP,
                date: locateDate,
                sensor: sensor
            }

            if (activeTab === 0) {
                payload.trait = 'plant';
            }

            const response = await fetch(`${flaskUrl}train_model`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
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

    const handleStopTraining = async () => {
        try {
            const response = await fetch(`${flaskUrl}stop_training`, { method: 'POST' });
            if (response.ok) {
                // Handle successful stop
                console.log("Training stopped");
                setIsTraining(false);  // Update isTraining to false
            } else {
                // Handle error response
                const errorData = await response.json();
                console.error("Error stopping training", errorData);
            }
        } catch (error) {
            console.error("Error:", error);
        }
    };

    const handleClose = () => {
        if (!isTraining) {
            onClose();
        }
    };

    const handleResultsClose = () => {
        setShowResults(false);
        setProcessRunning(false);
        onClose();
    };

    return (
        <>
            <Dialog open={open && !isTraining} onClose={handleClose}>
                <DialogTitle>Training</DialogTitle>
                {!isTraining && (
                    // Render the Train Model button and Advanced Menu
                    <>
                        <Button 
                            onClick={handleTrainModel}
                            style={{
                                backgroundColor: "#1976d2",
                                color: "white",
                                borderRadius: "4px",
                                marginTop: "10px",
                                margin: "0 auto"
                            }}
                            > Train Model
                        </Button>
                        <AdvancedMenu 
                            epochs={epochs} setEpochs={setEpochs}
                            batchSize={batchSize} setBatchSize={setBatchSize}
                            imageSize={imageSize} setImageSize={setImageSize}
                        />
                    </>
                )}
            </Dialog>

            {isTraining && (
                <Box sx={{
                    position: 'fixed',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    pointerEvents: 'none', // allows clicks to pass through to the underlying content
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 1200 // ensures the overlay is on top
                }}>
                    <Box sx={{ pointerEvents: 'auto', width: '90%' }}>
                        <TrainingProgressBar progress={progress} onStopTraining={handleStopTraining} />
                    </Box>
                </Box>
            )}
        </>
    );
}

function TrainingProgressBar({ progress, onStopTraining }) {
    const validProgress = Number.isFinite(progress) ? progress : 0;

    return (
        <Box sx={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'start', 
        backgroundColor: 'white',
        padding: '10px',
        border: '1px solid #e0e0e0',
        boxSizing: 'border-box'
        }}>
        <Typography variant="body2" sx={{ marginRight: '10px' }}>
            Training in Progress...
        </Typography>
        <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center' }}>
            <Box sx={{ width: '100%', mr: 1 }}>
                <LinearProgress variant="determinate" value={validProgress} />
            </Box>
            <Box sx={{ minWidth: 35, mr: 1 }}>
                <Typography variant="body2" color="text.secondary">{`${Math.round(validProgress)}%`}</Typography>
            </Box>
        </Box>
        <Button 
            onClick={onStopTraining}
            style={{
            backgroundColor: "red",
            color: "white",
            alignSelf: 'center'
            }}
        >
            STOP
        </Button>
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
        setBatchSize(32);
        setImageSize(640);
    };

    return (
        <Accordion>
            <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                aria-controls="advanced-content"
                id="advanced-header"
            >
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
                                <MenuItem value={1}>1</MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>

                    {/* Batch Size Dropdown */}
                    <Grid item xs={4}>
                        <FormControl fullWidth>
                            <InputLabel>Batch Size</InputLabel>
                            <Select value={batchSize} label="Batch Size" onChange={handleBatchSizeChange}>
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
                                marginTop: "10px"
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

export { TrainMenu, AdvancedMenu };
