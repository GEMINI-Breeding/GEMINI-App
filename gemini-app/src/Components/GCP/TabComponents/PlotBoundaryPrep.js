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
import PlotImageExtractor from "./PlotImageExtractor";

import useTrackComponent from "../../../useTrackComponent";

function PlotBoundaryPrep() {
    useTrackComponent("PlotBoundaryPrep");

    const { 
        imageList, 
        isImageViewerOpen, 
        activeStepBoundaryPrep,
        prepAgRowStitchPlotPaths,
        prepOrthoImagePath,
        featureCollectionPlot
    } = useDataState();
    const { setIsImageViewerOpen, setActiveStepBoundaryPrep } = useDataSetters();

    const handleProcessImages = useHandleProcessImages();
    
    // Conditionally include AgRowStitch Labeling step based on whether AgRowStitch data is selected
    // This includes both individual plot paths OR a combined AgRowStitch mosaic
    const isAgRowStitchSelected = (prepAgRowStitchPlotPaths && prepAgRowStitchPlotPaths.length > 0) || 
                                  (prepOrthoImagePath && prepOrthoImagePath.includes('AgRowStitch'));
    
    console.log("PlotBoundaryPrep render:", {
        isAgRowStitchSelected,
        prepAgRowStitchPlotPaths: prepAgRowStitchPlotPaths?.length || 0,
        prepOrthoImagePath,
        activeStepBoundaryPrep
    });
    
    // Check if plot boundaries have been created
    const hasPlotBoundaries = featureCollectionPlot && 
                             featureCollectionPlot.features && 
                             Array.isArray(featureCollectionPlot.features) && 
                             featureCollectionPlot.features.length > 0;
    
    let steps = ["Import Data", "Population Boundary", "Plot Boundary"];
    
    // Add conditional steps based on data availability
    if (isAgRowStitchSelected) {
        steps.push("Assign Plot Labels");
    }
    else if (prepOrthoImagePath){
        steps.push("Get Plot Images");
    }

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
        // For step 3: if AgRowStitch is selected, show AgRowStitch labeling
        // if not selected, show Get Plot Images
        if (index === 3) {
            if (isAgRowStitchSelected) {
                // Allow navigation to AgRowStitch step only if AgRowStitch is selected
                setActiveStepBoundaryPrep(3);
            } else {
                // Allow navigation to Get Plot Images only if plot boundaries exist
                if (hasPlotBoundaries) {
                    setActiveStepBoundaryPrep(3);
                } else {
                    return; // Don't allow navigation if no plot boundaries
                }
            }
            return;
        }
        
        // For all other steps, allow normal navigation
        if(index === 2){
            if(activeStepBoundaryPrep === 1 || activeStepBoundaryPrep === 3){
                setActiveStepBoundaryPrep(2);
            }
        }
        else {
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

    // Effect to handle step adjustment when AgRowStitch selection changes
    useEffect(() => {
        console.log("PlotBoundaryPrep effect triggered:", {
            activeStepBoundaryPrep,
            isAgRowStitchSelected,
            hasPlotBoundaries,
            featureCount: featureCollectionPlot?.features?.length || 0
        });
        
        // Only adjust if we're on step 3 and conditions don't match
        if (activeStepBoundaryPrep === 3) {
            // If on step 3 without AgRowStitch selected, ensure we have plot boundaries for Get Plot Images
            if (!isAgRowStitchSelected && !hasPlotBoundaries) {
                console.log("PlotBoundaryPrep: Moving back to step 2 - no plot boundaries for Get Plot Images");
                setActiveStepBoundaryPrep(2);
            } else {
                console.log("PlotBoundaryPrep: Staying on step 3 - conditions are valid");
            }
            // If on step 3 with AgRowStitch selected, this is correct (Assign Plot Labels)
            // If on step 3 without AgRowStitch and we have boundaries, this is correct (Get Plot Images)
        }
    }, [activeStepBoundaryPrep, isAgRowStitchSelected, hasPlotBoundaries]);

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

            {/* Step 3 content - conditional based on AgRowStitch availability */}
            {activeStepBoundaryPrep === 3 && isAgRowStitchSelected && (
                <Grid item container justifyContent="center" spacing={2}>
                    <Grid item xs={12}>
                        <AgRowStitchPlotLabeler />
                    </Grid>
                </Grid>
            )}

            {/* Get Plot Images step - only for non-AgRowStitch (drone orthomosaics) */}
            {activeStepBoundaryPrep === 3 && !isAgRowStitchSelected && (
                <Grid item container justifyContent="center" spacing={2}>
                    <Grid item xs={12}>
                        <PlotImageExtractor />
                    </Grid>
                </Grid>
            )}
        </Grid>
    );
}

export default PlotBoundaryPrep;
