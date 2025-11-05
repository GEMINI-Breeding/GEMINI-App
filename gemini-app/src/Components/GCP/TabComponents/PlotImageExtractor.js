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

function PlotImageExtractor() {
    const { 
        selectedLocationGCP, 
        selectedPopulationGCP, 
        selectedYearGCP, 
        selectedExperimentGCP,
        featureCollectionPlot,
        flaskUrl
    } = useDataState();

    const [loading, setLoading] = useState(false);
    const [availableDates, setAvailableDates] = useState([]);
    const [selectedDate, setSelectedDate] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [plotCount, setPlotCount] = useState(0);
    const [availableOrthoTypes, setAvailableOrthoTypes] = useState([]);
    const [selectedOrthoType, setSelectedOrthoType] = useState(null);
    const [loadingOrthoTypes, setLoadingOrthoTypes] = useState(false);

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

    // When a date is selected, fetch available orthomosaic types (drone pyramids, AgRowStitch combined or individual)
    useEffect(() => {
        if (!selectedDate) {
            setAvailableOrthoTypes([]);
            setSelectedOrthoType(null);
            setLoadingOrthoTypes(false);
            return;
        }

        const fetchOrthoTypes = async () => {
            setLoadingOrthoTypes(true);
            setSelectedOrthoType(null); // Clear selection while loading
            
            try {
                const basePath = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${selectedDate}`;
                const platformsResp = await fetch(`${flaskUrl}list_dirs/${basePath}`);
                const platforms = await platformsResp.json();

                const orthoTypes = [];

                for (const platform of platforms) {
                    try {
                        const sensorsResp = await fetch(`${flaskUrl}list_dirs/${basePath}/${platform}`);
                        const sensors = await sensorsResp.json();

                        for (const sensor of sensors) {
                            // Check files for drone Pyramid.tif
                            try {
                                const filesResp = await fetch(`${flaskUrl}list_files/${basePath}/${platform}/${sensor}`);
                                const files = await filesResp.json();
                                if (files.some(f => f.includes('Pyramid.tif'))) {
                                    orthoTypes.push({
                                        type: 'drone',
                                        label: `Drone Orthomosaic (${platform}/${sensor})`,
                                        path: `${basePath}/${platform}/${sensor}/${selectedDate}-RGB-Pyramid.tif`,
                                        platform,
                                        sensor
                                    });
                                }
                            } catch (e) {
                                // ignore
                            }

                            // Check for AgRowStitch directories
                            try {
                                const subDirsResp = await fetch(`${flaskUrl}list_dirs/${basePath}/${platform}/${sensor}`);
                                const subDirs = await subDirsResp.json();
                                const agDirs = subDirs.filter(d => d.startsWith('AgRowStitch_v'));
                                for (const ag of agDirs) {
                                    try {
                                        const agFilesResp = await fetch(`${flaskUrl}list_files/${basePath}/${platform}/${sensor}/${ag}`);
                                        const agFiles = await agFilesResp.json();

                                        const hasCombined = agFiles.includes('combined_mosaic_utm.tif');
                                        if (hasCombined) {
                                            orthoTypes.push({
                                                type: 'agrowstitch_combined',
                                                label: `${ag} - Combined Mosaic (${platform}/${sensor})`,
                                                path: `${basePath}/${platform}/${sensor}/${ag}/combined_mosaic_utm.tif`,
                                                platform,
                                                sensor,
                                                version: ag,
                                                combinedMosaic: true
                                            });
                                        } else {
                                            const utmFiles = agFiles.filter(f => f.includes('_utm.tif'));
                                            if (utmFiles.length > 0) {
                                                orthoTypes.push({
                                                    type: 'agrowstitch',
                                                    label: `${ag} - Individual Plots (${platform}/${sensor})`,
                                                    path: `${basePath}/${platform}/${sensor}/${ag}`,
                                                    platform,
                                                    sensor,
                                                    version: ag,
                                                    plots: utmFiles.map(file => ({
                                                        filename: file,
                                                        fullPath: `${basePath}/${platform}/${sensor}/${ag}/${file}`
                                                    }))
                                                });
                                            }
                                        }
                                    } catch (e) {
                                        // ignore per-sensor agrowstitch check errors
                                    }
                                }
                            } catch (e) {
                                // ignore
                            }
                        }
                    } catch (e) {
                        // ignore
                    }
                }

                setAvailableOrthoTypes(orthoTypes);
                setSelectedOrthoType(orthoTypes.length > 0 ? orthoTypes[0] : null);
            } catch (error) {
                console.error('Error fetching ortho types:', error);
                setAvailableOrthoTypes([]);
                setSelectedOrthoType(null);
            } finally {
                setLoadingOrthoTypes(false);
            }
        };

        fetchOrthoTypes();
    }, [selectedDate, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP, flaskUrl]);

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
            // Check for any orthomosaics (Pyramid.tif or AgRowStitch) in the date directory
            const platformResponse = await fetch(`${flaskUrl}list_dirs/${basePath}/${date}`);
            const platforms = await platformResponse.json();
            
            for (const platform of platforms) {
                try {
                    const sensorResponse = await fetch(`${flaskUrl}list_dirs/${basePath}/${date}/${platform}`);
                    const sensors = await sensorResponse.json();
                    
                    for (const sensor of sensors) {
                        // Check for Pyramid.tif files directly in sensor folder
                        try {
                            const filesResponse = await fetch(`${flaskUrl}list_files/${basePath}/${date}/${platform}/${sensor}`);
                            const files = await filesResponse.json();
                            
                            if (files.some(file => file.includes('Pyramid.tif'))) {
                                return true;
                            }
                        } catch (error) {
                            // Continue checking
                        }
                        
                        // Check for AgRowStitch directories with orthomosaics
                        try {
                            const subDirsResponse = await fetch(`${flaskUrl}list_dirs/${basePath}/${date}/${platform}/${sensor}`);
                            const subDirs = await subDirsResponse.json();
                            const agrowstitchDirs = subDirs.filter(dir => dir.startsWith('AgRowStitch_v'));
                            
                            for (const agrowstitchDir of agrowstitchDirs) {
                                try {
                                    const agFilesResponse = await fetch(`${flaskUrl}list_files/${basePath}/${date}/${platform}/${sensor}/${agrowstitchDir}`);
                                    const agFiles = await agFilesResponse.json();
                                    
                                    // Check for combined mosaic or individual plot files
                                    if (agFiles.includes('combined_mosaic_utm.tif') || 
                                        agFiles.some(file => file.includes('_utm.tif'))) {
                                        return true;
                                    }
                                } catch (error) {
                                    // Continue checking
                                }
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

        if (!selectedOrthoType) {
            setError('Please select an orthomosaic to crop from for the selected date');
            return;
        }

        const buildOrthoChoiceReason = (ortho) => {
            if (!ortho) return '';
            try {
                if (ortho.type === 'drone') {
                    // return `Selected Drone orthomosaic from ${ortho.platform}/${ortho.sensor} (path: ${ortho.path}) because a Pyramid.tif was found.`;
                    return `Selected Drone orthomosaic from ${ortho.platform}/${ortho.sensor}.`;
                }
                if (ortho.type === 'agrowstitch_combined') {
                    return `Selected AgRowStitch combined mosaic ${ortho.version} from ${ortho.platform}/${ortho.sensor} (path: ${ortho.path}) because combined_mosaic_utm.tif was found.`;
                }
                if (ortho.type === 'agrowstitch') {
                    const n = ortho.plots ? ortho.plots.length : 0;
                    return `Selected AgRowStitch individual plots ${ortho.version} from ${ortho.platform}/${ortho.sensor} with ${n} plots available.`;
                }
                return `Selected ${ortho.label}`;
            } catch (e) {
                return `Selected ${ortho.label || ortho.type || 'orthomosaic'}`;
            }
        };

        try {
            setLoading(true);
            setError('');
            setMessage('');

            const orthoReason = buildOrthoChoiceReason(selectedOrthoType);
            // Print reason to console for debugging/trace
            console.log('Ortho selection reason:', orthoReason);
            // Also show a temporary message in the UI so the user sees why this ortho was chosen
            setMessage(orthoReason);
            console.log('Ortho path used:', selectedOrthoType.path);

            const response = await fetch(`${flaskUrl}split_orthomosaics`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date: selectedDate,
                    boundaries: featureCollectionPlot,
                    ortho_type: selectedOrthoType.type,
                    ortho_path: selectedOrthoType.path,
                    agrowstitch_plots: selectedOrthoType.plots || []
                })
            });

            if (response.ok) {
                const data = await response.json();
                setMessage(`Successfully extracted ${data.plots_processed} plot images from orthomosaics`);
            } else {
                const errorData = await response.json();
                setError(errorData.error || 'Failed to split orthomosaics');
            }
        } catch (error) {
            setError('Error splitting orthomosaics: ' + error.message);
        } finally {
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

                {/* Orthomosaic Type Selection (appears after date selection) */}
                {(loadingOrthoTypes || availableOrthoTypes.length > 0) && selectedDate && (
                    <FormControl fullWidth sx={{ mb: 2 }}>
                        <InputLabel id="ortho-type-label">Orthomosaic to Crop</InputLabel>
                        <Select
                            labelId="ortho-type-label"
                            value={selectedOrthoType || ''}
                            label="Orthomosaic to Crop"
                            onChange={(e) => setSelectedOrthoType(e.target.value)}
                            disabled={loadingOrthoTypes}
                            renderValue={(val) => {
                                if (loadingOrthoTypes) return 'Loading...';
                                return val ? val.label : '';
                            }}
                        >
                            {loadingOrthoTypes ? (
                                <MenuItem disabled>Loading orthomosaics...</MenuItem>
                            ) : (
                                availableOrthoTypes.map((ortho, idx) => (
                                    <MenuItem key={idx} value={ortho}>
                                        {ortho.label}
                                    </MenuItem>
                                ))
                            )}
                        </Select>
                    </FormControl>
                )}

                {!loadingOrthoTypes && availableOrthoTypes.length === 0 && selectedDate && (
                    <Alert severity="info" sx={{ mb: 2 }}>
                        No orthomosaics found for the selected date to crop from.
                    </Alert>
                )}

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
