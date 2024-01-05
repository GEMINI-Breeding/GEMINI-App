import React, { useEffect, useState } from 'react';
import {
    Accordion,
    AccordionSummary,
    AccordionDetails,
    Typography,
    Grid,
    Button,
    Dialog,
    DialogContent,
    DialogTitle,
    Select,
    MenuItem,
    InputLabel,
    FormControl,
    LinearProgress
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useDataState } from '../../../../DataContext';

function TrainMenu({ open, onClose, locateDate, activeTab, sensor }) {

    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        flaskUrl,
    } = useDataState();

    // State variables
    const [epochs, setEpochs] = useState(100);
    const [batchSize, setBatchSize] = useState(32);
    const [imageSize, setImageSize] = useState(640);
    const [isTraining, setIsTraining] = useState(false);
    const [progress, setProgress] = useState(0);
    const [currentEpoch, setCurrentEpoch] = useState(0);
    const [trainingComplete, setTrainingComplete] = useState(false);
    const [showResults, setShowResults] = useState(false);

    useEffect(() => {
        let interval;
        if (isTraining) {
            interval = setInterval(async () => {
                try {
                    const response = await fetch(`${flaskUrl}get_training_progress`);
                    if (response.ok) {
                        const data = await response.json();
                        const progressPercentage = (data.epoch / epochs) * 100;
                        setProgress(progressPercentage);
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
            setTrainingComplete(true);
            setShowResults(true);
        }
    }, [currentEpoch, epochs]);

    const handleTrainModel = async () => {
        try {
            setIsTraining(true);
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

    const handleShowResults = () => {
        setShowResults(true);
    };

    const handleResultsClose = () => {
        setShowResults(false);
        setTrainingComplete(false); 
    };

    return (
        <>

            <Dialog open={open && !trainingComplete} onClose={handleClose} disableBackdropClick={isTraining} disableEscapeKeyDown={isTraining} >
                <DialogTitle>Training</DialogTitle>
                {isTraining && (
                    <Grid container direction="column" alignItems="center" style={{ padding: '10px' }}>
                        <Typography variant="subtitle1">
                            Progress: {Math.round(progress)}% ({currentEpoch}/{epochs})
                        </Typography>
                        <LinearProgress 
                            variant="determinate" 
                            value={progress} 
                            style={{ width: '80%', height: '10px', borderRadius: '5px' }}
                        />
                    </Grid>
                )}
                <Grid container spacing={2} justifyContent="center" style={{ padding: '16px' }}>
                    {!isTraining && !trainingComplete ? (
                            <Button 
                                onClick={handleTrainModel}
                                style={{
                                    backgroundColor: "#1976d2",
                                    color: "white",
                                    borderRadius: "4px",
                                    marginTop: "10px",
                                }}
                            >
                                Train Model
                            </Button>
                        ) : trainingComplete ? (
                            <Button 
                                onClick={handleShowResults}
                                style={{
                                    backgroundColor: "#90ee90",
                                    color: "white",
                                    borderRadius: "4px",
                                    marginTop: "10px",
                                }}
                            >
                                Show Results
                            </Button>
                        ) : (
                            <Button 
                                onClick={handleStopTraining} 
                                style={{ 
                                    backgroundColor: "red", 
                                    color: "white",
                                    borderRadius: "4px",
                                    marginTop: "10px",
                                }}
                            >
                                Stop
                            </Button>
                        )}
                </Grid>

                <AdvancedMenu 
                    epochs={epochs} setEpochs={setEpochs}
                    batchSize={batchSize} setBatchSize={setBatchSize}
                    imageSize={imageSize} setImageSize={setImageSize}
                />
            </Dialog>

            <Dialog open={showResults} onClose={handleResultsClose}>
                <DialogTitle>Results</DialogTitle>
                <DialogContent>
                    <Typography variant="body1" style={{ margin: '20px' }}>
                        Your results or content here.
                    </Typography>
                    <Button onClick={handleResultsClose} style={{ margin: '10px' }}>Close</Button>
                </DialogContent>
            </Dialog>

        </>
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
