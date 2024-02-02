import React from "react";
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
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useDataSetters, useDataState } from "../../../../DataContext";

function LocateMenu({ open, onClose, item, sensor }) {

    const { 
        selectedLocationGCP,
        selectedPopulationGCP, 
        flaskUrl,
        batchSizeLocate,
        isLocating
    } = useDataState();

    const {
        setBatchSizeLocate,
        setIsLocating
    } = useDataSetters();

    const handleLocate = async () => {
        try {
            setIsLocating(true);
            const payload = {
                batchSize: batchSizeLocate,
                location: selectedLocationGCP,
                population: selectedPopulationGCP,
                date: item.date,
                sensor: sensor,
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
        if (!isLocating) {
            onClose();
        }
    };

    return (
        <Dialog 
            open={open && !isLocating} 
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

export default LocateMenu;
