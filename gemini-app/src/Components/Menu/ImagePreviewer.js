import React, { useState, useEffect } from "react";
import { Button, CircularProgress, Dialog, DialogTitle, Typography } from "@mui/material";
import Slider from "@mui/material/Slider";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import IconButton from "@mui/material/IconButton";
import { useDataState } from "../../DataContext";
import Checkbox from "@mui/material/Checkbox";
import RestoreImageSelector from './RestoreImageSelector';

export const ImagePreviewer = ({ open, obj, onClose }) => {
    const [imageIndex, setImageIndex] = useState(0);
    const [imageList, setImageList] = useState([]);
    const [imageViewerLoading, setImageViewerLoading] = useState(false);
    const {flaskUrl} = useDataState();
    const [directory, setDirectory] = useState("");
    const [imageLoading, setImageLoading] = useState(false);
    const [nextImageUrl, setNextImageUrl] = useState(null);
    const [prevImageUrl, setPrevImageUrl] = useState(null);

    // for image removal selection
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedImages, setSelectedImages] = useState(new Set());
    const [sliderMarks, setSliderMarks] = useState([]);
    const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
    const [showRestoreView, setShowRestoreView] = useState(false);

    useEffect(() => {
        if (open) {
            setImageIndex(0);
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

    useEffect(() => {
        if (!open) return;
        
        const handleKeyDown = (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
                handlePrevious();
            } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
                handleNext();
            } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
                const jumpAmount = 5;
                if (imageIndex - jumpAmount >= 0) {
                    setImageIndex(imageIndex - jumpAmount);
                    setImageLoading(true);
                } else {
                    setImageIndex(0);
                    setImageLoading(true);
                }
            } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
                const jumpAmount = 5;
                if (imageIndex + jumpAmount < imageList.length) {
                    setImageIndex(imageIndex + jumpAmount);
                    setImageLoading(true);
                } else {
                    setImageIndex(imageList.length - 1);
                    setImageLoading(true);
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open, imageIndex, imageList.length, handlePrevious, handleNext]);

    useEffect(() => {
        if (!imageList.length) return;
    
        const marks = imageList.map((_, index) => ({
            value: index,
            label: selectedImages.has(imageList[index])
                ? <div style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    backgroundColor: 'red',
                    marginTop: 4
                }} />
                : <div style={{ width: 10, height: 10 }} /> // empty placeholder for spacing
        }));
    
        setSliderMarks(marks);
    }, [imageList, selectedImages]);

    useEffect(() => {
        if (imageList.length > 0 && open) {
            if (imageIndex < imageList.length - 1) {
                const nextUrl = `${API_ENDPOINT}/${directory}${imageList[imageIndex + 1]}`;
                setNextImageUrl(nextUrl);
            } else {
                setNextImageUrl(null);
            }
            
            if (imageIndex > 0) {
                const prevUrl = `${API_ENDPOINT}/${directory}${imageList[imageIndex - 1]}`;
                setPrevImageUrl(prevUrl);
            } else {
                setPrevImageUrl(null);
            }
        }
    }, [imageIndex, imageList, API_ENDPOINT, directory, open]);

    const SLIDER_RAIL_HEIGHT = 10;
    const SLIDER_THUMB_SIZE = 20;

    const handleRemoveSelectedImages = async () => {
        const payload = {
            images: Array.from(selectedImages),
            source_dir: directory,
        };
    
        try {
            const response = await fetch(`${flaskUrl}remove_images`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
    
            if (response.ok) {
                console.log("Images removed:", payload.images);
    
                const updatedList = imageList.filter(name => !selectedImages.has(name));
                setImageList(updatedList);
    
                // Reset state
                setSelectedImages(new Set());
                setSelectionMode(false);
                setImageIndex(0);
            } else {
                console.error("Failed to remove selected images.");
            }
        } catch (error) {
            console.error("Error removing selected images:", error);
        }
    };    

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
            {showRestoreView ? (
                <RestoreImageSelector
                open={true}
                onClose={() => setShowRestoreView(false)}
                sourceDirectory={directory}
                />
            ) : (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        height: "100%",
                        padding: '5px',
                        gap: '5px'
                    }}
                >
                    <DialogTitle align="center">View Images and Select Images to be Removed</DialogTitle>

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
                        <div style={{
                            position: "relative",
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            maxHeight: "100%",
                            maxWidth: "100%",
                        }}>
                            <div
                                style={{
                                    position: 'relative',
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    width: '100%',
                                    height: '100%',
                                }}
                            >
                                {/* Image */}
                                <img
                                    src={`${API_ENDPOINT}/${directory}${imageList[imageIndex]}`}
                                    alt={`Image ${imageIndex + 1}`}
                                    style={{
                                        maxWidth: "100%",
                                        maxHeight: "100%",
                                        objectFit: "contain",
                                        cursor: selectionMode ? 'pointer' : 'default',
                                        display: imageLoading ? 'none' : 'block'
                                    }}
                                    onClick={() => {
                                        if (selectionMode) {
                                            const name = imageList[imageIndex];
                                            setSelectedImages(prev => {
                                                const updated = new Set(prev);
                                                if (updated.has(name)) updated.delete(name);
                                                else updated.add(name);
                                                return updated;
                                            });
                                        }
                                    }}
                                    onLoad={handleImageLoadEnd}
                                    hidden={imageLoading}
                                />

                                {/* Red border overlay if selected */}
                                {selectionMode && selectedImages.has(imageList[imageIndex]) && (
                                    <div
                                        style={{
                                            position: 'absolute',
                                            top: 0,
                                            left: 0,
                                            width: '100%',
                                            height: '100%',
                                            border: '5px solid red',
                                            boxSizing: 'border-box',
                                            pointerEvents: 'none',
                                        }}
                                    />
                                )}

                                {/* Checkbox overlay for selection mode */}
                                {selectionMode && (
                                    <Checkbox
                                        checked={selectedImages.has(imageList[imageIndex])}
                                        onChange={() => {
                                            const name = imageList[imageIndex];
                                            setSelectedImages(prev => {
                                                const updated = new Set(prev);
                                                if (updated.has(name)) updated.delete(name);
                                                else updated.add(name);
                                                return updated;
                                            });
                                        }}
                                        style={{
                                            position: "absolute",
                                            top: 10,
                                            right: 10,
                                            backgroundColor: "rgba(255,255,255,0.7)",
                                            borderRadius: "50%",
                                        }}
                                    />
                                )}
                            </div>
                        </div>
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
                                onChange={(_, newValue) => {
                                    setImageIndex(newValue);
                                    setImageLoading(true);
                                }}
                                aria-labelledby="image-slider"
                                step={1}
                                min={0}
                                max={imageList.length - 1}
                                marks={sliderMarks}
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
                                position: 'relative',
                                width: '80%',
                                height: '50px',
                                marginTop: '10px',
                            }}>

                                {/* Left: Restore Removed */}
                                {!selectionMode && (
                                    <div style={{
                                        position: 'absolute',
                                        left: 0,
                                        top: '50%',
                                        transform: 'translateY(-65%)',
                                    }}>
                                        <Button
                                            variant="outlined"
                                            color="primary"
                                            onClick={() => setShowRestoreView(true)}
                                        >
                                            Restore Removed
                                        </Button>
                                    </div>
                                )}

                                {/* Center: Previous / Next */}
                                <div style={{
                                    position: 'absolute',
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    display: 'flex',
                                    gap: '20px',
                                }}>
                                    <Button variant="contained" onClick={handlePrevious}>Previous</Button>
                                    <Button variant="contained" onClick={handleNext}>Next</Button>
                                </div>

                                {/* Right: Select to Remove or Done/Cancel */}
                                <div style={{
                                    position: 'absolute',
                                    right: 0,
                                    top: '50%',
                                    transform: 'translateY(-65%)',
                                }}>
                                    {!selectionMode ? (
                                        <Button 
                                            variant="outlined" 
                                            color="secondary" 
                                            onClick={() => setSelectionMode(true)}
                                        >
                                            Select to Remove
                                        </Button>
                                    ) : (
                                        <>
                                            <Button 
                                                variant="contained" 
                                                color="success" 
                                                onClick={handleRemoveSelectedImages}
                                            >
                                                Done
                                            </Button>
                                            <Button 
                                                variant="text" 
                                                color="error" 
                                                onClick={() => {
                                                    setSelectionMode(false);
                                                    setSelectedImages(new Set());
                                                }}
                                            >
                                                Cancel
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                    
                    {/* Hidden images for preloading */}
                    {nextImageUrl && (
                        <img 
                            src={nextImageUrl} 
                            alt="Next preload" 
                            style={{ display: 'none' }} 
                        />
                    )}
                    {prevImageUrl && (
                        <img 
                            src={prevImageUrl} 
                            alt="Previous preload" 
                            style={{ display: 'none' }} 
                        />
                    )}
                </div>
            )}
        </Dialog>
    );
};
