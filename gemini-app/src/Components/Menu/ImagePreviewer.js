import React, { useState, useEffect } from "react";
import { Button, CircularProgress, Dialog, DialogTitle, Typography } from "@mui/material";
import Slider from "@mui/material/Slider";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import IconButton from "@mui/material/IconButton";
import { useDataState } from "../../DataContext";

export const ImagePreviewer = ({ open, obj, onClose }) => {
    const [imageIndex, setImageIndex] = useState(0);
    const [imageList, setImageList] = useState([]);
    const [imageViewerLoading, setImageViewerLoading] = useState(false);
    const {flaskUrl} = useDataState();
    const [directory, setDirectory] = useState("");
    const [imageLoading, setImageLoading] = useState(false);

    useEffect(() => {
        if (open) {
            if(obj.platform === 'rover'){
                const newDirectory = `Raw/${obj.year}/${obj.experiment}/${obj.location}/${obj.population}/${obj.date}/${obj.platform}/RGB/Images/${obj.camera}/`;
                setDirectory(newDirectory);
            }
            else {
                const newDirectory = `Raw/${obj.year}/${obj.experiment}/${obj.location}/${obj.population}/${obj.date}/${obj.platform}/${obj.sensor}/Images/`;
                setDirectory(newDirectory);
            }
        }
    }, [open, obj]);

    useEffect(() => {
        if (directory) {
            fetchImages();
        }
    }, [directory]);

    const API_ENDPOINT = `${flaskUrl}files`;

    const fetchImages = async () => {
        try {
            setImageViewerLoading(true);
            const response = await fetch(`${flaskUrl}list_files/${directory}`);
            const data = await response.json();
            setImageList(data);
            setImageViewerLoading(false);
        } catch (error) {
            console.error("Error fetching images:", error);
            setImageViewerLoading(false);
        }
    };

    const handlePrevious = () => {
        if (imageIndex > 0) {
            setImageIndex(imageIndex - 1);
            setImageLoading(true);
        }
    };

    const handleNext = () => {
        if (imageIndex < imageList.length - 1) {
            setImageIndex(imageIndex + 1);
            setImageLoading(true);
        }
    };

    const handleBackButton = () => {
        onClose();
    };

    const handleImageLoadEnd = () => {
        setImageLoading(false);
    };
    const SLIDER_RAIL_HEIGHT = 10;
    const SLIDER_THUMB_SIZE = 20;

    return (
        <Dialog
            open={open}
            onClose={handleBackButton}
            maxWidth="md"
            fullWidth
            PaperProps={{
                style: {
                    minHeight: '60vh',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    padding: '5px'
                }
            }}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    height: "100%",
                    padding: '5px',
                    gap: '5px'
                }}
            >
                <DialogTitle align="center">View Images</DialogTitle>

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
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    overflow: "auto",
                    position: "relative",
                    height: "50vh",
                }}>
                    <div style={{
                        position: "absolute",
                        display: imageLoading || imageViewerLoading ? "flex" : "none",
                        justifyContent: "center",
                        alignItems: "center",
                        width: "100%",
                        height: "100%",
                    }}>
                        <CircularProgress />
                    </div>
                    <img
                        src={`${API_ENDPOINT}/${directory}${imageList[imageIndex]}`}
                        alt={`Image ${imageIndex + 1}`}
                        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                        onLoad={handleImageLoadEnd}
                        hidden={imageLoading}
                    />
                </div>

                {imageList.length > 0 && (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '100%',
                        gap: '5px',
                        marginBottom: '20px',
                    }}>
                        <Slider
                            value={imageIndex}
                            onChange={(_, newValue) => {setImageIndex(newValue); setImageLoading(true);}}
                            aria-labelledby="image-slider"
                            step={1}
                            min={0}
                            max={imageList.length - 1}
                            valueLabelDisplay="auto"
                            valueLabelFormat={(value) => `${value + 1} of ${imageList.length}`}
                            track={false}
                            sx={{
                                width: '80%',
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
                            justifyContent: 'space-around',
                            gap: '20px',
                        }}>
                            <Button variant="contained" onClick={handlePrevious}>Previous</Button>
                            <Button variant="contained" onClick={handleNext}>Next</Button>
                        </div>
                    </div>
                )}
            </div>
        </Dialog>
    );
};
