import React, { useState, useEffect, useRef } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { useDataState } from "../../DataContext";
import { Box, Typography, Alert, Chip } from '@mui/material';
import { IconButton } from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DeleteIcon from '@mui/icons-material/Delete';
import InferenceResultsPreview from '../Menu/InferenceResultsPreview';
import Download from "@mui/icons-material/Download";
import { getInferenceProgress, getInferenceResults, downloadInferenceCsv, deleteInferenceResults } from '../../api/queries';

const InferenceTable = ({ refreshTrigger }) => {
    const [inferenceData, setInferenceData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP } = useDataState();
    const [isInferencePreviewOpen, setIsInferencePreviewOpen] = useState(false);
    const [selectedInferenceData, setSelectedInferenceData] = useState(null);
    const [inferenceStatus, setInferenceStatus] = useState(null);
    const pollingRef = useRef(null);

    useEffect(() => {
        let timer;
        const pollStatus = async () => {
            try {
                const status = await getInferenceProgress();
                setInferenceStatus(status);
                if (status && status.running) {
                    timer = setTimeout(pollStatus, 2000);
                } else {
                    setTimeout(() => fetchInferenceData(), 1000);
                }
            } catch (e) {
                // Polling failure is non-critical
            }
        };
        pollStatus();
        return () => clearTimeout(timer);
    }, [refreshTrigger]);

    const fetchInferenceData = async () => {
        setLoading(true);
        try {
            const data = await getInferenceResults({
                year: selectedYearGCP,
                experiment: selectedExperimentGCP,
                location: selectedLocationGCP,
                population: selectedPopulationGCP
            });

            // Group results by date/platform/sensor/orthomosaic/model_task
            const results = (data.results || data || []).map((row, index) => {
                // Infer model task from CSV filename
                let model_task = 'detection';
                if (row.csv_path && row.csv_path.includes('_segmentation')) model_task = 'segmentation';
                else if (row.csv_path && row.csv_path.includes('_detection')) model_task = 'detection';

                const baseId = `${row.date || ''}_${row.platform || ''}_${row.sensor || ''}_${row.orthomosaic || row.agrowstitch_version || ''}_${model_task}`;
                const uniqueId = row.csv_path ?
                    baseId + '_' + row.csv_path.split('/').pop().replace(/[^a-zA-Z0-9]/g, '_') :
                    baseId + '_' + index;

                return { ...row, model_task, id: uniqueId };
            });
            setInferenceData(results);
            setLoading(false);
        } catch (error) {
            console.error('Error fetching inference data:', error);
            setError('Failed to fetch inference results');
            setLoading(false);
        }
    };

    useEffect(() => {
        if (selectedLocationGCP && selectedPopulationGCP) {
            fetchInferenceData();
        }
    }, [selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP, refreshTrigger]);

    const handleViewInference = (row) => {
        if (row.plot_images_available) {
            setSelectedInferenceData({
                date: row.date,
                platform: row.platform,
                sensor: row.sensor,
                agrowstitch_version: row.orthomosaic || row.agrowstitch_version,
                orthomosaic: row.orthomosaic,
                model_id: row.model_id,
                model_version: row.model_version,
                model_task: row.model_task
            });
            setIsInferencePreviewOpen(true);
        } else {
            alert('Plot images are not available for this inference result.');
        }
    };

    const handleDownloadCSV = async (row) => {
        try {
            const result = await downloadInferenceCsv({ path: row.csv_path });

            const a = document.createElement('a');
            a.href = result.url;
            a.download = result.fileName || `${row.date}_${row.platform}_${row.sensor}_${row.model_task || 'detection'}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
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

                const result = await deleteInferenceResults({
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date: row.date,
                    platform: row.platform,
                    sensor: row.sensor,
                    orthomosaic: row.orthomosaic || row.agrowstitch_version,
                    delete_traits: true,
                    path: row.csv_path,
                });

                alert(`Successfully deleted inference results.${result.deleted_files ? '\n\nDeleted files:\n' + result.deleted_files.join('\n') : ''}`);

                setInferenceData(prevData =>
                    prevData.filter(item => item.id !== row.id)
                );

                if (selectedInferenceData && selectedInferenceData.date === row.date &&
                    selectedInferenceData.platform === row.platform &&
                    selectedInferenceData.sensor === row.sensor) {
                    setIsInferencePreviewOpen(false);
                    setSelectedInferenceData(null);
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
            field: 'classes_detected',
            headerName: 'Detections',
            width: 150,
            valueGetter: (params) => params.row.total_predictions,
            renderCell: (params) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {formatClassCounts(params.row.classes_detected || {})}
                </Box>
            )
        },
        {
            field: 'plot_count',
            headerName: 'Plots',
            width: 80,
            type: 'number'
        },
        {
            field: 'has_segmentation',
            headerName: 'Segmentation',
            width: 130,
            renderCell: (params) => {
                const isSegmentation = params.row.model_task === 'segmentation';
                return isSegmentation ?
                    <Chip label="Yes" color="success" size="small" /> :
                    <Chip label="No" size="small" />;
            }
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
                        color="primary"
                    >
                        <VisibilityIcon />
                    </IconButton>
                    <IconButton
                        size="small"
                        onClick={() => handleDownloadCSV(params.row)}
                        title="Download CSV results"
                        color="secondary"
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
