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
    Slider
} from '@mui/material';
import { ArrowBack, ArrowForward, Close, ZoomIn, ZoomOut, FitScreen, Download } from '@mui/icons-material';
import { useDataState } from "../../DataContext";
import { listFiles, getFileUrl, getTifToPng, getPngFile, downloadSinglePlot } from '../../api/files';
import { getPlotBordersData } from '../../api/queries';

const RoverPlotPreview = ({ open, onClose, datePlatformSensor }) => {
    const [plotImages, setPlotImages] = useState([]);
    const [currentPlotIndex, setCurrentPlotIndex] = useState(0);
    const [currentImageUrl, setCurrentImageUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
    const [isImageLoaded, setIsImageLoaded] = useState(false);
    const imageRef = useRef(null);
    const imageContainerRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [dragDistance, setDragDistance] = useState(0);
    const [plotData, setPlotData] = useState({});
    const { selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP } = useDataState();

    useEffect(() => {
        if (open && datePlatformSensor) {
            fetchPlotImages();
            fetchPlotData();
        }
        
        // Reset zoom when dialog opens/closes
        if (open) {
            setZoom(1);
            setIsImageLoaded(false);
        }
        
        // Cleanup blob URL when component closes
        return () => {
            if (currentImageUrl && currentImageUrl.startsWith('blob:')) {
                URL.revokeObjectURL(currentImageUrl);
            }
        };
    }, [open, datePlatformSensor, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP]);

    const fetchPlotImages = async () => {
        if (!datePlatformSensor) return;

        const { date, platform, sensor, agrowstitchDir } = datePlatformSensor;
        setLoading(true);

        try {
            const dirPath = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/${agrowstitchDir}`;
            const plotFiles = await listFiles(dirPath);

            // Filter for plot image files (include both PNG and TIFF)
            const plotImages = plotFiles
                .filter(file => file.startsWith('full_res_mosaic_temp_plot_') && (file.endsWith('.png') || file.endsWith('.tif')))
                .sort((a, b) => {
                    // Sort by plot number
                    const plotNumA = parseInt(a.match(/plot_(\d+)/)?.[1] || 0);
                    const plotNumB = parseInt(b.match(/plot_(\d+)/)?.[1] || 0);
                    return plotNumA - plotNumB;
                });

            setPlotImages(plotImages);
            setCurrentPlotIndex(0);
            setLoading(false);

            // Load the first image
            if (plotImages.length > 0) {
                loadPlotImage(plotImages[0], date, platform, sensor, agrowstitchDir);
            }
            
        } catch (error) {
            console.error('Error fetching plot images:', error);
            setLoading(false);
        }
    };

    const fetchPlotData = async () => {
        try {
            const data = await getPlotBordersData({
                year: selectedYearGCP,
                experiment: selectedExperimentGCP,
                location: selectedLocationGCP,
                population: selectedPopulationGCP,
            });
            setPlotData(data.plot_data || {});
        } catch (error) {
            console.error('Error fetching plot data:', error);
            setPlotData({});
        }
    };

    const handleImageLoad = (event) => {
        const img = event.target;
        setImageDimensions({
            width: img.naturalWidth,
            height: img.naturalHeight
        });
        setIsImageLoaded(true);
    };

    const loadPlotImage = async (fileName, date, platform, sensor, agrowstitchDir) => {
        try {
            if (currentImageUrl && currentImageUrl.startsWith('blob:')) {
                URL.revokeObjectURL(currentImageUrl);
            }

            const imagePath = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/${agrowstitchDir}/${fileName}`;

            // If TIFF, request server to convert it to PNG
            if (fileName.endsWith('.tif')) {
                try {
                    const result = await getTifToPng({ filePath: imagePath });
                    if (result && result.url) {
                        setCurrentImageUrl(result.url);
                        setZoom(1);
                        setIsImageLoaded(false);
                        return;
                    }
                } catch (e) {
                    console.warn('TIF to PNG conversion failed, trying direct serve');
                }
            }

            // Try direct file serving via API layer
            const directUrl = getFileUrl(imagePath);
            try {
                const directResponse = await fetch(directUrl);
                if (directResponse.ok) {
                    setCurrentImageUrl(directUrl);
                    setZoom(1);
                    setIsImageLoaded(false);
                    return;
                }
            } catch (directError) {
                console.log('Direct file serving failed, trying PNG endpoint');
            }

            // Fallback: get_png_file endpoint
            try {
                const pngResult = await getPngFile({ filePath: imagePath });
                if (pngResult && pngResult.url) {
                    setCurrentImageUrl(pngResult.url);
                    setZoom(1);
                    setIsImageLoaded(false);
                } else {
                    setCurrentImageUrl('');
                }
            } catch (pngError) {
                console.error('Error loading plot image:', pngError);
                setCurrentImageUrl('');
            }
        } catch (error) {
            console.error('Error loading plot image:', error);
            setCurrentImageUrl('');
        }
    };

    const handlePreviousPlot = () => {
        if (currentPlotIndex > 0 && datePlatformSensor) {
            const newIndex = currentPlotIndex - 1;
            setCurrentPlotIndex(newIndex);
            const { date, platform, sensor, agrowstitchDir } = datePlatformSensor;
            loadPlotImage(plotImages[newIndex], date, platform, sensor, agrowstitchDir);
        }
    };

    const handleNextPlot = () => {
        if (currentPlotIndex < plotImages.length - 1 && datePlatformSensor) {
            const newIndex = currentPlotIndex + 1;
            setCurrentPlotIndex(newIndex);
            const { date, platform, sensor, agrowstitchDir } = datePlatformSensor;
            loadPlotImage(plotImages[newIndex], date, platform, sensor, agrowstitchDir);
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
        
        // Debug logging
        console.log('getPlotDisplayName debug:', {
            fileName,
            plotNumber,
            plotIndex,
            metadata,
            plotDataKeys: Object.keys(plotData)
        });
        
        // If we have plot label data, use it as the main plot identifier
        if (metadata.plot) {
            return `Plot ${metadata.plot}${metadata.accession ? ` - ${metadata.accession}` : ''}`;
        }
        // Fallback to just the plot number from filename
        return `Plot ${plotNumber}`;
    };

    const getCurrentPlotMetadata = () => {
        if (plotImages.length === 0) return { plotNumber: 'Unknown', plotLabel: null, accession: null };
        
        const currentFileName = plotImages[currentPlotIndex];
        const plotNumber = getPlotNumber(currentFileName);
        const plotIndex = parseInt(plotNumber);
        
        const metadata = plotData[plotIndex] || {};
        return {
            plotNumber,
            plotLabel: metadata.plot,
            accession: metadata.accession
        };
    };

    const handleDownloadPlot = async () => {
        if (!datePlatformSensor || plotImages.length === 0) return;
        
        const { date, platform, sensor, agrowstitchDir } = datePlatformSensor;
        const currentFileName = plotImages[currentPlotIndex];
        
        console.log('Download request:', {
            year: selectedYearGCP,
            experiment: selectedExperimentGCP,
            location: selectedLocationGCP,
            population: selectedPopulationGCP,
            date,
            platform,
            sensor,
            agrowstitchDir,
            plotFilename: currentFileName,
        });
        
        try {
            const filePath = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/${agrowstitchDir}/${currentFileName}`;
            const result = await downloadSinglePlot({ filePath, plotFilename: currentFileName });

            const metadata = getCurrentPlotMetadata();
            const fileExtension = currentFileName.endsWith('.png') ? '.png' : '.tif';
            let customFilename;
            if (metadata.plotLabel && metadata.accession) {
                customFilename = `plot_${metadata.plotLabel}_accession_${metadata.accession}${fileExtension}`;
            } else if (metadata.plotLabel) {
                customFilename = `plot_${metadata.plotLabel}${fileExtension}`;
            } else {
                customFilename = `plot_${metadata.plotNumber}${fileExtension}`;
            }

            const a = document.createElement('a');
            a.href = result.url;
            a.download = customFilename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (error) {
            console.error('Error downloading plot:', error);
            alert('Error downloading plot image');
        }
    };

    const handlePlotChange = (index) => {
        if (datePlatformSensor) {
            setCurrentPlotIndex(index);
            const { date, platform, sensor, agrowstitchDir } = datePlatformSensor;
            loadPlotImage(plotImages[index], date, platform, sensor, agrowstitchDir);
        }
    };

    const handleZoomChange = (event, newValue) => {
        setZoom(newValue);
    };

    const handleZoomIn = () => {
        setZoom(prev => Math.min(prev + 0.25, 5));
    };

    const handleZoomOut = () => {
        setZoom(prev => Math.max(prev - 0.25, 0.25));
    };

    const handleFitToScreen = () => {
        setZoom(1);
    };

    // Drag/swipe functionality
    const handleDragStart = (e) => {
        if (zoom > 1) return; // Don't allow plot switching when zoomed in
        
        setIsDragging(true);
        const clientX = e.type === 'mousedown' ? e.clientX : e.touches[0].clientX;
        setDragStart({ x: clientX, y: 0 });
        setDragDistance(0);
    };

    const handleDragMove = (e) => {
        if (!isDragging || zoom > 1) return;
        
        e.preventDefault();
        const clientX = e.type === 'mousemove' ? e.clientX : e.touches[0].clientX;
        const distance = clientX - dragStart.x;
        setDragDistance(distance);
    };

    const handleDragEnd = () => {
        if (!isDragging || zoom > 1) return;
        
        setIsDragging(false);
        const threshold = 100; // minimum distance to trigger navigation
        
        if (Math.abs(dragDistance) > threshold) {
            if (dragDistance > 0 && currentPlotIndex > 0) {
                // Dragged right, go to previous image
                handlePreviousPlot();
            } else if (dragDistance < 0 && currentPlotIndex < plotImages.length - 1) {
                // Dragged left, go to next image
                handleNextPlot();
            }
        }
        
        setDragDistance(0);
    };

    // Keyboard navigation
    useEffect(() => {
        const handleKeyPress = (e) => {
            if (!open) return;
            
            switch(e.key) {
                case 'ArrowLeft':
                    handlePreviousPlot();
                    break;
                case 'ArrowRight':
                    handleNextPlot();
                    break;
                case 'Escape':
                    onClose();
                    break;
                default:
                    break;
            }
        };

        document.addEventListener('keydown', handleKeyPress);
        return () => document.removeEventListener('keydown', handleKeyPress);
    }, [open, currentPlotIndex, plotImages.length]);

    // Calculate dialog dimensions based on image
    const getDialogDimensions = () => {
        const maxWidth = window.innerWidth * 0.98;
        const maxHeight = window.innerHeight * 0.98;
        const controlsHeight = 200; // Space for controls and padding
        const availableImageHeight = maxHeight - controlsHeight;

        if (!isImageLoaded || !imageDimensions.width || !imageDimensions.height) {
            return { width: maxWidth, height: maxHeight };
        }

        // Calculate aspect ratio
        const aspectRatio = imageDimensions.width / imageDimensions.height;
        
        // Calculate dimensions that fit the image properly within viewport
        let dialogWidth = Math.min(imageDimensions.width + 100, maxWidth);
        let dialogHeight = Math.min(imageDimensions.height + controlsHeight, maxHeight);

        // If image would be too tall, constrain by height and adjust width
        if (imageDimensions.height > availableImageHeight) {
            dialogHeight = maxHeight;
            dialogWidth = Math.min(availableImageHeight * aspectRatio + 100, maxWidth);
        }
        
        // If image would be too wide, constrain by width and adjust height
        if (imageDimensions.width > maxWidth - 100) {
            dialogWidth = maxWidth;
            dialogHeight = Math.min((maxWidth - 100) / aspectRatio + controlsHeight, maxHeight);
        }

        return { 
            width: dialogWidth, 
            height: dialogHeight 
        };
    };

    const dialogDims = getDialogDimensions();

    return (
        <Dialog 
            open={open} 
            onClose={onClose} 
            maxWidth="xl"
            fullWidth
            PaperProps={{
                style: {
                    width: '95vw',
                    height: '95vh',
                    maxWidth: '95vw',
                    maxHeight: '95vh'
                }
            }}
        >
            <DialogTitle>
                <Box display="flex" justifyContent="flex-end" alignItems="center">
                    <IconButton onClick={onClose}>
                        <Close />
                    </IconButton>
                </Box>
            </DialogTitle>
            
            <DialogContent>
                {loading ? (
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                        <CircularProgress />
                    </Box>
                ) : plotImages.length > 0 ? (
                    <Box>
                        {/* Plot Navigation */}
                        <Box display="flex" justifyContent="center" alignItems="center" mb={2} gap={2}>
                            <IconButton 
                                onClick={handlePreviousPlot} 
                                disabled={currentPlotIndex === 0}
                                size="large"
                            >
                                <ArrowBack />
                            </IconButton>
                            
                            <Typography variant="h6">
                                {currentPlotIndex + 1}/{plotImages.length}
                            </Typography>
                            
                            <IconButton 
                                onClick={handleNextPlot} 
                                disabled={currentPlotIndex === plotImages.length - 1}
                                size="large"
                            >
                                <ArrowForward />
                            </IconButton>
                        </Box>

                        {/* Plot Selection Dropdown and Download */}
                        <Box display="flex" justifyContent="center" alignItems="center" mb={2} gap={2}>
                            <FormControl variant="outlined" size="small" sx={{ minWidth: 250 }}>
                                <InputLabel>Select Plot</InputLabel>
                                <Select
                                    value={currentPlotIndex}
                                    onChange={(e) => handlePlotChange(e.target.value)}
                                    label="Select Plot"
                                >
                                    {plotImages.map((fileName, index) => (
                                        <MenuItem key={index} value={index}>
                                            {getPlotDisplayName(fileName)}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            
                            <IconButton 
                                onClick={handleDownloadPlot}
                                color="primary"
                                title="Download plot image"
                                size="small"
                                sx={{ 
                                    border: '1px solid #1976d2',
                                    borderRadius: '4px',
                                    padding: '6px'
                                }}
                            >
                                <Download fontSize="small" />
                            </IconButton>
                        </Box>

                        {/* Zoom Controls */}
                        <Box display="flex" justifyContent="center" alignItems="center" mb={2} gap={2}>
                            <IconButton onClick={handleZoomOut} disabled={zoom <= 0.25}>
                                <ZoomOut />
                            </IconButton>
                            
                            <Box sx={{ width: 200 }}>
                                <Slider
                                    value={zoom}
                                    onChange={handleZoomChange}
                                    min={0.25}
                                    max={5}
                                    step={0.25}
                                    marks={[
                                        // { value: 0.25, label: '25%' },
                                        { value: 1, label: '100%' },
                                        { value: 2, label: '200%' },
                                        { value: 5, label: '500%' }
                                    ]}
                                    valueLabelDisplay="auto"
                                    valueLabelFormat={(value) => `${Math.round(value * 100)}%`}
                                />
                            </Box>
                            
                            <IconButton onClick={handleZoomIn} disabled={zoom >= 5}>
                                <ZoomIn />
                            </IconButton>
                            
                            <IconButton onClick={handleFitToScreen} title="Fit to screen">
                                <FitScreen />
                            </IconButton>
                        </Box>

                        {/* Image Display */}
                        <Box 
                            ref={imageContainerRef}
                            display="flex" 
                            justifyContent="center" 
                            alignItems="center"
                            sx={{ 
                                overflow: zoom > 1 ? 'auto' : 'hidden',
                                height: 'calc(95vh - 300px)',
                                border: '1px solid #ccc',
                                borderRadius: '4px',
                                cursor: zoom <= 1 ? 'grab' : 'default',
                                userSelect: 'none',
                                position: 'relative'
                            }}
                            onMouseDown={handleDragStart}
                            onMouseMove={handleDragMove}
                            onMouseUp={handleDragEnd}
                            onMouseLeave={handleDragEnd}
                            onTouchStart={handleDragStart}
                            onTouchMove={handleDragMove}
                            onTouchEnd={handleDragEnd}
                        >
                            {currentImageUrl ? (
                                <img
                                    ref={imageRef}
                                    src={currentImageUrl}
                                    alt={`Plot ${getPlotNumber(plotImages[currentPlotIndex])}`}
                                    style={{
                                        transform: `scale(${zoom}) translateX(${isDragging && zoom <= 1 ? dragDistance * 0.5 : 0}px)`,
                                        transformOrigin: 'center',
                                        maxWidth: zoom <= 1 ? '100%' : 'none',
                                        maxHeight: zoom <= 1 ? '100%' : 'none',
                                        width: zoom <= 1 ? 'auto' : `${imageDimensions.width}px`,
                                        height: zoom <= 1 ? 'auto' : `${imageDimensions.height}px`,
                                        objectFit: zoom <= 1 ? 'contain' : 'none',
                                        transition: isDragging ? 'none' : 'transform 0.2s ease-in-out',
                                        pointerEvents: 'none' // Prevent image dragging
                                    }}
                                    onLoad={handleImageLoad}
                                    onError={(e) => {
                                        console.error('Error displaying image:', currentImageUrl);
                                        console.error('Image error event:', e);
                                    }}
                                />
                            ) : (
                                <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                                    <Typography>Loading image...</Typography>
                                </Box>
                            )}
                            
                            {/* Drag indicator */}
                            {isDragging && zoom <= 1 && (
                                <Box
                                    sx={{
                                        position: 'absolute',
                                        top: '50%',
                                        left: dragDistance > 0 ? '10px' : 'auto',
                                        right: dragDistance < 0 ? '10px' : 'auto',
                                        transform: 'translateY(-50%)',
                                        color: 'rgba(255, 255, 255, 0.8)',
                                        fontSize: '2rem',
                                        pointerEvents: 'none',
                                        zIndex: 1000
                                    }}
                                >
                                    {dragDistance > 0 ? '←' : '→'}
                                </Box>
                            )}
                        </Box>
                    </Box>
                ) : (
                    <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
                        <Typography>No plot images found</Typography>
                    </Box>
                )}
            </DialogContent>
            
            <DialogActions>
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};

export default RoverPlotPreview;