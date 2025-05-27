import React, { useState, useEffect } from "react";
import { Button, CircularProgress, Dialog, DialogTitle } from "@mui/material";
import Slider from "@mui/material/Slider";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import IconButton from "@mui/material/IconButton";
import Checkbox from "@mui/material/Checkbox";
import { useDataState } from "../../DataContext";
import { Typography } from "@mui/material";

const SLIDER_RAIL_HEIGHT = 10;
const SLIDER_THUMB_SIZE = 20;

export const RestoreImageSelector = ({ open, onClose, sourceDirectory }) => {
    const { flaskUrl } = useDataState();
    const [imageIndex, setImageIndex] = useState(0);
    const [imageList, setImageList] = useState([]);
    const [imageViewerLoading, setImageViewerLoading] = useState(false);
    const [imageLoading, setImageLoading] = useState(false);
    const [selectedImages, setSelectedImages] = useState(new Set());
    const [sliderMarks, setSliderMarks] = useState([]);
    const [nextImageUrl, setNextImageUrl] = useState(null);
    const [prevImageUrl, setPrevImageUrl] = useState(null);

    const API_ENDPOINT = `${flaskUrl}files`;
    const removedDirectory = sourceDirectory.replace("/Images/", "/Removed/");

    useEffect(() => {
        if (open) fetchImages();
    }, [open]);

    const fetchImages = async () => {
        try {
            setImageViewerLoading(true);
            const response = await fetch(`${flaskUrl}list_files/${removedDirectory}`);
            const data = await response.json();

            if (Array.isArray(data)) {
                setImageList(data);
            } else {
                console.warn("Unexpected response format:", data);
                setImageList([]);  // Prevent map errors
            }
            setImageViewerLoading(false);
        } catch (error) {
            console.error("Error fetching removed images:", error);
            setImageViewerLoading(false);
        }
    };

    const handleImageLoadEnd = () => {
        setImageLoading(false);
    };

    const handleRestoreSelectedImages = async () => {
        const payload = {
            images: Array.from(selectedImages),
            removed_dir: removedDirectory,
        };

        try {
            const response = await fetch(`${flaskUrl}restore_images`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (response.ok) {
                const updatedList = imageList.filter(name => !selectedImages.has(name));
                setImageList(updatedList);
                setSelectedImages(new Set());
                setImageIndex(0);
                onClose();
            } else {
                console.error("Failed to restore selected images.");
            }
        } catch (error) {
            console.error("Error restoring selected images:", error);
        }
    };

    useEffect(() => {
        const marks = imageList.map((_, index) => ({
            value: index,
            label: selectedImages.has(imageList[index])
                ? <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: 'green', marginTop: 4 }} />
                : <div style={{ width: 10, height: 10 }} />,
        }));
        setSliderMarks(marks);
    }, [imageList, selectedImages]);

    useEffect(() => {
        if (imageList.length > 0 && open) {
            if (imageIndex < imageList.length - 1) {
                const nextUrl = `${API_ENDPOINT}/${removedDirectory}${imageList[imageIndex + 1]}`;
                setNextImageUrl(nextUrl);
            } else {
                setNextImageUrl(null);
            }

            if (imageIndex > 0) {
                const prevUrl = `${API_ENDPOINT}/${removedDirectory}${imageList[imageIndex - 1]}`;
                setPrevImageUrl(prevUrl);
            } else {
                setPrevImageUrl(null);
            }
        }
    }, [imageIndex, imageList, API_ENDPOINT, removedDirectory, open]);

    useEffect(() => {
        if (!open) return;

        const handleKeyDown = (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
                if (imageIndex > 0) setImageIndex(imageIndex - 1);
            } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
                if (imageIndex < imageList.length - 1) setImageIndex(imageIndex + 1);
            } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
                const jumpAmount = 5;
                setImageIndex(Math.max(0, imageIndex - jumpAmount));
            } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
                const jumpAmount = 5;
                setImageIndex(Math.min(imageList.length - 1, imageIndex + jumpAmount));
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [open, imageIndex, imageList.length]);

    return (
        <Dialog
            open={open}
            onClose={onClose}
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
            <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: '5px', gap: '5px' }}>
                <DialogTitle align="center">Restore Removed Images</DialogTitle>

                {imageList.length === 0 && !imageViewerLoading && (
                    <Typography align="center" color="textSecondary" sx={{ mt: 2 }}>
                        No removed images found.
                    </Typography>
                )}

                <IconButton
                    onClick={onClose}
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

                {imageList.length > 0 && (
                    <>
                        <div style={{ flexGrow: 1, display: "flex", justifyContent: "center", alignItems: "center", overflow: "auto", position: "relative", height: "50vh" }}>
                            {imageViewerLoading || imageLoading ? (
                                <CircularProgress style={{ position: 'absolute' }} />
                            ) : (
                                <div style={{ position: "relative", display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "100%", maxWidth: "100%" }}>
                                    
                                    <div
                                        style={{
                                            position: "relative",
                                            display: "flex",
                                            justifyContent: "center",
                                            alignItems: "center",
                                            width: "100%",
                                            height: "100%",
                                        }}
                                    >
                                        <img
                                            src={`${API_ENDPOINT}/${removedDirectory}${imageList[imageIndex]}`}
                                            alt={`Image ${imageIndex + 1}`}
                                            style={{
                                                maxWidth: "100%",
                                                maxHeight: "100%",
                                                objectFit: "contain",
                                                cursor: 'pointer',
                                                display: imageLoading ? 'none' : 'block'
                                            }}
                                            onClick={() => {
                                                const name = imageList[imageIndex];
                                                setSelectedImages(prev => {
                                                    const updated = new Set(prev);
                                                    if (updated.has(name)) updated.delete(name);
                                                    else updated.add(name);
                                                    return updated;
                                                });
                                            }}
                                            onLoad={handleImageLoadEnd}
                                        />

                                        {/* Green overlay border if selected */}
                                        {selectedImages.has(imageList[imageIndex]) && (
                                            <div
                                                style={{
                                                    position: 'absolute',
                                                    top: 0,
                                                    left: 0,
                                                    width: '100%',
                                                    height: '100%',
                                                    border: '5px solid green',
                                                    boxSizing: 'border-box',
                                                    pointerEvents: 'none',
                                                }}
                                            />
                                        )}

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
                                    </div>

                                    {/* Hidden images for preloading */}
                                    {nextImageUrl && (
                                        <img src={nextImageUrl} alt="Next preload" style={{ display: 'none' }} />
                                    )}
                                    {prevImageUrl && (
                                        <img src={prevImageUrl} alt="Previous preload" style={{ display: 'none' }} />
                                    )}
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', gap: '5px', marginBottom: '20px' }}>
                            <Slider
                                value={imageIndex}
                                onChange={(_, newValue) => {
                                    setImageIndex(newValue);
                                    setImageLoading(true);
                                }}
                                aria-labelledby="restore-image-slider"
                                step={1}
                                min={0}
                                max={imageList.length - 1}
                                marks={sliderMarks}
                                valueLabelDisplay="auto"
                                valueLabelFormat={(value) => `${value + 1} of ${imageList.length}`}
                                track={false}
                                sx={{
                                    width: '80%',
                                    "& .MuiSlider-rail": { height: SLIDER_RAIL_HEIGHT },
                                    "& .MuiSlider-thumb": { width: SLIDER_THUMB_SIZE, height: SLIDER_THUMB_SIZE },
                                }}
                            />

                            <div style={{ marginTop: '10px', display: 'flex', gap: '20px' }}>
                                <Button variant="contained" color="success" onClick={handleRestoreSelectedImages}>Done</Button>
                                <Button variant="text" color="error" onClick={onClose}>Cancel</Button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </Dialog>

    );
};

export default RestoreImageSelector;
