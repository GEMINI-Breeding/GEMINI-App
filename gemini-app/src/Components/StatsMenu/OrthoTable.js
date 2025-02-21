import React, { useState, useEffect } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { fetchData, useDataState } from "../../DataContext";
import { Box, Typography, Alert } from '@mui/material';
import { IconButton } from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DeleteIcon from '@mui/icons-material/Delete';
import OrthoPreview from '../Menu/OrthoPreview';
import Download from "@mui/icons-material/Download";

const OrthoTable = () => {
    const [orthoData, setOrthoData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { flaskUrl, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP } = useDataState();
    const [isOrthoPreviewOpen, setIsOrthoPreviewOpen] = useState(false);
    const [viewImageUrl, setViewImageUrl] = useState(null);

    useEffect(() => {
        const fetchOrthoData = async () => {
            setLoading(true);
            try {
                const dates = await fetchData(
                    `${flaskUrl}list_dirs/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`
                );

                const allOrthoData = [];

                for (const date of dates) {
                    const platforms = await fetchData(
                        `${flaskUrl}list_dirs/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}`
                    );

                    for (const platform of platforms) {
                        const sensors = await fetchData(
                            `${flaskUrl}list_dirs/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}`
                        );

                        for (const sensor of sensors) {
                            const orthoFiles = await fetchData(
                                `${flaskUrl}list_files/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}`
                            );

                            const rgbFile = orthoFiles.find(file => file === `${date}-RGB.tif`);

                            if (rgbFile) {
                                let orthoEntry = {
                                    id: `${date}-${platform}-${sensor}`,
                                    date,
                                    platform,
                                    sensor,
                                    quality: 'N/A',
                                    fileName: rgbFile,
                                    timestamp: 'N/A'
                                };

                                try {
                                    const response = await fetch(
                                        `${flaskUrl}get_ortho_metadata?date=${date}&platform=${platform}&sensor=${sensor}&year=${selectedYearGCP}&experiment=${selectedExperimentGCP}&location=${selectedLocationGCP}&population=${selectedPopulationGCP}`
                                    );

                                    if (!response.ok) {
                                        throw new Error(`HTTP error! status: ${response.status}`);
                                    }

                                    const metadata = await response.json();

                                    if (metadata && !metadata.error) {
                                        orthoEntry.quality = metadata.quality || 'N/A';
                                        orthoEntry.timestamp = metadata.timestamp || 'N/A';
                                    } else {
                                        console.warn(`Metadata error for ${date}/${platform}/${sensor}:`, metadata ? metadata.error : 'No metadata');
                                    }
                                } catch (error) {
                                    console.error(`Error fetching metadata for ${date}/${platform}/${sensor}:`, error);
                                }

                                allOrthoData.push(orthoEntry);
                            }
                        }
                    }
                }

                setOrthoData(allOrthoData);
                setLoading(false);
            } catch (error) {
                console.error('Error fetching ortho data:', error);
                setError('Failed to fetch ortho data');
                setLoading(false);
            }
        };

        if (selectedLocationGCP && selectedPopulationGCP) {
            fetchOrthoData();
        }
    }, [selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP, flaskUrl]);

    const handleViewOrtho = (row) => {
        const imageUrl = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${row.date}/${row.platform}/${row.sensor}/${row.fileName}`;
        setViewImageUrl(imageUrl);
        setIsOrthoPreviewOpen(true);
    };

    const handleDeleteOrtho = async (row) => {
        if (window.confirm(`Are you sure you want to delete the ortho for ${row.date}?`)) {
            try {
                const response = await fetch(`${flaskUrl}delete_ortho`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        year: selectedYearGCP,
                        experiment: selectedExperimentGCP,
                        location: selectedLocationGCP,
                        population: selectedPopulationGCP,
                        date: row.date,
                        platform: row.platform,
                        sensor: row.sensor,
                    }),
                });

                if (!response.ok) {
                    throw new Error('Failed to delete ortho');
                }

                // Remove the deleted ortho from the state
                setOrthoData(orthoData.filter(ortho => ortho.id !== row.id));
            } catch (error) {
                console.error('Error deleting ortho:', error);
                setError('Failed to delete ortho');
            }
        }
    };

    const handleDownloadOrtho = async (row) => {
        try {
            const response = await fetch(`${flaskUrl}download_ortho`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date: row.date,
                    platform: row.platform,
                    sensor: row.sensor,
                }),
            });
    
            if (!response.ok) {
                throw new Error('Failed to download ortho');
            }
    
            // Convert the response to a Blob
            const blob = await response.blob();
            // Create a temporary URL for the blob
            const url = window.URL.createObjectURL(blob);
            // Create a temporary anchor element and trigger the download
            const a = document.createElement("a");
            a.href = url;
            // Extract the filename from the response headers or set a default one
            const disposition = response.headers.get("Content-Disposition");
            let fileName = row.fileName.replace('.tif', '.png');
            if (disposition && disposition.indexOf("filename=") !== -1) {
                const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
                const matches = filenameRegex.exec(disposition);
                if (matches != null && matches[1]) {
                    fileName = matches[1].replace(/['"]/g, '');
                }
            }
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error downloading ortho:', error);
            setError('Failed to download ortho');
        }
    };

    const columns = [
        { field: 'date', headerName: 'Date', width: 120 },
        { field: 'platform', headerName: 'Platform', width: 120 },
        { field: 'sensor', headerName: 'Sensor', width: 120 },
        { field: 'quality', headerName: 'Quality', width: 120 },
        { field: 'fileName', headerName: 'Ortho File', width: 200 },
        { field: 'timestamp', headerName: 'Timestamp', width: 180 },
        {
            field: 'view',
            headerName: 'View',
            width: 100,
            renderCell: (params) => (
                <IconButton onClick={() => handleViewOrtho(params.row)}>
                    <VisibilityIcon />
                </IconButton>
            ),
        },
        {
            field: 'delete',
            headerName: 'Delete',
            width: 100,
            renderCell: (params) => (
                <IconButton onClick={() => handleDeleteOrtho(params.row)}>
                    <DeleteIcon />
                </IconButton>
            ),
        },
        {
            field: 'download',
            headerName: 'Download',
            width: 100,
            renderCell: (params) => (
                <IconButton onClick={() => handleDownloadOrtho(params.row)}>
                    <Download />
                </IconButton>
            ),
        }
    ];

    if (loading) return <Typography>Loading...</Typography>;
    if (error) return <Alert severity="error">Error: {error}</Alert>;

    return (
        <Box sx={{ height: 400, width: '100%' }}>
            <Typography variant="h6" gutterBottom component="div">
                Generated Orthomosaics
            </Typography>
            {orthoData.length === 0 ? (
                <Typography>No orthomosaic data available.</Typography>
            ) : (
                <DataGrid
                    rows={orthoData}
                    columns={columns}
                    pageSize={5}
                    rowsPerPageOptions={[5, 10, 20]}
                    disableSelectionOnClick
                />
            )}
            <OrthoPreview
                open={isOrthoPreviewOpen}
                onClose={() => setIsOrthoPreviewOpen(false)}
                imageUrl={viewImageUrl}
            />
        </Box>
    );
};

export default OrthoTable;