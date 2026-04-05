import React, { useState, useEffect } from 'react';
import { DataGrid } from '@mui/x-data-grid';
import { useDataState } from "../../DataContext";
import { Box, Typography, Alert, CircularProgress } from '@mui/material';
import { IconButton } from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DeleteIcon from '@mui/icons-material/Delete';
import OrthoPreview from '../Menu/OrthoPreview';
import RoverPlotPreview from '../Menu/RoverPlotPreview';
import Download from "@mui/icons-material/Download";
import { listDirs, listFiles, deleteOrtho, downloadOrtho, downloadPlotOrtho, getOrthoMetadata } from '../../api/files';
import { getPlotBordersData } from '../../api/queries';
import { BACKEND_MODE } from '../../api/config';

const OrthoTable = () => {
    const [orthoData, setOrthoData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP } = useDataState();
    const [isOrthoPreviewOpen, setIsOrthoPreviewOpen] = useState(false);
    const [viewImageUrl, setViewImageUrl] = useState(null);
    const [isRoverPreviewOpen, setIsRoverPreviewOpen] = useState(false);
    const [selectedDatePlatformSensor, setSelectedDatePlatformSensor] = useState(null);
    const [plotData, setPlotData] = useState({});

    useEffect(() => {
        const fetchOrthoData = async () => {
            setLoading(true);
            try {
                const basePath = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`;
                const dates = await listDirs(basePath);

                const allOrthoData = [];

                for (const date of dates) {
                    const platforms = await listDirs(`${basePath}/${date}`);

                    for (const platform of platforms) {
                        const sensors = await listDirs(`${basePath}/${date}/${platform}`);

                        for (const sensor of sensors) {
                            // First check for regular drone orthomosaics directly in sensor directory
                            const orthoFiles = await listFiles(`${basePath}/${date}/${platform}/${sensor}`);

                            // Check for drone orthomosaics
                            const rgbFiles = orthoFiles.filter(file =>
                                (file.startsWith('AgRowStitch_') && file.endsWith('.tif')) || file === `${date}-RGB.tif`
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
                                    const metadata = await getOrthoMetadata({
                                        date, platform, sensor, fileName: rgbFile,
                                        year: selectedYearGCP, experiment: selectedExperimentGCP,
                                        location: selectedLocationGCP, population: selectedPopulationGCP,
                                    });
                                    if (metadata && !metadata.error) {
                                        orthoEntry.quality = metadata.quality || 'N/A';
                                        orthoEntry.timestamp = metadata.timestamp || 'N/A';
                                    }
                                } catch (error) {
                                    console.warn(`Error fetching metadata for ${date}/${platform}/${sensor}/${rgbFile}:`, error);
                                }

                                allOrthoData.push(orthoEntry);
                            }

                            // Now check for AgRowStitch versioned directories
                            try {
                                const sensorDirs = await listDirs(`${basePath}/${date}/${platform}/${sensor}`);

                                // Look for AgRowStitch versioned directories
                                const agrowstitchDirs = sensorDirs.filter(dir => dir.startsWith('AgRowStitch_v'));

                                // Process each version separately to show all versions
                                for (const agrowstitchDir of agrowstitchDirs) {
                                    const plotFiles = await listFiles(`${basePath}/${date}/${platform}/${sensor}/${agrowstitchDir}`);

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

        if (selectedLocationGCP && selectedPopulationGCP) {
            fetchOrthoData();
            fetchPlotData();
        }
    }, [selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP]);

    const getPlotNumber = (fileName) => {
        const match = fileName.match(/plot_(\d+)/);
        return match ? match[1] : 'Unknown';
    };

    const getPlotMetadata = (fileName) => {
        const plotNumber = getPlotNumber(fileName);
        const plotIndex = parseInt(plotNumber);
        const metadata = plotData[plotIndex] || {};

        return {
            plotNumber,
            plotLabel: metadata.plot,
            accession: metadata.accession
        };
    };

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

                if (row.isPlotBased) {
                    deletePayload.agrowstitchDir = row.agrowstitchDir;
                    deletePayload.deleteType = 'agrowstitch';
                } else {
                    deletePayload.fileName = row.fileName;
                    deletePayload.deleteType = 'ortho';
                }

                await deleteOrtho(deletePayload);

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
                const result = await downloadPlotOrtho({
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date: row.date,
                    platform: row.platform,
                    sensor: row.sensor,
                    agrowstitchDir: row.agrowstitchDir,
                });

                if (BACKEND_MODE !== 'flask') {
                    // Framework mode: result has presigned URLs for individual files
                    for (const file of (result.files || [])) {
                        const a = document.createElement("a");
                        a.href = file.url;
                        a.download = file.name;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                    }
                } else {
                    // Flask mode: result is a blob response
                    const blob = await result.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${row.date}-${row.platform}-${row.sensor}-plots.zip`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(url);
                }
            } else {
                const result = await downloadOrtho({
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date: row.date,
                    platform: row.platform,
                    sensor: row.sensor,
                    fileName: row.fileName,
                });

                if (BACKEND_MODE !== 'flask') {
                    // Framework mode: result has presigned URL
                    const a = document.createElement("a");
                    a.href = result.url;
                    a.download = result.fileName;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                } else {
                    // Flask mode: result is a fetch Response
                    const blob = await result.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    let fileName = row.fileName.replace('.tif', '.png');
                    const disposition = result.headers.get("Content-Disposition");
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
        { field: 'fileName', headerName: 'Ortho File', width: 200 },
        {
            field: 'view',
            headerName: 'View',
            width: 100,
            renderCell: (params) => (
                <IconButton onClick={() => handleViewOrtho(params.row)} color="primary">
                    <VisibilityIcon />
                </IconButton>
            ),
        },
        {
            field: 'delete',
            headerName: 'Delete',
            width: 100,
            renderCell: (params) => (
                <IconButton onClick={() => handleDeleteOrtho(params.row)} color = "error">
                    <DeleteIcon />
                </IconButton>
            ),
        },
        {
            field: 'download',
            headerName: 'Download',
            width: 100,
            renderCell: (params) => (
                <IconButton onClick={() => handleDownloadOrtho(params.row)} color="secondary">
                    <Download />
                </IconButton>
            ),
        }
    ];

    if (loading) return (
        <Box sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: 400,
            flexDirection: 'column',
            gap: 2
        }}>
            <CircularProgress size={40} />
            <Typography variant="body2" color="text.secondary">
                Loading mosaic data...
            </Typography>
        </Box>
    );
    if (error) return <Alert severity="error">Error: {error}</Alert>;

    return (
        <Box sx={{ height: 400, width: '100%' }}>
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
