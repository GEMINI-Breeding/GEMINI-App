import React, { useEffect, useState } from "react";
import CircularProgress from "@mui/material/CircularProgress";
import { useDataState, useDataSetters, fetchData } from "../../../../DataContext";
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
    Grid,
    Dialog,
    DialogTitle,
    Button,
    Box,
    Typography,
    LinearProgress,
    IconButton,
    DialogContent
} from "@mui/material";

const AskDroneAnalyzeModal = ({ open, onClose, item }) => {
    // Global state
    const {
        flaskUrl,
        nowDroneProcessing,
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedYearGCP,
        selectedExperimentGCP,
        selectedPlatformGCP,
        selectedSensorGCP,
        isDroneExtracting
    } = useDataState();

    // Global setters
    const { 
        setNowDroneProcessing,
        setIsDroneExtracting,
    } = useDataSetters();

    useEffect(() => {
        if (nowDroneProcessing && item) {
            setIsDroneExtracting(true);
            const data = {
                location: selectedLocationGCP,
                population: selectedPopulationGCP,
                date: item.date,
                year: selectedYearGCP,
                experiment: selectedExperimentGCP,
                platform: item.platform,
                sensor: item.sensor,
            };

            fetch(`${flaskUrl}process_drone_tiff`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(data),
            })
                .then((response) => response.json())
                .then((data) => {
                    console.log("Drone tiff file processed!");
                    setNowDroneProcessing(false);
                    onClose();
                })
                .catch((error) => console.error("Error:", error));
        }
    }, [
        nowDroneProcessing,
        item,
        onClose,
        flaskUrl,
        selectedLocationGCP,
        selectedPopulationGCP,
        setNowDroneProcessing,
    ]);

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth={false}>
            <DialogTitle style={{ textAlign: "center", fontWeight: "bold", fontSize: "x-large" }}>
                {item && item.date}
            </DialogTitle>
            <DialogContent>
                Would you like to process it now?
                <Grid container spacing={1} justifyContent="center" alignItems="center" style={{ marginTop: "20px" }}>
                    <Grid item>
                        <Button
                            variant="contained"
                            color="primary"
                            disabled={nowDroneProcessing}
                            onClick={() => {
                                setNowDroneProcessing(true);
                            }}
                        >
                            {nowDroneProcessing ? "Analyzing" : "Analyze"}
                            {nowDroneProcessing && <CircularProgress size={24} style={{ marginLeft: "14px" }} />}
                        </Button>
                    </Grid>
                    <Grid item>
                        <Button variant="contained" color="primary" disabled={nowDroneProcessing} onClick={onClose}>
                            Close
                        </Button>
                    </Grid>
                </Grid>
            </DialogContent>
        </Dialog>
    );
};

function DroneExtractProgressBar({ currentDroneExtractProgress, onDroneStopExtracting }) {
    // const { setCurrentExtractProgress, setIsExtracting, setProcessRunning, setCloseMenu } = useDataSetters();
    const [expanded, setExpanded] = useState(false);
    const { setDroneCurrentExtractProgress, setDroneIsExtracting, setProcessRunning, setCloseMenu } = useDataSetters();
    const validProgress = Number.isFinite(currentDroneExtractProgress) ? currentDroneExtractProgress : 0;

    const handleExpandClick = () => {
        setExpanded(!expanded);
    };

    const handleDone = () => {
        setDroneIsExtracting(false);
        setDroneCurrentExtractProgress(0); // Reset progress
        setProcessRunning(false);
        setCloseMenu(false);
    };

    const isDroneExtractingComplete = currentDroneExtractProgress >= 100;

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
                    onClick={isDroneExtractingComplete ? handleDone : onDroneStopExtracting}
                    style={{
                        backgroundColor: isDroneExtractingComplete ? "green" : "red",
                        color: "white",
                        alignSelf: "center",
                    }}
                >
                    {isDroneExtractingComplete ? "DONE" : "STOP"}
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

export { AskDroneAnalyzeModal, DroneExtractProgressBar };
