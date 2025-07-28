// PlotBoundaryPrep.js
import React, { useState, useRef, useEffect } from "react";
import Stepper from "@mui/material/Stepper";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Grid from "@mui/material/Grid";
import BoundaryMap from "./BoundaryMap";
import Checklist from "./Checklist";
import { useDataState, useDataSetters } from "../../../DataContext";
import ImageViewer from "../ImageViewer";
import { useHandleProcessImages } from "../../Util/ImageViewerUtil";
import { CircularProgress, Typography } from "@mui/material";
import DataImporter from "./DataImporter";
import AgRowStitchPlotLabeler from "./AgRowStitchPlotLabeler";

import useTrackComponent from "../../../useTrackComponent";

function PlotBoundaryPrep() {
    useTrackComponent("PlotBoundaryPrep");

    const { 
        imageList, 
        isImageViewerOpen, 
        activeStepBoundaryPrep,
        prepAgRowStitchPlotPaths,
        prepOrthoImagePath 
    } = useDataState();
    const { setIsImageViewerOpen, setActiveStepBoundaryPrep } = useDataSetters();

    const handleProcessImages = useHandleProcessImages();
    
    // Conditionally include AgRowStitch Labeling step based on whether AgRowStitch data is selected
    // This includes both individual plot paths OR a combined AgRowStitch mosaic
    const isAgRowStitchSelected = (prepAgRowStitchPlotPaths && prepAgRowStitchPlotPaths.length > 0) || 
                                  (prepOrthoImagePath && prepOrthoImagePath.includes('AgRowStitch'));
    const baseSteps = ["Import Data", "Population Boundary", "Plot Boundary"];
    const steps = isAgRowStitchSelected 
        ? [...baseSteps, "Assign Plot Labels"] 
        : baseSteps;

    const largerIconStyle = {
        fontSize: "2rem", // Adjust for desired size
        fontWeight: "normal",
        textAlign: "center",
    };

    const handleProceed = () => {
        setActiveStepBoundaryPrep(2);
    };

    const handleDroneGcpProceed = () => {
        handleProcessImages();
        setIsImageViewerOpen(true);
        setActiveStepBoundaryPrep(1);
    };

    const handleReturnClick = (index) => {
        // Prevent navigation to AgRowStitch step if no AgRowStitch data is selected
        if (index === 3 && !isAgRowStitchSelected) {
            return;
        }
        // If the active step is greater than the index, go back to the index
        // if (activeStepBoundaryPrep > index) {
        //     setActiveStepBoundaryPrep(index);
        // }
        setActiveStepBoundaryPrep(index);
    };

    const isImageViewerOpenRef = useRef(isImageViewerOpen);
    isImageViewerOpenRef.current = isImageViewerOpen;
    useEffect(() => {
        // If the imageviewer was open and now it's not, go back to step 0
        if (!isImageViewerOpenRef.current && !isImageViewerOpen) {
            isImageViewerOpenRef.current = isImageViewerOpen;
            setActiveStepBoundaryPrep(0);
        }
    }, [isImageViewerOpen]);

    // Effect to handle step adjustment when AgRowStitch selection changes
    useEffect(() => {
        // If currently on AgRowStitch step (step 3) but AgRowStitch is no longer selected,
        // move back to step 2 (Plot Boundary)
        if (activeStepBoundaryPrep === 3 && !isAgRowStitchSelected) {
            setActiveStepBoundaryPrep(2);
        }
    }, [isAgRowStitchSelected, activeStepBoundaryPrep, setActiveStepBoundaryPrep]);

    return (
        <Grid container direction="column" spacing={2} style={{ width: "80%", margin: "0 auto" }}>
            <Grid item style={{ width: "100%" }}>
                <Stepper activeStep={activeStepBoundaryPrep} style={{ padding: "8px 0", background: "transparent" }}>
                    {steps.map((label, index) => (
                        <Step key={index} onClick={() => handleReturnClick(index)}>
                            <StepLabel StepIconProps={{ style: largerIconStyle }}>
                                {<span style={{ fontWeight: "bold", fontSize: "1.2rem" }}>{label}</span>}
                            </StepLabel>
                        </Step>
                    ))}
                </Stepper>
            </Grid>
            <Grid item>
                {
                    activeStepBoundaryPrep === 0 && (
                        /* <Checklist onProceed={handleProceed} onDroneGcpProceed={handleDroneGcpProceed} /> */
                        <DataImporter />
                    ) /* activeStepBoundaryPrep === 0 && <div align='center' >Content for Step 1</div> */
                }
            </Grid>

            {activeStepBoundaryPrep === 1 && (
                <Grid item container justifyContent="center" spacing={2}>
                    <BoundaryMap task={"pop_boundary"} />
                </Grid>
            )}

            {/* {activeStepBoundaryPrep === 2 && (
                <Grid item container justifyContent={"center"} spacing={2}>
                    <Grid item xs={12} md={2}>
                        <PlotProposalGenerator />
                    </Grid>
                    <Grid item xs={12} md={10}>
                        <BoundaryMap task={"plot_boundary"} />
                    </Grid>
                </Grid>
            )} */}
            {activeStepBoundaryPrep === 2 && (
                <Grid item container justifyContent="center" spacing={2}>
                    <BoundaryMap task={"plot_boundary"} />
                </Grid>
            )}

            {activeStepBoundaryPrep === 3 && isAgRowStitchSelected && (
                <Grid item container justifyContent="center" spacing={2}>
                    <Grid item xs={12}>
                        <AgRowStitchPlotLabeler />
                    </Grid>
                </Grid>
            )}
        </Grid>
    );
}

export default PlotBoundaryPrep;
