import React, { useState, useEffect } from "react";
import { useDataState, useDataSetters } from "../../DataContext";
import {
    Button,
    CircularProgress,
    Dialog,
    Typography,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    TextField
} from "@mui/material";
import Slider from "@mui/material/Slider";
import PointPicker from "./PointPicker";
import { OrthoModal } from "./OrthoModal";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import IconButton from "@mui/material/IconButton";
//import FileUploadComponent from "../Menu/FileUpload";
import useTrackComponent from "../../useTrackComponent";
import fetchAndSetGcpFilePath from "./TabComponents/Checklist";
import { fetchData } from "../../DataContext";

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
        isOrthoProcessing,
        prepGcpFilePath,
        selectedDateGCP,
        selectedPlatformGCP,
        selectedSensorGCP,
        selectedYearGCP,
        selectedExperimentGCP,
        selectedLocationGCP,
        selectedPopulationGCP,
        isImageViewerReady
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
        setSelectedSensorGCP,
        setPrepGcpFilePath,
        setImageViewerReady
    } = useDataSetters();
    
    const [dialogOpen, setDialogOpen] = useState(false);
    const uploadFileWithTimeout = async (file, timeout = 30000) => {
        const Values = {
            year: selectedYearGCP,
            experiment: selectedExperimentGCP,
            location: selectedLocationGCP,
            population: selectedPopulationGCP,
            date: selectedDateGCP,
            platform: selectedPlatformGCP,
            sensor: selectedSensorGCP,
        };
        const gcpLocations = {
            fields: ["year", "experiment", "location", "population"],
            fileType: ".csv",
            label: "GCP Locations"
        };
        let dirPath = "";
        for (const field of gcpLocations.fields) {
            if (Values[field]) {
                dirPath += dirPath ? `/${Values[field]}` : Values[field];
            }
        }
        const formData = new FormData();
        formData.append("files", file);
        formData.append("dirPath", dirPath);
        formData.append("dataType", "gcpLocations");
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(`${flaskUrl}upload`, {
                method: "POST",
                body: formData,
                signal: controller.signal,
            });
            console.log(response)
            clearTimeout(id);
            return response;
        } catch (error) {
            console.log("Upload error:", error);
            clearTimeout(id);
            throw error;
        }
    };

    const fetchAndSetGcpFilePath = async () => {
        console.log('${flaskUrl', flaskUrl);
        const files = await fetchData(`${flaskUrl}list_files/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`);
        const gcpLocationsFile = files.find((file) => file === "gcp_locations.csv");
        if (gcpLocationsFile) {
            const newPath = `Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${gcpLocationsFile}`;
            setPrepGcpFilePath(newPath);
            console.log("GCP path found, setting to ", newPath);
        } else {
            setPrepGcpFilePath("");
            console.log("No GCP path found");
        }
    };

    const handleFileUpload = async (event) => {
        await uploadFileWithTimeout(event.target.files[0]);
        await fetchAndSetGcpFilePath();
        console.log("prepGcpFilePath after setting: ", prepGcpFilePath);
    };

    const handleDialogClose = () => {
        setDialogOpen(false);
        setImageViewerReady(true);
        setIsImageViewerOpen(true);
    };

    // update state variables
    useEffect(() => {
        if (open) {
            setImageViewerReady(false);
            console.log("prepGcpFilePath initial: ", prepGcpFilePath);
            setSelectedDateGCP(item.date);
            setSelectedPlatformGCP(platform);
            setSelectedSensorGCP(sensor);
            //fetchAndSetGcpFilePath();
            if (prepGcpFilePath != "") {
                setImageViewerReady(true);
                setIsImageViewerOpen(true);
            } else {
                setDialogOpen(true);
            }
        }
        return () => {
            if (!open) {
                setIsImageViewerOpen(false);
                setImageViewerLoading(true);
            }
        };
    }, [open, item, sensor, setIsImageViewerOpen, prepGcpFilePath]);

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
        setDialogOpen(false);
        onClose();
    };

    const SLIDER_RAIL_HEIGHT = 10;
    const SLIDER_THUMB_SIZE = 20;

    return (
        <>
            <Dialog
                open={isImageViewerOpen}
                onClose={handleBackButton}
                fullScreen
                fullWidth={true}
                maxWidth={'xl'}
                PaperProps={{
                    style: {
                        minHeight: '90vh', // Ensures that the dialog takes up most of the viewport height
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden', // Prevents internal scroll bars by managing overflow
                        padding: '5px', // Adds padding around the dialog content
                    }
                }}
            >
                
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        height: "100%", // Full height of the dialog
                        padding: '5px',
                        gap: '5px',
                        // marginBottom: '10px'
                    }}
                >


                    <IconButton
                        onClick={handleBackButton}
                        style={{
                            position: "absolute",
                            top: "10px",
                            left: "10px",
                            zIndex: 10,
                            width: '40px',
                            height: '40px',
                            backgroundColor: '#3874cb',
                        }}
                        size="large"
                    >
                        <ArrowBackIcon style={{ color: "white", fontSize: '2rem' }} />
                    </IconButton>

                    <div style={{
                        flexGrow: 1,
                        // gridColumn: "2",
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        overflow: "auto",
                        // padding: "10px",
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
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center', // Centers content horizontally in the flex container
                            justifyContent: 'center', // Centers content vertically in the flex container
                            width: '100%', // Ensures the container takes the full width of its parent
                            gap: '5px', // Adds space between the slider and button container
                            marginBottom: '20px',
                        }}>
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
                                sx={{
                                    width: '80%', // Adjust this value to control the slider's width
                                    "& .MuiSlider-rail": {
                                        height: SLIDER_RAIL_HEIGHT,
                                    },
                                    "& .MuiSlider-thumb": {
                                        width: SLIDER_THUMB_SIZE,
                                        height: SLIDER_THUMB_SIZE,
                                    },
                                }}
                            />
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-around', // Evenly spaces items along the line
                                // width: '80%', // Match the slider width for alignment,
                                gap: '20px', // Adds space between the buttons
                            }}>
                                <Button variant="contained" onClick={handlePrevious}>Previous</Button>
                                <Button variant="contained" onClick={handleNext}>Next</Button>
                                <Button variant="contained" color="warning" onClick={() => setOrthoModalOpen(true)}>Generate Orthophoto</Button>
                            </div>
                        </div>
                    )}
                    <OrthoModal />
                </div>
            </Dialog>
            <Dialog open={dialogOpen} onClose={handleDialogClose}>
                <DialogTitle>Upload GCP Locations</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Please upload the gcp_locations.csv file before proceeding for maximum orthomosaic quality.
                    </DialogContentText>
                    <TextField
                        type="file"
                        onChange={handleFileUpload}
                        fullWidth 
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleDialogClose} color="primary">
                        Continue without GCP
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default ImageViewer;
