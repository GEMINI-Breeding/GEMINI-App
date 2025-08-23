import React, { useState, useEffect, useRef } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    IconButton,
    CircularProgress,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Slider,
    FormControlLabel,
    Switch,
    Paper,
    Chip,
    Grid
} from '@mui/material';
import { ArrowBack, ArrowForward, Close, ZoomIn, ZoomOut, FitScreen, Download } from '@mui/icons-material';
import { fetchData, useDataState } from "../../DataContext";

const InferenceResultsPreview = ({ open, onClose, inferenceData }) => {
    const [plotImages, setPlotImages] = useState([]);
    const [currentPlotIndex, setCurrentPlotIndex] = useState(0);
    const [currentImageUrl, setCurrentImageUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [panX, setPanX] = useState(0);
    const [panY, setPanY] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
    const [isImageLoaded, setIsImageLoaded] = useState(false);
    const [showBoundingBoxes, setShowBoundingBoxes] = useState(true);
    const [predictions, setPredictions] = useState([]);
    const [classCounts, setClassCounts] = useState({});
    const [confidenceThreshold, setConfidenceThreshold] = useState(0.5);
    const [selectedClasses, setSelectedClasses] = useState(new Set());
    const [plotData, setPlotData] = useState({});
    
    const imageRef = useRef(null);
    const imageContainerRef = useRef(null);
    const canvasRef = useRef(null);
    
    const { flaskUrl, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP } = useDataState();

    // Generate distinct colors for different classes
    const generateClassColors = (classes) => {
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
            '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
            '#F8C471', '#82E0AA', '#F1948A', '#85C1E9', '#D7DBDD'
        ];
        
        const classColors = {};
        classes.forEach((className, index) => {
            classColors[className] = colors[index % colors.length];
        });
        
        return classColors;
    };

    const [classColors, setClassColors] = useState({});

    useEffect(() => {
        if (open && inferenceData) {
            fetchPlotImages();
            fetchPlotData();
        }
        
        if (open) {
            setZoom(1);
            setPanX(0);
            setPanY(0);
            setIsImageLoaded(false);
            setShowBoundingBoxes(true);
            setConfidenceThreshold(0.5);
        }
        
        return () => {
            if (currentImageUrl && currentImageUrl.startsWith('blob:')) {
                URL.revokeObjectURL(currentImageUrl);
            }
        };
    }, [open, inferenceData, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP, flaskUrl]);

    useEffect(() => {
        // Fetch predictions when plot changes
        if (plotImages.length > 0 && currentPlotIndex < plotImages.length) {
            fetchPredictionsForCurrentPlot();
        }
    }, [currentPlotIndex, plotImages, inferenceData]);

    useEffect(() => {
        // Update class colors when predictions change
        if (predictions.length > 0) {
            const classes = [...new Set(predictions.map(p => p.class))];
            setClassColors(generateClassColors(classes));
            setSelectedClasses(new Set(classes)); // Show all classes by default
        }
    }, [predictions]);

    useEffect(() => {
        // Redraw bounding boxes when relevant state changes
        if (isImageLoaded && showBoundingBoxes) {
            drawBoundingBoxes();
        }
    }, [isImageLoaded, showBoundingBoxes, predictions, confidenceThreshold, selectedClasses, classColors, zoom, panX, panY]);

    useEffect(() => {
        // Set up ResizeObserver to update canvas when image size changes
        let resizeObserver;
        
        if (imageRef.current) {
            resizeObserver = new ResizeObserver(() => {
                if (isImageLoaded && showBoundingBoxes) {
                    drawBoundingBoxes();
                }
            });
            
            resizeObserver.observe(imageRef.current);
        }
        
        // Also listen for window resize events
        const handleWindowResize = () => {
            if (isImageLoaded && showBoundingBoxes) {
                setTimeout(() => drawBoundingBoxes(), 100); // Small delay to ensure layout is updated
            }
        };
        
        window.addEventListener('resize', handleWindowResize);
        
        return () => {
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
            window.removeEventListener('resize', handleWindowResize);
        };
    }, [imageRef.current, isImageLoaded, showBoundingBoxes]);

    const fetchPlotImages = async () => {
        if (!inferenceData) return;
        
        const { date, platform, sensor, agrowstitch_version, orthomosaic } = inferenceData;
        // Use orthomosaic if available, otherwise fall back to agrowstitch_version for backward compatibility
        const versionDir = orthomosaic || agrowstitch_version;
        setLoading(true);
        
        try {
            const plotFiles = await fetchData(
                `${flaskUrl}list_files/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/${versionDir}`
            );

            const plotImages = plotFiles
                .filter(file => file.startsWith('full_res_mosaic_temp_plot_') && file.endsWith('.png'))
                .sort((a, b) => {
                    const plotNumA = parseInt(a.match(/plot_(\d+)/)?.[1] || 0);
                    const plotNumB = parseInt(b.match(/plot_(\d+)/)?.[1] || 0);
                    return plotNumA - plotNumB;
                });

            setPlotImages(plotImages);
            setCurrentPlotIndex(0);
            setLoading(false);

            if (plotImages.length > 0) {
                loadPlotImage(plotImages[0], date, platform, sensor, versionDir);
            }
            
        } catch (error) {
            console.error('Error fetching plot images:', error);
            setLoading(false);
        }
    };

    const fetchPlotData = async () => {
        try {
            const response = await fetch(`${flaskUrl}get_plot_borders_data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                }),
            });

            if (response.ok) {
                const data = await response.json();
                setPlotData(data.plot_data || {});
            }
        } catch (error) {
            console.error('Error fetching plot data:', error);
            setPlotData({});
        }
    };

    const fetchPredictionsForCurrentPlot = async () => {
        if (!inferenceData || plotImages.length === 0) return;
        
        const currentFileName = plotImages[currentPlotIndex];
        const { date, platform, sensor, agrowstitch_version, orthomosaic } = inferenceData;
        const versionDir = orthomosaic || agrowstitch_version;
        
        try {
            const response = await fetch(`${flaskUrl}get_plot_predictions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date,
                    platform,
                    sensor,
                    agrowstitch_version: versionDir, // Keep for backend compatibility
                    orthomosaic: versionDir, // New parameter name
                    plot_filename: currentFileName
                })
            });

            if (response.ok) {
                const data = await response.json();
                setPredictions(data.predictions || []);
                setClassCounts(data.class_counts || {});
            } else {
                console.error('Error fetching predictions:', response.status);
                setPredictions([]);
                setClassCounts({});
            }
        } catch (error) {
            console.error('Error fetching predictions:', error);
            setPredictions([]);
            setClassCounts({});
        }
    };

    const loadPlotImage = async (fileName, date, platform, sensor, versionDir) => {
        try {
            if (currentImageUrl && currentImageUrl.startsWith('blob:')) {
                URL.revokeObjectURL(currentImageUrl);
            }

            const imagePath = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/${versionDir}/${fileName}`;
            
            const directUrl = `${flaskUrl}files/${imagePath}`;
            
            try {
                const directResponse = await fetch(directUrl);
                if (directResponse.ok) {
                    setCurrentImageUrl(directUrl);
                    setZoom(1);
                    setIsImageLoaded(false);
                    return;
                }
            } catch (directError) {
                console.log('Direct file serving failed, trying blob method');
            }
            
            const response = await fetch(`${flaskUrl}get_png_file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: imagePath }),
            });

            if (response.ok) {
                const blob = await response.blob();
                if (blob.size > 0) {
                    const imageUrl = URL.createObjectURL(blob);
                    setCurrentImageUrl(imageUrl);
                    setZoom(1);
                    setIsImageLoaded(false);
                }
            }
        } catch (error) {
            console.error('Error loading plot image:', error);
            setCurrentImageUrl('');
        }
    };

    const handleImageLoad = (event) => {
        const img = event.target;
        setImageDimensions({ 
            width: img.naturalWidth, 
            height: img.naturalHeight 
        });
        setIsImageLoaded(true);
        
        // Setup canvas to match image display size and position
        setTimeout(() => {
            if (canvasRef.current && imageContainerRef.current) {
                drawBoundingBoxes();
            }
        }, 100); // Small delay to ensure image is fully rendered
    };

    const drawBoundingBoxes = () => {
        if (!canvasRef.current || !imageRef.current || !isImageLoaded || !imageContainerRef.current) return;
        
        const canvas = canvasRef.current;
        const img = imageRef.current;
        const ctx = canvas.getContext('2d');
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        if (!showBoundingBoxes) return;
        
        // Get container and image rectangles
        const containerRect = imageContainerRef.current.getBoundingClientRect();
        const imgRect = img.getBoundingClientRect();
        
        // Calculate the actual size the image should take up when zoomed
        const containerWidth = containerRect.width;
        const containerHeight = containerRect.height;
        
        // Calculate the displayed size based on object-fit: contain
        const imageAspectRatio = imageDimensions.width / imageDimensions.height;
        const containerAspectRatio = containerWidth / containerHeight;
        
        let displayWidth, displayHeight;
        if (imageAspectRatio > containerAspectRatio) {
            // Image is wider - fit to width
            displayWidth = containerWidth;
            displayHeight = containerWidth / imageAspectRatio;
        } else {
            // Image is taller - fit to height
            displayHeight = containerHeight;
            displayWidth = containerHeight * imageAspectRatio;
        }
        
        // Apply zoom
        const zoomedWidth = displayWidth * zoom;
        const zoomedHeight = displayHeight * zoom;
        
        // Calculate position (image is centered in container with pan offset)
        const imageLeft = (containerWidth - zoomedWidth) / 2 + panX;
        const imageTop = (containerHeight - zoomedHeight) / 2 + panY;
        
        // Set canvas size and position
        canvas.width = zoomedWidth;
        canvas.height = zoomedHeight;
        canvas.style.top = `${imageTop}px`;
        canvas.style.left = `${imageLeft}px`;
        canvas.style.width = `${zoomedWidth}px`;
        canvas.style.height = `${zoomedHeight}px`;
        
        // Calculate scale factors for coordinates
        const scaleX = zoomedWidth / imageDimensions.width;
        const scaleY = zoomedHeight / imageDimensions.height;
        
        // Filter predictions based on confidence and selected classes
        const filteredPredictions = predictions.filter(pred => 
            pred.confidence >= confidenceThreshold && 
            selectedClasses.has(pred.class)
        );
        
        // Draw bounding boxes
        filteredPredictions.forEach(pred => {
            const color = classColors[pred.class] || '#FF0000';
            
            // Convert center-based coordinates to corner-based
            const x = (pred.x - pred.width / 2) * scaleX;
            const y = (pred.y - pred.height / 2) * scaleY;
            const width = pred.width * scaleX;
            const height = pred.height * scaleY;
            
            // Draw bounding box only (no labels)
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, width, height);
        });
    };

    const handlePreviousPlot = () => {
        if (currentPlotIndex > 0 && inferenceData) {
            const newIndex = currentPlotIndex - 1;
            setCurrentPlotIndex(newIndex);
            const { date, platform, sensor, agrowstitch_version, orthomosaic } = inferenceData;
            const versionDir = orthomosaic || agrowstitch_version;
            loadPlotImage(plotImages[newIndex], date, platform, sensor, versionDir);
        }
    };

    const handleNextPlot = () => {
        if (currentPlotIndex < plotImages.length - 1 && inferenceData) {
            const newIndex = currentPlotIndex + 1;
            setCurrentPlotIndex(newIndex);
            const { date, platform, sensor, agrowstitch_version, orthomosaic } = inferenceData;
            const versionDir = orthomosaic || agrowstitch_version;
            loadPlotImage(plotImages[newIndex], date, platform, sensor, versionDir);
        }
    };

    const handleMouseDown = (e) => {
        if (zoom > 1) {
            setIsDragging(true);
            setDragStart({ x: e.clientX - panX, y: e.clientY - panY });
        }
    };

    const handleMouseMove = (e) => {
        if (isDragging && zoom > 1) {
            const newPanX = e.clientX - dragStart.x;
            const newPanY = e.clientY - dragStart.y;
            setPanX(newPanX);
            setPanY(newPanY);
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleZoomChange = (e, newValue) => {
        setZoom(newValue);
        // Reset pan when zoom changes to 1
        if (newValue === 1) {
            setPanX(0);
            setPanY(0);
        }
    };

    const handlePlotSelection = (event) => {
        const selectedFileName = event.target.value;
        const newIndex = plotImages.findIndex(img => img === selectedFileName);
        if (newIndex !== -1 && inferenceData) {
            setCurrentPlotIndex(newIndex);
            const { date, platform, sensor, agrowstitch_version, orthomosaic } = inferenceData;
            const versionDir = orthomosaic || agrowstitch_version;
            loadPlotImage(plotImages[newIndex], date, platform, sensor, versionDir);
        }
    };

    const getPlotNumber = (fileName) => {
        const match = fileName.match(/plot_(\d+)/);
        return match ? match[1] : 'Unknown';
    };

    const getPlotDisplayName = (fileName) => {
        const plotNumber = getPlotNumber(fileName);
        const plotIndex = parseInt(plotNumber);
        const metadata = plotData[plotIndex] || {};
        
        if (metadata.plot) {
            return `Plot ${metadata.plot}${metadata.accession ? ` - ${metadata.accession}` : ''}`;
        }
        return `Plot ${plotNumber}`;
    };

    const toggleClassVisibility = (className) => {
        const newSelectedClasses = new Set(selectedClasses);
        if (newSelectedClasses.has(className)) {
            newSelectedClasses.delete(className);
        } else {
            newSelectedClasses.add(className);
        }
        setSelectedClasses(newSelectedClasses);
    };

    if (!open || !inferenceData) return null;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
            <DialogTitle>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Box>
                        <Typography variant="h6">
                            Inference Results - {inferenceData.date} {inferenceData.platform} {inferenceData.sensor}
                        </Typography>
                        {(inferenceData.model_id || inferenceData.model_version) && (
                            <Typography variant="subtitle2" color="textSecondary">
                                Model: {inferenceData.model_id || 'Unknown'} 
                                {inferenceData.model_version && ` v${inferenceData.model_version}`}
                                {(inferenceData.orthomosaic || inferenceData.agrowstitch_version) && 
                                    ` • Orthomosaic: ${inferenceData.orthomosaic || inferenceData.agrowstitch_version}`}
                            </Typography>
                        )}
                    </Box>
                    <IconButton onClick={onClose}>
                        <Close />
                    </IconButton>
                </Box>
            </DialogTitle>
            
            <DialogContent>
                {loading && (
                    <Box display="flex" justifyContent="center" alignItems="center" height="400px">
                        <CircularProgress />
                    </Box>
                )}
                
                {!loading && plotImages.length > 0 && (
                    <Grid container spacing={2}>
                        {/* Image Display */}
                        <Grid item xs={12} md={8}>
                            <Paper elevation={2} sx={{ p: 2 }}>
                                {/* Navigation Controls */}
                                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                                    <Box display="flex" alignItems="center" gap={2}>
                                        {/* Previous/Next Navigation */}
                                        <Box display="flex" alignItems="center" gap={1}>
                                            <IconButton 
                                                onClick={handlePreviousPlot} 
                                                disabled={currentPlotIndex === 0}
                                            >
                                                <ArrowBack />
                                            </IconButton>
                                            
                                            <Typography variant="body1">
                                                {getPlotDisplayName(plotImages[currentPlotIndex])} 
                                                ({currentPlotIndex + 1} of {plotImages.length})
                                            </Typography>
                                            
                                            <IconButton 
                                                onClick={handleNextPlot} 
                                                disabled={currentPlotIndex === plotImages.length - 1}
                                            >
                                                <ArrowForward />
                                            </IconButton>
                                        </Box>

                                        {/* Plot Selection Dropdown */}
                                        <FormControl size="small" sx={{ minWidth: 200 }}>
                                            <InputLabel>Select Plot</InputLabel>
                                            <Select
                                                value={plotImages[currentPlotIndex] || ''}
                                                onChange={handlePlotSelection}
                                                label="Select Plot"
                                            >
                                                {plotImages.map((fileName, index) => (
                                                    <MenuItem key={fileName} value={fileName}>
                                                        {getPlotDisplayName(fileName)}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                    </Box>
                                    
                                    <FormControlLabel
                                        control={
                                            <Switch
                                                checked={showBoundingBoxes}
                                                onChange={(e) => setShowBoundingBoxes(e.target.checked)}
                                            />
                                        }
                                        label="Show Bounding Boxes"
                                    />
                                </Box>
                                
                                {/* Image Container */}
                                <Box 
                                    ref={imageContainerRef}
                                    position="relative" 
                                    width="100%" 
                                    height="500px"
                                    overflow="hidden"
                                    border="1px solid #ddd"
                                    display="flex"
                                    justifyContent="center"
                                    alignItems="center"
                                >
                                    {currentImageUrl && (
                                        <>
                                            <img
                                                ref={imageRef}
                                                src={currentImageUrl}
                                                alt={`Plot ${getPlotNumber(plotImages[currentPlotIndex])}`}
                                                style={{
                                                    maxWidth: '100%',
                                                    maxHeight: '100%',
                                                    objectFit: 'contain',
                                                    transform: `scale(${zoom}) translate(${panX / zoom}px, ${panY / zoom}px)`,
                                                    cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'
                                                }}
                                                onLoad={handleImageLoad}
                                                onMouseDown={handleMouseDown}
                                                onMouseMove={handleMouseMove}
                                                onMouseUp={handleMouseUp}
                                                onMouseLeave={handleMouseUp}
                                            />
                                            <canvas
                                                ref={canvasRef}
                                                style={{
                                                    position: 'absolute',
                                                    pointerEvents: 'none',
                                                    zIndex: 10
                                                }}
                                            />
                                        </>
                                    )}
                                </Box>
                                
                                {/* Zoom Controls */}
                                <Box mt={2}>
                                    <Typography gutterBottom>Zoom: {Math.round(zoom * 100)}%</Typography>
                                    {zoom > 1 && (
                                        <Typography variant="body2" color="textSecondary" gutterBottom>
                                            Click and drag to pan around the image
                                        </Typography>
                                    )}
                                    <Slider
                                        value={zoom}
                                        onChange={handleZoomChange}
                                        min={0.1}
                                        max={3}
                                        step={0.1}
                                        marks={[
                                            { value: 0.5, label: '50%' },
                                            { value: 1, label: '100%' },
                                            { value: 2, label: '200%' }
                                        ]}
                                    />
                                </Box>
                            </Paper>
                        </Grid>
                        
                        {/* Controls and Detection Info */}
                        <Grid item xs={12} md={4}>
                            <Paper elevation={2} sx={{ p: 2, height: 'fit-content' }}>
                                <Typography variant="h6" gutterBottom>
                                    Detection Controls
                                </Typography>
                                
                                {/* Confidence Threshold */}
                                <Box mb={3}>
                                    <Typography gutterBottom>
                                        Confidence Threshold: {Math.round(confidenceThreshold * 100)}%
                                    </Typography>
                                    <Slider
                                        value={confidenceThreshold}
                                        onChange={(e, newValue) => setConfidenceThreshold(newValue)}
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        marks={[
                                            { value: 0, label: '0%' },
                                            { value: 0.5, label: '50%' },
                                            { value: 1, label: '100%' }
                                        ]}
                                    />
                                </Box>
                                
                                {/* Class Legend */}
                                <Typography variant="h6" gutterBottom>
                                    Class Legend
                                </Typography>
                                <Box mb={3}>
                                    {Object.entries(classCounts).map(([className, count]) => (
                                        <Box key={className} display="flex" alignItems="center" mb={1}>
                                            <Box
                                                width={20}
                                                height={20}
                                                bgcolor={classColors[className]}
                                                mr={1}
                                                style={{ cursor: 'pointer' }}
                                                onClick={() => toggleClassVisibility(className)}
                                                border={selectedClasses.has(className) ? '2px solid black' : '2px solid transparent'}
                                            />
                                            <Chip
                                                label={`${className} (${count})`}
                                                size="small"
                                                onClick={() => toggleClassVisibility(className)}
                                                color={selectedClasses.has(className) ? 'primary' : 'default'}
                                                variant={selectedClasses.has(className) ? 'filled' : 'outlined'}
                                            />
                                        </Box>
                                    ))}
                                </Box>
                                
                                {/* Detection Summary */}
                                <Typography variant="h6" gutterBottom>
                                    Detection Summary
                                </Typography>
                                <Typography variant="body2" gutterBottom>
                                    Total Detections: {predictions.length}
                                </Typography>
                                <Typography variant="body2" gutterBottom>
                                    Visible Detections: {predictions.filter(pred => 
                                        pred.confidence >= confidenceThreshold && 
                                        selectedClasses.has(pred.class)
                                    ).length}
                                </Typography>
                                <Typography variant="body2">
                                    Classes: {Object.keys(classCounts).length}
                                </Typography>
                            </Paper>
                        </Grid>
                    </Grid>
                )}
                
                {!loading && plotImages.length === 0 && (
                    <Box textAlign="center" py={4}>
                        <Typography variant="body1" color="textSecondary">
                            No plot images found for the selected inference results.
                        </Typography>
                    </Box>
                )}
            </DialogContent>
            
            <DialogActions>
                <Button onClick={onClose} variant="contained">
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default InferenceResultsPreview;
