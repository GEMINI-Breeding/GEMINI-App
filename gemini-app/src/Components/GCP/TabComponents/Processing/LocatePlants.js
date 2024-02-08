import React, { useState } from "react";
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
import { useDataSetters, useDataState } from "../../../../DataContext";

function LocateMenu({ open, onClose, item, platform, sensor }) {

    const { 
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedYearGCP,
        selectedExperimentGCP,
        flaskUrl,
        batchSizeLocate,
        isLocating,
        closeMenu
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
                platform: platform
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
            }
        } catch (error) {
            console.error("There was an error sending the request", error)
        }
    };

    const handleClose = () => {
        setCloseMenu(false);
        if (!isLocating) {
            onClose();
        }
    };

    return (
        <>
            <Dialog 
                open={open && !isLocating && !closeMenu} 
                onClose={handleClose}
                maxWidth="sm"
            >
                <DialogTitle>Locations</DialogTitle>
                {!isLocating && (
                    <>
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
