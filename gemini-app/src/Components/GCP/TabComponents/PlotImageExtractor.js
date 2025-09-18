import React, { useState, useEffect } from "react";
import { 
    Box, 
    Button, 
    Typography, 
    Alert, 
    CircularProgress, 
    Card, 
    CardContent,
    Chip,
    Stack,
    FormControl,
    InputLabel,
    Select,
    MenuItem
} from "@mui/material";
import { ImageOutlined, CropFree, Download } from "@mui/icons-material";
import { useDataState } from "../../../DataContext";

function PlotImageExtractor() {
    const { 
        selectedLocationGCP, 
        selectedPopulationGCP, 
        selectedYearGCP, 
        selectedExperimentGCP,
        featureCollectionPlot,
        flaskUrl
    } = useDataState();

    const [splittingLoading, setSplittingLoading] = useState(false);
    const [downloadLoading, setDownloadLoading] = useState(false);
    const [availableDates, setAvailableDates] = useState([]);
    const [selectedDate, setSelectedDate] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [plotCount, setPlotCount] = useState(0);
    const [existingImages, setExistingImages] = useState({ exists: false, count: 0 });

    // Fetch available dates with ODM orthomosaics
    useEffect(() => {
        if (selectedLocationGCP && selectedPopulationGCP && selectedYearGCP && selectedExperimentGCP) {
            fetchAvailableDates();
        }
    }, [selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP]);

    // Update plot count when boundaries change
    useEffect(() => {
        setPlotCount(featureCollectionPlot.features?.length || 0);
    }, [featureCollectionPlot]);

    // Check for existing plot images when date changes
    useEffect(() => {
        if (selectedDate && selectedLocationGCP && selectedPopulationGCP && selectedYearGCP && selectedExperimentGCP) {
            checkExistingPlotImages();
        }
    }, [selectedDate, selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP]);

    const fetchAvailableDates = async () => {
        try {
            const basePath = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`;
            const response = await fetch(`${flaskUrl}list_dirs/${basePath}`);
            const dates = await response.json();
            
            // Filter for valid date formats and check if they have ODM orthomosaics
            const validDates = [];
            for (const date of dates) {
                if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
                    // Check if this date has ODM orthomosaics
                    const hasOdm = await checkForOdmOrthomosaic(basePath, date);
                    if (hasOdm) {
                        validDates.push(date);
                    }
                }
            }
            
            // Sort dates in descending order (most recent first)
            validDates.sort((a, b) => b.localeCompare(a));
            setAvailableDates(validDates);
            if (validDates.length > 0) {
                setSelectedDate(validDates[0]);
            }
        } catch (error) {
            console.error('Error fetching dates:', error);
            setAvailableDates([]);
        }
    };

    const checkForOdmOrthomosaic = async (basePath, date) => {
        try {
            // Check for ODM orthomosaics in the date directory
            const platformResponse = await fetch(`${flaskUrl}list_dirs/${basePath}/${date}`);
            const platforms = await platformResponse.json();
            
            for (const platform of platforms) {
                try {
                    const sensorResponse = await fetch(`${flaskUrl}list_dirs/${basePath}/${date}/${platform}`);
                    const sensors = await sensorResponse.json();
                    
                    for (const sensor of sensors) {
                        try {
                            const processingResponse = await fetch(`${flaskUrl}list_dirs/${basePath}/${date}/${platform}/${sensor}`);
                            const processingDirs = await processingResponse.json();
                            
                            // Look for ODM or OpenDroneMap directories
                            const hasOdm = processingDirs.some(dir => 
                                dir.toLowerCase().includes('odm') || 
                                dir.toLowerCase().includes('opendronemap')
                            );
                            
                            if (hasOdm) {
                                return true;
                            }
                        } catch (error) {
                            // Continue checking other sensors
                        }
                    }
                } catch (error) {
                    // Continue checking other platforms
                }
            }
            
            return false;
        } catch (error) {
            return false;
        }
    };

    const checkExistingPlotImages = async () => {
        try {
            const response = await fetch(`${flaskUrl}check_plot_images`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date: selectedDate
                })
            });

            if (response.ok) {
                const data = await response.json();
                setExistingImages(data);
            } else {
                setExistingImages({ exists: false, count: 0 });
            }
        } catch (error) {
            console.error('Error checking existing plot images:', error);
            setExistingImages({ exists: false, count: 0 });
        }
    };

    const handleDownloadPlotImages = async () => {
        try {
            setDownloadLoading(true);
            const response = await fetch(`${flaskUrl}download_plot_images`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date: selectedDate
                })
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `plot_images_${selectedYearGCP}_${selectedExperimentGCP}_${selectedLocationGCP}_${selectedPopulationGCP}_${selectedDate}.zip`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                setMessage(`Downloaded ${existingImages.count} plot images as ZIP file`);
            } else {
                const errorData = await response.json();
                setError(errorData.error || 'Failed to download plot images');
            }
        } catch (error) {
            setError('Error downloading plot images: ' + error.message);
        } finally {
            setDownloadLoading(false);
        }
    };

    const handleSplitOrthomosaics = async () => {
        if (!selectedDate || !featureCollectionPlot.features.length) {
            setError('Please ensure you have selected a date and have defined plot boundaries');
            return;
        }

        try {
            setSplittingLoading(true);
            setError('');
            setMessage('');

            const response = await fetch(`${flaskUrl}split_orthomosaics`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date: selectedDate,
                    boundaries: featureCollectionPlot
                })
            });

            if (response.ok) {
                const data = await response.json();
                setMessage(`Successfully extracted ${data.plots_processed} plot images from orthomosaics`);
                // Refresh the existing images check
                checkExistingPlotImages();
            } else {
                const errorData = await response.json();
                setError(errorData.error || 'Failed to split orthomosaics');
            }
        } catch (error) {
            setError('Error splitting orthomosaics: ' + error.message);
        } finally {
            setSplittingLoading(false);
        }
    };

    const hasValidSetup = selectedDate && plotCount > 0;

    return (
        <Card sx={{ maxWidth: 800, margin: 'auto', mt: 2 }}>
            <CardContent>
                <Box display="flex" alignItems="center" mb={2}>
                    <ImageOutlined sx={{ mr: 1 }} />
                    <Typography variant="h6">Get Plot Images</Typography>
                </Box>

                <Typography variant="body2" color="text.secondary" mb={3}>
                    Extract individual plot images from orthomosaics based on defined plot boundaries.
                    Each plot will be saved as a separate PNG file with the naming format: plot_[plot]_accession_[accession].png
                </Typography>

                {/* Date Selection */}
                <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>Select Date</InputLabel>
                    <Select
                        value={selectedDate}
                        label="Select Date"
                        onChange={(e) => setSelectedDate(e.target.value)}
                        disabled={availableDates.length === 0}
                    >
                        {availableDates.map(date => (
                            <MenuItem key={date} value={date}>
                                {date}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>

                {availableDates.length === 0 && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        No dates with ODM orthomosaics found for the selected location and population.
                    </Alert>
                )}

                {existingImages.exists && (
                    <Alert severity="info" sx={{ mb: 2 }}>
                        Found {existingImages.count} existing plot images for {selectedDate}. 
                        You can download them or re-extract from orthomosaics to update them.
                    </Alert>
                )}

                {/* Status Display */}
                <Box mb={2}>
                    <Stack direction="row" spacing={1} alignItems="center">
                        <Chip 
                            label={`${plotCount} plot boundaries defined`}
                            color={plotCount > 0 ? "primary" : "default"}
                        />
                        <Chip 
                            label={selectedDate ? `Date: ${selectedDate}` : "No date selected"}
                            color={selectedDate ? "success" : "default"}
                        />
                        {existingImages.exists && (
                            <Chip 
                                label={`${existingImages.count} existing plot images`}
                                color="info"
                            />
                        )}
                    </Stack>
                </Box>

                {/* Action Button */}
                <Stack direction="row" spacing={2} mb={2}>
                    <Button
                        variant="contained"
                        onClick={handleSplitOrthomosaics}
                        disabled={splittingLoading || downloadLoading || !hasValidSetup}
                        startIcon={splittingLoading ? <CircularProgress size={20} /> : <CropFree />}
                        size="large"
                    >
                        {splittingLoading ? 'Splitting Orthomosaics...' : 'Split Orthomosaics Based on Plot Boundaries'}
                    </Button>
                    
                    {existingImages.exists && (
                        <Button
                            variant="outlined"
                            onClick={handleDownloadPlotImages}
                            disabled={splittingLoading || downloadLoading}
                            startIcon={downloadLoading ? <CircularProgress size={20} /> : <Download />}
                            size="large"
                        >
                            {downloadLoading ? 'Downloading...' : `Download Plot Images (${existingImages.count})`}
                        </Button>
                    )}
                </Stack>

                {/* Messages */}
                {message && (
                    <Alert severity="success" sx={{ mb: 2 }}>
                        {message}
                    </Alert>
                )}

                {error && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                        {error}
                    </Alert>
                )}

                {/* Requirements */}
                <Box mt={2}>
                    <Typography variant="body2" color="text.secondary">
                        <strong>Requirements:</strong>
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        • Plot boundaries defined on the map with plot and accession information
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        • ODM orthomosaics available for the selected date
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        • Sufficient disk space for extracted plot images
                    </Typography>
                </Box>
            </CardContent>
        </Card>
    );
}

export default PlotImageExtractor;
