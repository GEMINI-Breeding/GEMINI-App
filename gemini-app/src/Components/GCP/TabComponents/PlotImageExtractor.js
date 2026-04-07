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
import { ImageOutlined, CropFree } from "@mui/icons-material";
import { useDataState } from "../../../DataContext";
import { listDirs, listFiles } from "../../../api/files";
import { splitOrthomosaics } from "../../../api/processing";
import { getJobStatus } from "../../../api/jobs";

function PlotImageExtractor() {
    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedYearGCP,
        selectedExperimentGCP,
        featureCollectionPlot
    } = useDataState();

    const [loading, setLoading] = useState(false);
    const [availableDates, setAvailableDates] = useState([]);
    const [selectedDate, setSelectedDate] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [plotCount, setPlotCount] = useState(0);

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

    const fetchAvailableDates = async () => {
        try {
            const basePath = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`;
            const dates = await listDirs(basePath);

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
            const platforms = await listDirs(`${basePath}/${date}`);

            for (const platform of platforms) {
                try {
                    const sensors = await listDirs(`${basePath}/${date}/${platform}`);

                    for (const sensor of sensors) {
                        try {
                            // Check for odm_orthophoto.tif file directly at sensor level
                            const files = await listFiles(`${basePath}/${date}/${platform}/${sensor}`);
                            if (files.some(f => f.toLowerCase().includes('odm_orthophoto'))) {
                                return true;
                            }

                            // Also check for ODM/OpenDroneMap subdirectories
                            const processingDirs = await listDirs(`${basePath}/${date}/${platform}/${sensor}`);
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

    const handleSplitOrthomosaics = async () => {
        if (!selectedDate || !featureCollectionPlot.features.length) {
            setError('Please ensure you have selected a date and have defined plot boundaries');
            return;
        }

        try {
            setLoading(true);
            setError('');
            setMessage('');

            // Submit the job to the queue
            const job = await splitOrthomosaics({
                year: selectedYearGCP,
                experiment: selectedExperimentGCP,
                location: selectedLocationGCP,
                population: selectedPopulationGCP,
                date: selectedDate,
                boundaries: featureCollectionPlot
            });

            const jobId = job.id || job.job_id;
            if (!jobId) {
                setError('Failed to submit split job — no job ID returned');
                setLoading(false);
                return;
            }

            // Poll for job completion
            const pollInterval = 3000; // 3 seconds
            const maxWait = 600000; // 10 minutes
            const startTime = Date.now();

            const poll = async () => {
                if (Date.now() - startTime > maxWait) {
                    setError('Job timed out after 10 minutes');
                    setLoading(false);
                    return;
                }

                try {
                    const status = await getJobStatus(jobId);
                    if (status.status === 'COMPLETED') {
                        const result = status.result || {};
                        setMessage(`Successfully extracted ${result.plots_processed || 0} plot images from orthomosaics`);
                        setLoading(false);
                    } else if (status.status === 'FAILED') {
                        setError(`Job failed: ${status.error_message || 'Unknown error'}`);
                        setLoading(false);
                    } else if (status.status === 'CANCELLED') {
                        setError('Job was cancelled');
                        setLoading(false);
                    } else {
                        // Still running or pending — poll again
                        setTimeout(poll, pollInterval);
                    }
                } catch (pollError) {
                    console.error('Error polling job status:', pollError);
                    setTimeout(poll, pollInterval);
                }
            };

            // Start polling after a brief delay
            setTimeout(poll, pollInterval);
        } catch (error) {
            setError('Error splitting orthomosaics: ' + error.message);
            setLoading(false);
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
                    </Stack>
                </Box>

                {/* Action Button */}
                <Stack direction="row" spacing={2} mb={2}>
                    <Button
                        variant="contained"
                        onClick={handleSplitOrthomosaics}
                        disabled={loading || !hasValidSetup}
                        startIcon={loading ? <CircularProgress size={20} /> : <CropFree />}
                        size="large"
                    >
                        {loading ? 'Splitting Orthomosaics...' : 'Split Orthomosaics Based on Plot Boundaries'}
                    </Button>
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
