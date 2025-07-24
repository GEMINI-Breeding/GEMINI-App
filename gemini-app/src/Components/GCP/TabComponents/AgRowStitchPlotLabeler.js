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
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Select,
    MenuItem,
    FormControl,
    InputLabel
} from "@mui/material";
import { CheckCircle, ErrorOutline, Assignment } from "@mui/icons-material";
import { useDataState } from "../../../DataContext";

function AgRowStitchPlotLabeler() {
    const { 
        selectedLocationGCP, 
        selectedPopulationGCP, 
        selectedYearGCP, 
        selectedExperimentGCP,
        featureCollectionPlot,
        flaskUrl
    } = useDataState();

    const [loading, setLoading] = useState(false);
    const [associations, setAssociations] = useState({});
    const [totalPlots, setTotalPlots] = useState(0);
    const [availableAgrowstitchDirs, setAvailableAgrowstitchDirs] = useState([]);
    const [selectedAgrowstitchDir, setSelectedAgrowstitchDir] = useState('');
    const [availableDates, setAvailableDates] = useState([]);
    const [selectedDate, setSelectedDate] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [showDialog, setShowDialog] = useState(false);

    // Fetch available dates and AgRowStitch directories
    useEffect(() => {
        if (selectedLocationGCP && selectedPopulationGCP && selectedYearGCP && selectedExperimentGCP) {
            fetchAvailableDates();
        }
    }, [selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP]);

    const fetchAvailableDates = async () => {
        try {
            const basePath = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`;
            const response = await fetch(`${flaskUrl}list_dirs/${basePath}`);
            const dates = await response.json();
            setAvailableDates(dates.filter(date => date.match(/^\d{4}-\d{2}-\d{2}$/)));
        } catch (error) {
            console.error('Error fetching dates:', error);
        }
    };

    const fetchAgrowstitchDirs = async (date) => {
        try {
            const platformResponse = await fetch(`${flaskUrl}list_dirs/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}`);
            const platforms = await platformResponse.json();
            
            const agrowstitchDirs = [];
            
            for (const platform of platforms) {
                try {
                    const sensorResponse = await fetch(`${flaskUrl}list_dirs/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}`);
                    const sensors = await sensorResponse.json();
                    
                    for (const sensor of sensors) {
                        try {
                            const dirResponse = await fetch(`${flaskUrl}list_dirs/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}`);
                            const dirs = await dirResponse.json();
                            
                            const agrowstitchVersions = dirs.filter(dir => dir.startsWith('AgRowStitch_v'));
                            for (const version of agrowstitchVersions) {
                                agrowstitchDirs.push({
                                    path: version,
                                    label: `${platform}/${sensor}/${version}`,
                                    platform,
                                    sensor,
                                    version
                                });
                            }
                        } catch (error) {
                            console.log(`No subdirectories found for ${platform}/${sensor}`);
                        }
                    }
                } catch (error) {
                    console.log(`No sensors found for platform ${platform}`);
                }
            }
            
            setAvailableAgrowstitchDirs(agrowstitchDirs);
            if (agrowstitchDirs.length > 0) {
                setSelectedAgrowstitchDir(agrowstitchDirs[0].path);
                // Auto-fetch associations for the first available option
                fetchCurrentAssociations(date, agrowstitchDirs[0]);
            }
        } catch (error) {
            console.error('Error fetching AgRowStitch directories:', error);
            setAvailableAgrowstitchDirs([]);
        }
    };

    const handleDateChange = (date) => {
        setSelectedDate(date);
        setSelectedAgrowstitchDir('');
        setAssociations({});
        setTotalPlots(0);
        fetchAgrowstitchDirs(date);
    };

    const fetchCurrentAssociations = async (date, agrowstitchInfo) => {
        if (!date || !agrowstitchInfo) return;
        
        try {
            setLoading(true);
            const response = await fetch(`${flaskUrl}get_agrowstitch_plot_associations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date: date,
                    platform: agrowstitchInfo.platform,
                    sensor: agrowstitchInfo.sensor
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                setAssociations(data.associations);
                setTotalPlots(data.total_plots);
            } else {
                const errorData = await response.json();
                setError(errorData.error || 'Failed to fetch associations');
            }
        } catch (error) {
            setError('Error fetching associations: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleAgrowstitchDirChange = (agrowstitchPath) => {
        setSelectedAgrowstitchDir(agrowstitchPath);
        const agrowstitchInfo = availableAgrowstitchDirs.find(dir => dir.path === agrowstitchPath);
        if (agrowstitchInfo && selectedDate) {
            fetchCurrentAssociations(selectedDate, agrowstitchInfo);
        }
    };

    const handleAssociatePlots = async () => {
        if (!selectedDate || !selectedAgrowstitchDir || !featureCollectionPlot.features.length) {
            setError('Please ensure you have selected a date, AgRowStitch version, and have defined plot boundaries');
            return;
        }

        const agrowstitchInfo = availableAgrowstitchDirs.find(dir => dir.path === selectedAgrowstitchDir);
        if (!agrowstitchInfo) {
            setError('Invalid AgRowStitch directory selected');
            return;
        }

        try {
            setLoading(true);
            setError('');
            setMessage('');

            const response = await fetch(`${flaskUrl}associate_plots_with_boundaries`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date: selectedDate,
                    platform: agrowstitchInfo.platform,
                    sensor: agrowstitchInfo.sensor,
                    agrowstitchDir: selectedAgrowstitchDir,
                    boundaries: featureCollectionPlot
                })
            });

            if (response.ok) {
                const data = await response.json();
                setMessage(`Successfully associated ${data.associations} plots with boundaries`);
                // Refresh associations
                fetchCurrentAssociations(selectedDate, agrowstitchInfo);
            } else {
                const errorData = await response.json();
                setError(errorData.error || 'Failed to associate plots');
            }
        } catch (error) {
            setError('Error associating plots: ' + error.message);
        } finally {
            setLoading(false);
        }
    };

    const openAssociationDialog = () => {
        setShowDialog(true);
    };

    const associatedCount = Object.keys(associations).length;
    const hasAssociations = associatedCount > 0;

    return (
        <Card sx={{ maxWidth: 800, margin: 'auto', mt: 2 }}>
            <CardContent>
                <Box display="flex" alignItems="center" mb={2}>
                    <Assignment sx={{ mr: 1 }} />
                    <Typography variant="h6">AgRowStitch Plot Labeling</Typography>
                </Box>

                <Typography variant="body2" color="text.secondary" mb={3}>
                    Associate stitched plots with plot boundaries to add plot labels to your dataset.
                    This will update the msgs_synced.csv file with plot and accession information.
                </Typography>

                {/* Date Selection */}
                <FormControl fullWidth sx={{ mb: 2 }}>
                    <InputLabel>Select Date</InputLabel>
                    <Select
                        value={selectedDate}
                        label="Select Date"
                        onChange={(e) => handleDateChange(e.target.value)}
                    >
                        {availableDates.map(date => (
                            <MenuItem key={date} value={date}>
                                {date}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>

                {/* AgRowStitch Directory Selection */}
                {selectedDate && (
                    <FormControl fullWidth sx={{ mb: 2 }}>
                        <InputLabel>Select AgRowStitch Version</InputLabel>
                        <Select
                            value={selectedAgrowstitchDir}
                            label="Select AgRowStitch Version"
                            onChange={(e) => handleAgrowstitchDirChange(e.target.value)}
                        >
                            {availableAgrowstitchDirs.map(dir => (
                                <MenuItem key={dir.path} value={dir.path}>
                                    {dir.label}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                )}

                {/* Status Display */}
                {selectedDate && selectedAgrowstitchDir && (
                    <Box mb={2}>
                        <Stack direction="row" spacing={1} alignItems="center">
                            <Chip 
                                icon={hasAssociations ? <CheckCircle /> : <ErrorOutline />}
                                label={`${associatedCount}/${totalPlots} plots labeled`}
                                color={hasAssociations ? "success" : "default"}
                            />
                            <Chip 
                                label={`${featureCollectionPlot.features.length} boundaries defined`}
                                color={featureCollectionPlot.features.length > 0 ? "primary" : "default"}
                            />
                        </Stack>
                    </Box>
                )}

                {/* Action Buttons */}
                <Stack direction="row" spacing={2} mb={2}>
                    <Button
                        variant="contained"
                        onClick={handleAssociatePlots}
                        disabled={loading || !selectedDate || !selectedAgrowstitchDir || featureCollectionPlot.features.length === 0}
                        startIcon={loading ? <CircularProgress size={20} /> : <Assignment />}
                    >
                        {loading ? 'Associating...' : 'Associate Plots with Boundaries'}
                    </Button>
                    
                    {hasAssociations && (
                        <Button
                            variant="outlined"
                            onClick={openAssociationDialog}
                        >
                            View Associations ({associatedCount})
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
                        • CSV data imported with Plot and Accession columns
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        • Plot boundaries defined on the map
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        • AgRowStitch processing completed with plot marking
                    </Typography>
                </Box>
            </CardContent>

            {/* Associations Dialog */}
            <Dialog open={showDialog} onClose={() => setShowDialog(false)} maxWidth="md" fullWidth>
                <DialogTitle>Plot Associations</DialogTitle>
                <DialogContent>
                    {Object.entries(associations).map(([plotIdx, info]) => (
                        <Box key={plotIdx} mb={1} p={1} bgcolor="grey.50" borderRadius={1}>
                            <Typography variant="body2">
                                <strong>Plot Index {plotIdx}:</strong> {info.plot_label}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                Center: {info.center_lat?.toFixed(6)}, {info.center_lon?.toFixed(6)}
                            </Typography>
                        </Box>
                    ))}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setShowDialog(false)}>Close</Button>
                </DialogActions>
            </Dialog>
        </Card>
    );
}

export default AgRowStitchPlotLabeler;
