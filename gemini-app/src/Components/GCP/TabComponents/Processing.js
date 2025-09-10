// Processing.js
import React, { useState, useRef, useEffect } from "react";
import Stepper from "@mui/material/Stepper";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Grid from "@mui/material/Grid";
import { useDataState, useDataSetters } from "../../../DataContext";
import { CircularProgress, Typography } from "@mui/material";

import useTrackComponent from "../../../useTrackComponent";

// Import step components (to be created later)
import LabelStep from "./ProcessingSteps/LabelStep";
import TrainStep from "./ProcessingSteps/TrainStep";
import PredictStep from "./ProcessingSteps/PredictStep";

function Processing() {
    useTrackComponent("Processing");

    const { 
        activeStepProcessing
    } = useDataState();
    const { setActiveStepProcessing } = useDataSetters();

    const steps = ["Select", "Tune", "Predict"];

    const largerIconStyle = {
        fontSize: "2rem", // Adjust for desired size
        fontWeight: "normal",
        textAlign: "center",
    };

    const handleReturnClick = (index) => {
        setActiveStepProcessing(index);
    };

    return (
        <Grid container direction="column" spacing={2} sx={{ 
            width: "100%", 
            overflowX: "hidden",
            paddingLeft: { xs: 1, sm: 2, md: 3 },
            paddingRight: { xs: 1, sm: 2, md: 3 },
            marginLeft: "auto",
            marginRight: "auto",
            maxWidth: { xs: "100%", sm: "95%", md: "90%" }
        }}>
            <Grid item sx={{ width: "100%", maxWidth: "100%" }}>
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
            <Grid item sx={{ width: "100%", maxWidth: "100%", overflowX: "hidden" }}>
                {activeStepProcessing === 0 && <LabelStep />}
                {activeStepProcessing === 1 && <TrainStep />}
                {activeStepProcessing === 2 && <PredictStep />}
            </Grid>
        </Grid>
    );
}

export default Processing;
