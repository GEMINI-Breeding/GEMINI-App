import React, { useState, useEffect } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { fetchData, useDataState } from "../../DataContext";
import { Box, Typography, Alert, Chip } from '@mui/material';
import { IconButton } from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DeleteIcon from '@mui/icons-material/Delete';
import InferenceResultsPreview from '../Menu/InferenceResultsPreview';
import Download from "@mui/icons-material/Download";

const InferenceTable = ({ refreshTrigger }) => {
    const [inferenceData, setInferenceData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { flaskUrl, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP } = useDataState();
    const [isInferencePreviewOpen, setIsInferencePreviewOpen] = useState(false);
    const [selectedInferenceData, setSelectedInferenceData] = useState(null);

    useEffect(() => {
        const fetchInferenceData = async () => {
            setLoading(true);
            try {
                const response = await fetch(`${flaskUrl}get_inference_results`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        year: selectedYearGCP,
                        experiment: selectedExperimentGCP,
                        location: selectedLocationGCP,
                        population: selectedPopulationGCP
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    setInferenceData(data.results || []);
                } else {
                    const errorData = await response.json();
                    setError(errorData.error || 'Failed to fetch inference results');
                }
                setLoading(false);
            } catch (error) {
                console.error('Error fetching inference data:', error);
                setError('Failed to fetch inference results');
                setLoading(false);
            }
        };

        if (selectedLocationGCP && selectedPopulationGCP) {
            fetchInferenceData();
        }
    }, [selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP, flaskUrl, refreshTrigger]);

    const handleViewInference = (row) => {
        if (row.plot_images_available) {
            setSelectedInferenceData({
                date: row.date,
                platform: row.platform,
                sensor: row.sensor,
                agrowstitch_version: row.orthomosaic || row.agrowstitch_version, // Support both old and new field names
                orthomosaic: row.orthomosaic,
                model_id: row.model_id,
                model_version: row.model_version
            });
            setIsInferencePreviewOpen(true);
        } else {
            alert('Plot images are not available for this inference result.');
        }
    };

    const handleDownloadCSV = async (row) => {
        try {
            const response = await fetch(row.csv_path);
            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${row.date}_${row.platform}_${row.sensor}_${row.orthomosaic || row.agrowstitch_version}_predictions.csv`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            }
        } catch (error) {
            console.error('Error downloading CSV:', error);
            alert('Failed to download CSV file');
        }
    };

    const handleDeleteInference = async (row) => {
        const confirmMessage = `Are you sure you want to delete the inference results for ${row.date} ${row.platform} ${row.sensor}?\n\nThis will delete:\n- CSV predictions file\n- Detection data from traits GeoJSON (if exists)\n\nThis action cannot be undone.`;
        
        if (window.confirm(confirmMessage)) {
            try {
                setLoading(true);
                
                const response = await fetch(`${flaskUrl}delete_inference_results`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        year: selectedYearGCP,
                        experiment: selectedExperimentGCP,
                        location: selectedLocationGCP,
                        population: selectedPopulationGCP,
                        date: row.date,
                        platform: row.platform,
                        sensor: row.sensor,
                        orthomosaic: row.orthomosaic || row.agrowstitch_version,
                        delete_traits: true // Also clean up detection data from traits
                    })
                });

                if (response.ok) {
                    const result = await response.json();
                    alert(`Successfully deleted inference results.\n\nDeleted files:\n${result.deleted_files.join('\n')}`);
                    
                    // Refresh the table by removing the deleted row
                    setInferenceData(prevData => 
                        prevData.filter(item => item.id !== row.id)
                    );
                    
                    // Close any open preview dialogs for the deleted inference
                    if (selectedInferenceData && selectedInferenceData.date === row.date && 
                        selectedInferenceData.platform === row.platform && 
                        selectedInferenceData.sensor === row.sensor) {
                        setIsInferencePreviewOpen(false);
                        setSelectedInferenceData(null);
                    }
                } else {
                    const errorData = await response.json();
                    alert(`Failed to delete inference results: ${errorData.error}`);
                }
            } catch (error) {
                console.error('Error deleting inference results:', error);
                alert('Failed to delete inference results. Please try again.');
            } finally {
                setLoading(false);
            }
        }
    };

    const formatClassCounts = (classCounts) => {
        return Object.entries(classCounts).map(([className, count]) => (
            <Chip
                key={className}
                label={`${className}: ${count}`}
                size="small"
                style={{ margin: '2px' }}
                color="primary"
                variant="outlined"
            />
        ));
    };

    const columns = [
        { field: 'date', headerName: 'Date', width: 120 },
        { field: 'platform', headerName: 'Platform', width: 100 },
        { field: 'sensor', headerName: 'Sensor', width: 100 },
        { field: 'orthomosaic', headerName: 'Orthomosaic', width: 150 },
        { field: 'model_id', headerName: 'Model ID', width: 200 },
        { 
            field: 'total_predictions', 
            headerName: 'Total Detections', 
            width: 130,
            type: 'number'
        },
        { 
            field: 'plot_count', 
            headerName: 'Plots', 
            width: 80,
            type: 'number'
        },
        {
            field: 'classes_detected',
            headerName: 'Classes Detected',
            width: 300,
            renderCell: (params) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {formatClassCounts(params.value || {})}
                </Box>
            )
        },
        {
            field: 'actions',
            headerName: 'Actions',
            width: 150,
            sortable: false,
            renderCell: (params) => (
                <Box>
                    <IconButton
                        size="small"
                        onClick={() => handleViewInference(params.row)}
                        disabled={!params.row.plot_images_available}
                        title={params.row.plot_images_available ? "View inference results with bounding boxes" : "Plot images not available"}
                    >
                        <VisibilityIcon />
                    </IconButton>
                    <IconButton
                        size="small"
                        onClick={() => handleDownloadCSV(params.row)}
                        title="Download CSV results"
                    >
                        <Download />
                    </IconButton>
                    <IconButton
                        size="small"
                        onClick={() => handleDeleteInference(params.row)}
                        title="Delete inference results"
                        color="error"
                    >
                        <DeleteIcon />
                    </IconButton>
                </Box>
            ),
        },
    ];

    if (error) {
        return (
            <Box p={2}>
                <Alert severity="error">{error}</Alert>
            </Box>
        );
    }

    return (
        <Box>
            <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold', textAlign: 'center' }}>
                Inference Results
            </Typography>
            
            {inferenceData.length === 0 && !loading ? (
                <Alert severity="info" sx={{ mt: 2 }}>
                    No inference results found for the selected dataset. 
                    Run inference on plot images from the Processing tab to see results here.
                </Alert>
            ) : (
                <DataGrid
                    rows={inferenceData}
                    columns={columns}
                    loading={loading}
                    autoHeight
                    disableSelectionOnClick
                    getRowHeight={() => 'auto'}
                    sx={{
                        '& .MuiDataGrid-cell': {
                            display: 'flex',
                            alignItems: 'center',
                        },
                        '& .MuiDataGrid-row': {
                            minHeight: '60px !important',
                        }
                    }}
                />
            )}

            <InferenceResultsPreview
                open={isInferencePreviewOpen}
                onClose={() => setIsInferencePreviewOpen(false)}
                inferenceData={selectedInferenceData}
            />
        </Box>
    );
};

export default InferenceTable;
