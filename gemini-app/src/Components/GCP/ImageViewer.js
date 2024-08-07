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

    return (
        <Dialog open={isImageViewerOpen} onClose={handleBackButton} fullWidth maxWidth={'xl'}>
                <div
                    style={{
                        position: "relative",
                        display: "grid",
                        height: "90vh",
                        gridTemplateColumns: "1fr auto 1fr",
                        gridTemplateRows: "1fr auto auto",
                        gridGap: "5px",
                        alignItems: "center",
                    }}
                >
                    <IconButton
                        children={<ArrowBackIcon sx={{ color: "white", fontSize: "3rem" }} />}
                        onClick={handleBackButton}
                        style={{
                            position: "absolute",
                            top: "10px",
                            left: "10px",
                            zIndex: 9,
                            width: "50px",
                            height: "50px",
                            backgroundColor: "#3874cb",
                        }}
                        size="large"
                    ></IconButton>
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
                            style={{ gridColumn: "2", width: "50%", justifySelf: "center" }}
                            sx={{
                                "& .MuiSlider-rail": {
                                    height: 10, // Increase rail and track thickness
                                    width: "120%",
                                    // Center the track on the tick marks
                                    marginLeft: "-10%",
                                },
                                "& .MuiSlider-thumb": {
                                    width: 20, // Increase thumb size
                                    height: 20,
                                },
                            }}
                        />
                    )}
                    {imageList.length > 0 && (
                        <div style={{ gridColumn: "2", display: "block", height: "50px", justifySelf: "center", gap: "20px" }}>
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
                            {/* {imageIndex === imageList.length - 1 ? (
                                <Button variant="contained" color="warning" onClick={() => setOrthoModalOpen(true)}>
                                    Generate Orthophoto
                                </Button>
                            ) : (
                                <Button variant="contained" onClick={handleNext}>
                                    Next
                                </Button>
                            )} */}
                        </div>
                    )}
                    <OrthoModal />
                </div>
        </Dialog>
    );
};

export default ImageViewer;
