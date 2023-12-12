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
import PlotProposalGenerator from "./PlotProposalGenerator";

function PlotBoundaryPrep() {
    const { imageList, isImageViewerOpen, activeStepBoundaryPrep } = useDataState();
    const { setIsImageViewerOpen, setActiveStepBoundaryPrep } = useDataSetters();

    const handleProcessImages = useHandleProcessImages();
    const steps = ["Data", "Orthomosaic", "Population Boundary", "Plot Boundary"]; // Adjust as needed

    const largerIconStyle = {
        fontSize: "3rem", // Adjust for desired size
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
        // If the active step is greater than the index, go back to the index
        if (activeStepBoundaryPrep > index) {
            setActiveStepBoundaryPrep(index);
        }
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
                        <Checklist onProceed={handleProceed} onDroneGcpProceed={handleDroneGcpProceed} />
                    ) /* activeStepBoundaryPrep === 0 && <div align='center' >Content for Step 1</div> */
                }
                {activeStepBoundaryPrep === 2 && <div align="center">Content for Step 3</div>}
                {activeStepBoundaryPrep === 3 && <div align="center">Content for Step 4</div>}
            </Grid>

            {activeStepBoundaryPrep === 1 && imageList.length === 0 && isImageViewerOpen && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
                    <div align="center">
                        <Grid item container justifyContent="center" spacing={2}>
                            <CircularProgress color="primary" size={60} />
                        </Grid>
                        <Grid item container justifyContent="center" spacing={2}>
                            <Typography variant="h6" sx={{ mt: 2 }}>
                                Loading image data...
                            </Typography>
                        </Grid>
                    </div>
                </div>
            )}

            {activeStepBoundaryPrep === 1 && imageList.length > 0 && isImageViewerOpen && (
                <Grid item container justifyContent="center" spacing={2}>
                    <ImageViewer />
                </Grid>
            )}

            {activeStepBoundaryPrep === 2 && (
                <Grid item container justifyContent="center" spacing={2}>
                    <BoundaryMap task={"pop_boundary"} />
                </Grid>
            )}

            {activeStepBoundaryPrep === 3 && (
                <Grid item container justifyContent={"center"} spacing={2}>
                    <Grid item xs={12} md={2}>
                        <PlotProposalGenerator />
                    </Grid>
                    <Grid item xs={12} md={10}>
                        <BoundaryMap task={"plot_boundary"} />
                    </Grid>
                </Grid>
            )}
        </Grid>
    );
}

export default PlotBoundaryPrep;
