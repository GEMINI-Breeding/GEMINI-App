import React, { useState, useEffect } from "react";
import { useDataState, useDataSetters } from "../../DataContext";
import {
    Button,
    CircularProgress,
    Dialog
} from "@mui/material";
import Slider from "@mui/material/Slider";
import PointPicker from "./PointPicker";
import { OrthoModal}  from "./OrthoModal";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import IconButton from "@mui/material/IconButton";

import useTrackComponent from "../../useTrackComponent";

// const ImageViewer = () => {
function ImageViewer({ open, onClose, item, activeTab, platform, sensor }) {
    useTrackComponent("ImageViewer");

    const { 
        imageIndex, 
        imageList, 
        imageViewerLoading, 
        imageViewerError, 
        flaskUrl, 
        sliderMarks,
        isImageViewerOpen,
        isOrthoProcessing
    } = useDataState();

    const {
        setImageIndex,
        setImageList,
        setImageViewerLoading,
        setImageViewerError,
        setOrthoModalOpen,
        setIsImageViewerOpen,
        setSelectedDateGCP,
        setSelectedPlatformGCP,
        setSelectedSensorGCP
    } = useDataSetters();
    
    // update state variables
    useEffect(() => {
        if (open) {
            setSelectedDateGCP(item.date);
            setSelectedPlatformGCP(platform);
            setSelectedSensorGCP(sensor);
            setIsImageViewerOpen(true);
        }
        return () => {
            if (!open) {
                setIsImageViewerOpen(false);
                setImageViewerLoading(true);
            }
        };
    }, [open, item, sensor, setSelectedDateGCP, setSelectedSensorGCP, setIsImageViewerOpen]);

    // file serving endpoint
    const API_ENDPOINT = `${flaskUrl}files`;

    // change index of image being viewed
    const handlePrevious = () => {
        if (imageIndex > 0) {
            setImageIndex(imageIndex - 1);
        }
    };

    // go to next image
    const handleNext = () => {
        if (imageIndex < imageList.length - 1) {
            setImageIndex(imageIndex + 1);
        }
    };

    // exit window
    const handleBackButton = () => {
        setIsImageViewerOpen(false);
        onClose();
    };

    const DIALOG_HEIGHT = "90vh";
    const GRID_GAP = "5px";
    const BUTTON_SIZE = "40px";
    const BUTTON_COLOR = "#3874cb";
    const ICON_SIZE = "3rem";
    const TEXT_PADDING = "1px";
    const TEXT_BORDER_RADIUS = "1px";
    const SLIDER_RAIL_HEIGHT = 10;
    const SLIDER_THUMB_SIZE = 20;
    const SLIDER_WIDTH = "50%";
    const SLIDER_JUSTIFY_SELF = "center";
    const BUTTON_CONTAINER_HEIGHT = "50px";
    const BUTTON_CONTAINER_GAP = "20px";

    return (
        <Dialog
            open={isImageViewerOpen}
            onClose={handleBackButton}
            fullWidth
            maxWidth={'xl'}
            // PaperProps={{
            //     style: {
            //         overflow: 'hidden', // Prevent scrollbar from showing
            //     },
            // }}
        >
            
            <div
                style={{
                    position: "relative",
                    display: "grid",
                    height: DIALOG_HEIGHT,
                    gridTemplateColumns: "1fr auto 1fr",
                    gridTemplateRows: "1fr auto auto",
                    gridGap: GRID_GAP,
                    alignItems: "center",
                }}
            >
                {/* Text above the image */}
                <div style={{
                        gridColumn: "2",
                        gridRow: "1",
                        textAlign: "center",
                        zIndex: 9,
                        background: "#fff", // Background to ensure visibility
                        padding: TEXT_PADDING,
                        borderRadius: TEXT_BORDER_RADIUS, // Optional: rounded corners
                        alignItems: "center",
                    }}>
                        <h2 style={{ fontSize: "14px" }}>
                            <span style={{ color: "red", fontWeight: "bold" }}>Note:</span> If you have uploaded GCP Locations, please click on all visible GCPs in the images.<br />
                            Right click to add a point. Left click to remove a point.
                        </h2>

                    <IconButton
                        children={<ArrowBackIcon sx={{ color: "white", fontSize: ICON_SIZE }} />}
                        onClick={handleBackButton}
                        style={{
                            position: "absolute",
                            top: "10px",
                            left: "10px",
                            zIndex: 10,
                            width: BUTTON_SIZE,
                            height: BUTTON_SIZE,
                            backgroundColor: BUTTON_COLOR,
                        }}
                        size="large"
                    ></IconButton>
                </div>

                <div style={{
                    gridColumn: "2",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    overflow: "hidden",
                    padding: "20px",
                }}>
                    {imageViewerLoading && <CircularProgress />}
                    {imageList.length > 0 && (
                        <PointPicker
                            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                            src={API_ENDPOINT + imageList[imageIndex].image_path}
                        />
                    )}
                </div>
                
                {imageList.length > 0 && (
                    <Slider
                        value={imageIndex}
                        onChange={(event, newValue) => setImageIndex(newValue)}
                        aria-labelledby="image-slider"
                        step={1}
                        marks={sliderMarks}
                        min={0}
                        max={imageList.length - 1}
                        valueLabelDisplay="auto"
                        valueLabelFormat={(value) => `${value + 1} of ${imageList.length}`}
                        track={false}
                        style={{ gridColumn: "2", width: SLIDER_WIDTH, justifySelf: SLIDER_JUSTIFY_SELF }}
                        sx={{
                            "& .MuiSlider-rail": {
                                height: SLIDER_RAIL_HEIGHT, // Increase rail and track thickness
                                width: "120%",
                                // Center the track on the tick marks
                                marginLeft: "-10%",
                            },
                            "& .MuiSlider-thumb": {
                                width: SLIDER_THUMB_SIZE, // Increase thumb size
                                height: SLIDER_THUMB_SIZE,
                            },
                        }}
                    />
                )}
                {imageList.length > 0 && (
                    <div style={{ gridColumn: "2", display: "block", height: BUTTON_CONTAINER_HEIGHT, justifySelf: SLIDER_JUSTIFY_SELF, gap: BUTTON_CONTAINER_GAP }}>
                        <Button variant="contained" onClick={handlePrevious}>
                            Previous
                        </Button>
                        &nbsp;&nbsp;&nbsp;
                        <Button variant="contained" onClick={handleNext}>
                            Next
                        </Button>
                        &nbsp;&nbsp;&nbsp;
                        <Button variant="contained" color="warning" onClick={() => setOrthoModalOpen(true)}>
                            Generate Orthophoto
                        </Button>
                    </div>
                )}
                <OrthoModal />
            </div>
        </Dialog>
    );
};

export default ImageViewer;
