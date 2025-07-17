import React, { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Button,
    CircularProgress,
    Box,
    Slider,
    Typography
} from '@mui/material';
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useDataState } from "../../DataContext";

export const GroundPlotMarker = ({ open, obj, onClose }) => {
    const [imageIndex, setImageIndex] = useState(0);
    const [imageList, setImageList] = useState([]);
    const [imageViewerLoading, setImageViewerLoading] = useState(false);
    const {flaskUrl} = useDataState();
    const [directory, setDirectory] = useState("");
    const [imageLoading, setImageLoading] = useState(false);
    const [plotSelectionState, setPlotSelectionState] = useState('start');
    const imageRef = React.useRef(null);
    const [plotIndex, setPlotIndex] = useState(0);

    useEffect(() => {
        if (open && obj) {
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

    const handlePlotSelection = async () => {
        const imageName = imageList[imageIndex];
        const endpoint = plotSelectionState === 'start' ? 'mark_plot_start' : 'mark_plot_end';

        try {
            const response = await fetch(`${flaskUrl}${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    directory: directory,
                    image_name: imageName,
                    plot_index: plotIndex,
                    camera: obj.camera,
                }),
            });

            if (response.ok) {
                if (plotSelectionState === 'start') {
                    setPlotSelectionState('end');
                } else {
                    setPlotIndex(plotIndex + 1);
                    setPlotSelectionState('start');
                }
            } else {
                console.error("Failed to mark plot");
            }
        } catch (error) {
            console.error("Error marking plot:", error);
        }
    };

    useEffect(() => {
        if (!open) return;
        
        const handleKeyDown = (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
                handlePrevious();
            } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
                handleNext();
            } else if (e.key === 'ArrowUp') {
                const newIndex = Math.min(imageList.length - 1, imageIndex + 10);
                if (newIndex !== imageIndex) {
                    setImageIndex(newIndex);
                    setImageLoading(true);
                }
            } else if (e.key === 'ArrowDown') {
                const newIndex = Math.max(0, imageIndex - 10);
                if (newIndex !== imageIndex) {
                    setImageIndex(newIndex);
                    setImageLoading(true);
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open, imageIndex, imageList.length]);

    return (
        <Dialog
            open={open}
            onClose={handleBackButton}
            fullScreen
            PaperProps={{
                style: {
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
                <DialogTitle>
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
                </DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                    <Typography variant="h6" style={{ marginBottom: '10px' }}>
                        Match the mid line with the start / end of the plot.
                    </Typography>
                    {imageViewerLoading ? (
                        <CircularProgress />
                    ) : (
                        <Box
                            sx={{
                                position: 'relative',
                                width: '100%',
                                height: '400px',
                                overflow: 'hidden',
                            }}
                        >
                            {imageList.length > 0 && (
                                <img
                                    ref={imageRef}
                                    src={`${API_ENDPOINT}/${directory}${imageList[imageIndex]}`}
                                    alt={`Image ${imageIndex + 1}`}
                                    style={{
                                        position: 'absolute',
                                        width: `100%`,
                                        height: `100%`,
                                        objectFit: "contain",
                                        pointerEvents: 'none',
                                        display: imageLoading ? 'none' : 'block'
                                    }}
                                    hidden={imageLoading}
                                    onLoad={handleImageLoadEnd}
                                />
                            )}
                            <div style={{
                                position: 'absolute',
                                top: 0,
                                bottom: 0,
                                left: '50%',
                                borderLeft: '2px dashed white',
                                transform: 'translateX(-50%)'
                            }} />
                        </Box>
                    )}
                    <Typography>Image {imageIndex + 1} of {imageList.length}</Typography>
                    <Box sx={{ width: '80%', mt: 2, position: 'relative' }}>
                        <Slider
                            value={imageIndex}
                            onChange={(e, newValue) => {
                                if (newValue !== imageIndex) {
                                    setImageIndex(newValue);
                                    setImageLoading(true);
                                }
                            }}
                            aria-labelledby="image-slider"
                            min={0}
                            max={imageList.length > 0 ? imageList.length - 1 : 0}
                        />
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', mt: 4 }}>
                        <Button variant="contained" onClick={handlePrevious} disabled={imageIndex === 0}>Previous</Button>
                        <Button
                            variant="contained"
                            style={{ backgroundColor: plotSelectionState === 'start' ? 'green' : 'red', color: 'white' }}
                            onClick={handlePlotSelection}
                        >
                            {plotSelectionState === 'start' ? 'Start' : 'End'}
                        </Button>
                        <Button variant="contained" onClick={handleNext} disabled={imageIndex === imageList.length - 1}>Next</Button>
                    </Box>
                </DialogContent>
            </div>
        </Dialog>
    );
};
