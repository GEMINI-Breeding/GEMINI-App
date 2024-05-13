import React, { useEffect } from "react";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { useDataState, useDataSetters, fetchData } from "../../../../DataContext";

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
    } = useDataState();

    // Global setters
    const { 
        setNowDroneProcessing 
    } = useDataSetters();

    useEffect(() => {
        if (nowDroneProcessing && item) {
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

export default AskDroneAnalyzeModal;
