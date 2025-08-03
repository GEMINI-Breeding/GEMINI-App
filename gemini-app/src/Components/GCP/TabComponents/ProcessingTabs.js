// ProcessingTabs.js
import React, { useState, useRef, useEffect } from "react";
import Stepper from "@mui/material/Stepper";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Grid from "@mui/material/Grid";
import { useDataState, useDataSetters } from "../../../DataContext";
import { Typography, Box, Button } from "@mui/material";
import useTrackComponent from "../../../useTrackComponent";

function ProcessingTabs() {
    useTrackComponent("ProcessingTabs");

    const { isImageViewerOpen, activeStepProcessing } = useDataState();
    const { setActiveStepProcessing } = useDataSetters();

    const steps = ["Label", "Step 2", "Step 3", "Step 4"]; // Adjust as needed

    const largerIconStyle = {
        fontSize: "2rem", // Adjust for desired size
        fontWeight: "normal",
        textAlign: "center",
    };

    const handleReturnClick = (index) => {
        setActiveStepProcessing(index);
    };

    const isImageViewerOpenRef = useRef(isImageViewerOpen);
    isImageViewerOpenRef.current = isImageViewerOpen;
    useEffect(() => {
        // If the imageviewer was open and now it's not, go back to step 0
        if (!isImageViewerOpenRef.current && !isImageViewerOpen) {
            isImageViewerOpenRef.current = isImageViewerOpen;
            setActiveStepProcessing(0);
        }
    }, [isImageViewerOpen]);

    return (
        <Grid container direction="column" spacing={2} style={{ width: "80%", margin: "0 auto" }}>
            <Grid item style={{ width: "100%" }}>
                <Stepper activeStep={activeStepProcessing} style={{ padding: "8px 0", background: "transparent" }}>
                    {steps.map((label, index) => (
                        <Step key={index} onClick={() => handleReturnClick(index)}>
                            <StepLabel StepIconProps={{ style: largerIconStyle }}>
                                {<span style={{ fontWeight: "bold", fontSize: "1.2rem" }}>{label}</span>}
                            </StepLabel>
                        </Step>
                    ))}
                </Stepper>
            </Grid>
            
            {/* Step 1: Label */}
            {activeStepProcessing === 0 && (
                <Grid item>
                    <Box sx={{ textAlign: "center", p: 4 }}>
                        <Typography variant="h5" gutterBottom>
                            Step 1: Label
                        </Typography>
                        <Typography variant="body1" sx={{ mb: 3 }}>
                            This is the Label step where you can add labeling functionality.
                        </Typography>
                        <Button 
                            variant="contained" 
                            color="primary" 
                            onClick={() => setActiveStepProcessing(1)}
                        >
                            Proceed to Step 2
                        </Button>
                    </Box>
                </Grid>
            )}

            {/* Step 2: Placeholder */}
            {activeStepProcessing === 1 && (
                <Grid item>
                    <Box sx={{ textAlign: "center", p: 4 }}>
                        <Typography variant="h5" gutterBottom>
                            Step 2: Placeholder
                        </Typography>
                        <Typography variant="body1" sx={{ mb: 3 }}>
                            This is Step 2 placeholder content.
                        </Typography>
                        <Button 
                            variant="contained" 
                            color="primary" 
                            onClick={() => setActiveStepProcessing(2)}
                            sx={{ mr: 2 }}
                        >
                            Proceed to Step 3
                        </Button>
                        <Button 
                            variant="outlined" 
                            onClick={() => setActiveStepProcessing(0)}
                        >
                            Back to Step 1
                        </Button>
                    </Box>
                </Grid>
            )}

            {/* Step 3: Placeholder */}
            {activeStepProcessing === 2 && (
                <Grid item>
                    <Box sx={{ textAlign: "center", p: 4 }}>
                        <Typography variant="h5" gutterBottom>
                            Step 3: Placeholder
                        </Typography>
                        <Typography variant="body1" sx={{ mb: 3 }}>
                            This is Step 3 placeholder content.
                        </Typography>
                        <Button 
                            variant="contained" 
                            color="primary" 
                            onClick={() => setActiveStepProcessing(3)}
                            sx={{ mr: 2 }}
                        >
                            Proceed to Step 4
                        </Button>
                        <Button 
                            variant="outlined" 
                            onClick={() => setActiveStepProcessing(1)}
                        >
                            Back to Step 2
                        </Button>
                    </Box>
                </Grid>
            )}

            {/* Step 4: Placeholder */}
            {activeStepProcessing === 3 && (
                <Grid item>
                    <Box sx={{ textAlign: "center", p: 4 }}>
                        <Typography variant="h5" gutterBottom>
                            Step 4: Placeholder
                        </Typography>
                        <Typography variant="body1" sx={{ mb: 3 }}>
                            This is Step 4 placeholder content.
                        </Typography>
                        <Button 
                            variant="outlined" 
                            onClick={() => setActiveStepProcessing(2)}
                        >
                            Back to Step 3
                        </Button>
                    </Box>
                </Grid>
            )}
        </Grid>
    );
}

export default ProcessingTabs;
