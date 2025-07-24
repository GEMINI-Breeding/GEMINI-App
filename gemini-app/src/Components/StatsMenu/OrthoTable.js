import React, { useState, useEffect } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { fetchData, useDataState } from "../../DataContext";
import { Box, Typography, Alert } from '@mui/material';
import { IconButton } from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DeleteIcon from '@mui/icons-material/Delete';
import OrthoPreview from '../Menu/OrthoPreview';
import RoverPlotPreview from '../Menu/RoverPlotPreview';
import Download from "@mui/icons-material/Download";

const OrthoTable = () => {
    const [orthoData, setOrthoData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { flaskUrl, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP } = useDataState();
    const [isOrthoPreviewOpen, setIsOrthoPreviewOpen] = useState(false);
    const [viewImageUrl, setViewImageUrl] = useState(null);
    const [isRoverPreviewOpen, setIsRoverPreviewOpen] = useState(false);
    const [selectedDatePlatformSensor, setSelectedDatePlatformSensor] = useState(null);

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
                            // First check for regular drone orthomosaics directly in sensor directory
                            const orthoFiles = await fetchData(
                                `${flaskUrl}list_files/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}`
                            );

                            // Check for drone orthomosaics
                            const rgbFiles = orthoFiles.filter(file => 
                                (file.startsWith('AgRowStitch_') && file.endsWith('.tif')) || file === `${date}-RGB-Pyramid.tif`
                            );

                            // Process regular drone orthomosaics
                            for (const rgbFile of rgbFiles) {
                                let orthoEntry = {
                                    id: `${date}-${platform}-${sensor}-${rgbFile}`,
                                    date,
                                    platform,
                                    sensor,
                                    quality: 'N/A',
                                    fileName: rgbFile,
                                    timestamp: 'N/A',
                                    type: 'Full Orthomosaic',
                                    isPlotBased: false
                                };

                                try {
                                    const response = await fetch(
                                        `${flaskUrl}get_ortho_metadata?date=${date}&platform=${platform}&sensor=${sensor}&year=${selectedYearGCP}&experiment=${selectedExperimentGCP}&location=${selectedLocationGCP}&population=${selectedPopulationGCP}&fileName=${rgbFile}`
                                    );

                                    if (response.ok) {
                                        const metadata = await response.json();
                                        if (metadata && !metadata.error) {
                                            orthoEntry.quality = metadata.quality || 'N/A';
                                            orthoEntry.timestamp = metadata.timestamp || 'N/A';
                                        }
                                    }
                                } catch (error) {
                                    console.warn(`Error fetching metadata for ${date}/${platform}/${sensor}/${rgbFile}:`, error);
                                }

                                allOrthoData.push(orthoEntry);
                            }

                            // Now check for AgRowStitch versioned directories
                            try {
                                const sensorDirs = await fetchData(
                                    `${flaskUrl}list_dirs/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}`
                                );

                                // Look for AgRowStitch versioned directories
                                const agrowstitchDirs = sensorDirs.filter(dir => dir.startsWith('AgRowStitch_v'));
                                
                                // Process each version separately to show all versions
                                for (const agrowstitchDir of agrowstitchDirs) {
                                    const plotFiles = await fetchData(
                                        `${flaskUrl}list_files/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/${agrowstitchDir}`
                                    );

                                    // Look for plot image files (prefer full_res over resized, and .png files for viewing)
                                    const plotImages = plotFiles.filter(file => 
                                        file.startsWith('full_res_mosaic_temp_plot_') && file.endsWith('.png')
                                    );

                                    if (plotImages.length > 0) {
                                        // Extract version number for display
                                        const versionMatch = agrowstitchDir.match(/AgRowStitch_v(\d+)/);
                                        const version = versionMatch ? versionMatch[1] : 'unknown';

                                        let plotEntry = {
                                            id: `${date}-${platform}-${sensor}-${agrowstitchDir}`,
                                            date,
                                            platform,
                                            sensor,
                                            quality: 'N/A',
                                            fileName: `${agrowstitchDir}`,
                                            timestamp: 'N/A',
                                            type: `Plot Orthomosaics v${version}`,
                                            isPlotBased: true,
                                            agrowstitchDir: agrowstitchDir,
                                            plotCount: plotImages.length
                                        };

                                        allOrthoData.push(plotEntry);
                                    }
                                }
                            } catch (error) {
                                // No AgRowStitch directories found, continue
                                console.log(`No AgRowStitch directories found for ${date}/${platform}/${sensor}`);
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
        if (row.isPlotBased) {
            // Use rover plot preview for plot-based orthomosaics
            setSelectedDatePlatformSensor({
                date: row.date,
                platform: row.platform,
                sensor: row.sensor,
                agrowstitchDir: row.agrowstitchDir
            });
            setIsRoverPreviewOpen(true);
        } else {
            // Use regular ortho preview for full orthomosaics
            const imageUrl = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${row.date}/${row.platform}/${row.sensor}/${row.fileName}`;
            setViewImageUrl(imageUrl);
            setIsOrthoPreviewOpen(true);
        }
    };

    const handleDeleteOrtho = async (row) => {
        const deleteMessage = row.isPlotBased 
            ? `Are you sure you want to delete the ${row.type} for ${row.date}?`
            : `Are you sure you want to delete the ortho for ${row.date}?`;
            
        if (window.confirm(deleteMessage)) {
            try {
                const deletePayload = {
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date: row.date,
                    platform: row.platform,
                    sensor: row.sensor,
                };

                // For AgRowStitch entries, include the specific version directory
                if (row.isPlotBased) {
                    deletePayload.agrowstitchDir = row.agrowstitchDir; // Use the correct AgRowStitch directory name
                    deletePayload.deleteType = 'agrowstitch';
                    console.log(`Deleting AgRowStitch directory: ${row.agrowstitchDir}`);
                } else {
                    deletePayload.fileName = row.fileName; // This should be the specific file like "2023-06-15-RGB-Pyramid.tif"
                    deletePayload.deleteType = 'ortho';
                    console.log(`Deleting orthomosaic file: ${row.fileName}`);
                }

                console.log('Delete payload:', deletePayload);

                const response = await fetch(`${flaskUrl}delete_ortho`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(deletePayload),
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
            if (row.isPlotBased) {
                // Handle plot-based download - zip the PNG files
                const response = await fetch(`${flaskUrl}download_plot_ortho`, {
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
                        agrowstitchDir: row.agrowstitchDir,
                    }),
                });

                if (!response.ok) {
                    throw new Error('Failed to download plot ortho');
                }

                // Convert the response to a Blob
                const blob = await response.blob();
                // Create a temporary URL for the blob
                const url = window.URL.createObjectURL(blob);
                // Create a temporary anchor element and trigger the download
                const a = document.createElement("a");
                a.href = url;
                // Set filename for the zip file
                const fileName = `${row.date}-${row.platform}-${row.sensor}-${row.agrowstitchDir}-plots.zip`;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
            } else {
                // Handle regular orthomosaic download
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
            }
        } catch (error) {
            console.error('Error downloading ortho:', error);
            setError('Failed to download ortho');
        }
    };

    const columns = [
        { field: 'date', headerName: 'Date', width: 120 },
        { field: 'platform', headerName: 'Platform', width: 120 },
        { field: 'sensor', headerName: 'Sensor', width: 120 },
        { field: 'type', headerName: 'Type', width: 150 },
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
            <RoverPlotPreview
                open={isRoverPreviewOpen}
                onClose={() => setIsRoverPreviewOpen(false)}
                datePlatformSensor={selectedDatePlatformSensor}
            />
        </Box>
    );
};

export default OrthoTable;