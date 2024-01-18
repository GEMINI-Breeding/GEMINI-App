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
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useDataSetters, useDataState } from "../../../../DataContext";
import { LineChart } from "@mui/x-charts/LineChart";

function TrainMenu({ open, onClose, item, activeTab, sensor }) {
    const { selectedLocationGCP, selectedPopulationGCP, flaskUrl, epochs, batchSize, imageSize, isTraining } =
        useDataState();

    const { setEpochs, setBatchSize, setImageSize, setIsTraining, setProcessRunning } = useDataSetters();

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
                date: item.date,
                sensor: sensor,
            };

            if (activeTab === 0) {
                payload.trait = "plant";
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
        }
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
                                margin: "0 auto",
                            }}
                        >
                            {" "}
                            Train Model
                        </Button>
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
    // const  { chartData } = useDataState();
    const { setChartData, setIsTraining, setTrainingData, setCurrentEpoch } = useDataSetters();
    const [expanded, setExpanded] = useState(false);
    const validProgress = Number.isFinite(progress) ? progress : 0;

    const handleExpandClick = () => {
        setExpanded(!expanded);
    };

    const handleDone = () => {
        setIsTraining(false);
        setCurrentEpoch(0); // Reset epochs
        setTrainingData(null);
        setChartData({ x: [], y: [] }); // Reset chart data
    };

    const isTrainingComplete = currentEpoch >= epochs;

    useEffect(() => {
        if (trainingData) {
            setChartData((prevData) => ({
                x: [...prevData.x, trainingData.epoch],
                y: [...prevData.y, trainingData.map],
            }));
            console.log("Chart data:", chartData);
        }
    }, [trainingData]);

    return (
        <Box sx={{ backgroundColor: "white", padding: "10px", border: "1px solid #e0e0e0", boxSizing: "border-box" }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "start" }}>
                <Typography variant="body2" sx={{ marginRight: "10px" }}>
                    Training in Progress...
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
        setBatchSize(32);
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