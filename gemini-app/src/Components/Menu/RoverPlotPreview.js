import React, { useState, useEffect } from 'react';
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
    MenuItem
} from '@mui/material';
import { ArrowBack, ArrowForward, Close } from '@mui/icons-material';
import { fetchData, useDataState } from "../../DataContext";

const RoverPlotPreview = ({ open, onClose, datePlatformSensor }) => {
    const [plotImages, setPlotImages] = useState([]);
    const [currentPlotIndex, setCurrentPlotIndex] = useState(0);
    const [currentImageUrl, setCurrentImageUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const { flaskUrl, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP } = useDataState();

    useEffect(() => {
        if (open && datePlatformSensor) {
            fetchPlotImages();
        }
        
        // Cleanup blob URL when component closes
        return () => {
            if (currentImageUrl && currentImageUrl.startsWith('blob:')) {
                URL.revokeObjectURL(currentImageUrl);
            }
        };
    }, [open, datePlatformSensor, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP, flaskUrl]);

    const fetchPlotImages = async () => {
        if (!datePlatformSensor) return;
        
        const { date, platform, sensor, agrowstitchDir } = datePlatformSensor;
        setLoading(true);
        
        try {
            const plotFiles = await fetchData(
                `${flaskUrl}list_files/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/${agrowstitchDir}`
            );

            // Filter for plot image files
            const plotImages = plotFiles
                .filter(file => file.startsWith('full_res_mosaic_temp_plot_') && file.endsWith('.png'))
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

    const loadPlotImage = async (fileName, date, platform, sensor, agrowstitchDir) => {
        try {
            // Clean up previous blob URL if it exists
            if (currentImageUrl && currentImageUrl.startsWith('blob:')) {
                URL.revokeObjectURL(currentImageUrl);
            }

            const imagePath = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/${agrowstitchDir}/${fileName}`;
            console.log('Loading image path:', imagePath);
            
            // Try the existing /files/ endpoint first
            const directUrl = `${flaskUrl}files/${imagePath}`;
            console.log('Trying direct URL:', directUrl);
            
            try {
                const directResponse = await fetch(directUrl);
                if (directResponse.ok) {
                    console.log('Direct file serving works, using direct URL');
                    setCurrentImageUrl(directUrl);
                    return;
                }
            } catch (directError) {
                console.log('Direct file serving failed, trying blob method');
            }
            
            // Fallback to the new get_png_file endpoint
            const response = await fetch(`${flaskUrl}get_png_file`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ filePath: imagePath }),
            });

            console.log('Blob endpoint response status:', response.status, response.statusText);

            if (response.ok) {
                const blob = await response.blob();
                console.log('Blob size:', blob.size, 'Blob type:', blob.type);
                
                if (blob.size > 0) {
                    const imageUrl = URL.createObjectURL(blob);
                    console.log('Created blob URL:', imageUrl);
                    setCurrentImageUrl(imageUrl);
                } else {
                    console.error('Received empty blob');
                    setCurrentImageUrl('');
                }
            } else {
                console.error('Error loading plot image:', response.status, response.statusText);
                const errorText = await response.text();
                console.error('Error response:', errorText);
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

    const handlePlotChange = (index) => {
        if (datePlatformSensor) {
            setCurrentPlotIndex(index);
            const { date, platform, sensor, agrowstitchDir } = datePlatformSensor;
            loadPlotImage(plotImages[index], date, platform, sensor, agrowstitchDir);
        }
    };

    return (
        <Dialog 
            open={open} 
            onClose={onClose} 
            maxWidth="lg" 
            fullWidth
            PaperProps={{
                style: {
                    minHeight: '80vh',
                    maxHeight: '90vh'
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

                        {/* Plot Selection Dropdown */}
                        <Box display="flex" justifyContent="center" mb={2}>
                            <FormControl variant="outlined" size="small" sx={{ minWidth: 200 }}>
                                <InputLabel>Select Plot</InputLabel>
                                <Select
                                    value={currentPlotIndex}
                                    onChange={(e) => handlePlotChange(e.target.value)}
                                    label="Select Plot"
                                >
                                    {plotImages.map((fileName, index) => (
                                        <MenuItem key={index} value={index}>
                                            Plot {getPlotNumber(fileName)}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Box>

                        {/* Image Display */}
                        <Box display="flex" justifyContent="center" alignItems="center">
                            {currentImageUrl ? (
                                <img
                                    src={currentImageUrl}
                                    alt={`Plot ${getPlotNumber(plotImages[currentPlotIndex])}`}
                                    style={{
                                        maxWidth: '100%',
                                        maxHeight: '600px',
                                        objectFit: 'contain',
                                        border: '1px solid #ccc',
                                        borderRadius: '4px'
                                    }}
                                    onLoad={() => console.log('Image loaded successfully:', currentImageUrl)}
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