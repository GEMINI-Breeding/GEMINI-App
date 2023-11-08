// PlotBoundaryPrep.js
import React, { useState, useRef, useEffect } from "react";
import Stepper from "@mui/material/Stepper";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import Grid from "@mui/material/Grid";
import PlotBoundaryMap from "./PlotBoundaryMap";
import Checklist from "./Checklist";
import { useDataState, useDataSetters } from "../../../DataContext";
import ImageViewer from "../ImageViewer";
import { useHandleProcessImages } from "../../Util/ImageViewerUtil";
import { CircularProgress, Typography } from "@mui/material";

function PlotBoundaryPrep() {
    const { imageList, isImageViewerOpen } = useDataState();
    const { setIsImageViewerOpen } = useDataSetters();

    const handleProcessImages = useHandleProcessImages();
    const [activeStep, setActiveStep] = useState(0);
    const steps = ["Data", "Orthomosaic", "Population Boundary", "Plot Boundary"]; // Adjust as needed

    const largerIconStyle = {
        fontSize: "3rem", // Adjust for desired size
        fontWeight: "normal",
        textAlign: "center",
    };

    const handleProceed = () => {
        setActiveStep(2);
    };

    const handleDroneGcpProceed = () => {
        handleProcessImages();
        setIsImageViewerOpen(true);
        setActiveStep(1);
    };

    const handleReturnClick = (index) => {
        // If the active step is greater than the index, go back to the index
        if (activeStep > index) {
            setActiveStep(index);
        }
    };

    const isImageViewerOpenRef = useRef(isImageViewerOpen);
    isImageViewerOpenRef.current = isImageViewerOpen;
    useEffect(() => {
        // If the imageviewer was open and now it's not, go back to step 0
        if (!isImageViewerOpenRef.current && !isImageViewerOpen) {
            isImageViewerOpenRef.current = isImageViewerOpen;
            setActiveStep(0);
        }
    }, [isImageViewerOpen]);

    return (
        <Grid container direction="column" spacing={2} style={{ width: "80%", margin: "0 auto" }}>
            <Grid item style={{ width: "100%" }}>
                <Stepper activeStep={activeStep} style={{ padding: "8px 0", background: "transparent" }}>
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
                    activeStep === 0 && (
                        <Checklist onProceed={handleProceed} onDroneGcpProceed={handleDroneGcpProceed} />
                    ) /* activeStep === 0 && <div align='center' >Content for Step 1</div> */
                }
                {activeStep === 2 && <div align="center">Content for Step 3</div>}
                {activeStep === 3 && <div align="center">Content for Step 4</div>}
            </Grid>

            {activeStep === 1 && imageList.length === 0 && isImageViewerOpen && (
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

            {activeStep === 1 && imageList.length > 0 && isImageViewerOpen && (
                <Grid item container justifyContent="center" spacing={2}>
                    <ImageViewer />
                </Grid>
            )}

            {activeStep === 2 && (
                <Grid item container justifyContent="center" spacing={2}>
                    <PlotBoundaryMap />
                </Grid>
            )}

            {activeStep === 3 && (
                <Grid item container justifyContent="center" spacing={2}>
                    <PlotBoundaryMap />
                </Grid>
            )}
        </Grid>
    );
}

export default PlotBoundaryPrep;
