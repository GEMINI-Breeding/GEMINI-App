import React, { useEffect, useState } from "react";
import { useDataState, useDataSetters } from "../../DataContext";
import { DataGrid } from '@mui/x-data-grid';
import { Edit, Delete, Visibility, ConstructionOutlined, SnowshoeingOutlined, RemoveFromQueue } from '@mui/icons-material';
import { Alert, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, Select, MenuItem, TextField, Button } from '@mui/material';
import { ImagePreviewer } from "./ImagePreviewer";
import ArticleIcon from '@mui/icons-material/Article'; // paper icon for reports
import dataTypes from "../../uploadDataTypes.json";
import { Tooltip } from '@mui/material';
import ExploreIcon from '@mui/icons-material/Explore';
import CSVDataTable from "../StatsMenu/CSVDataTable";
// import { CSVPreviewer } from "./CSVPreview";

export const TableComponent = () => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { flaskUrl } = useDataState();
    const [procData, setProcData] = useState([]);
    const [filteredData, setFilteredData] = useState([]);
    const [selectedDataType, setSelectedDataType] = useState("image");
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogViewOpen, setDialogViewOpen] = useState(false);
    const [currentRow, setCurrentRow] = useState(null);
    const [editFields, setEditFields] = useState({});
    const [rowDataType, setRowDataType] = useState(""); 
    const [showEditSuccess, setShowEditSuccess] = useState(false);
    const [showDeleteSuccess, setShowDeleteSuccess] = useState(false);
    const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
    const [nestedDirectories, setNestedDirectories] = useState({});
    const [imagePreviewData, setImagePreviewData] = useState(null);
    // const [csvPreviewData, setCSVPreviewData] = useState(null);
    // const [csvPreviewOpen, setCSVPreviewOpen] = useState(false);
    const [reportDialogOpen, setReportDialogOpen] = useState(false);
    const [reportContent, setReportContent] = useState("");
    const [csvData, setCsvData] = useState([]);
    const [csvDialogOpen, setCsvDialogOpen] = useState(false);

    const {
        uploadedData
    } = useDataState();

    const {
        setUploadedData
    } = useDataSetters();
    
    const baseColumns = [
        { field: 'year', headerName: 'Year', width: 100 },
        { field: 'experiment', headerName: 'Experiment', width: 150 },
        { field: 'location', headerName: 'Location', width: 150 },
        { field: 'population', headerName: 'Population', width: 150 },
    ];
    
    const typeSpecificColumns = {
        image: [
            { field: 'date', headerName: 'Date', width: 150 },
            { field: 'platform', headerName: 'Platform', width: 150 },
            { field: 'sensor', headerName: 'Sensor', width: 150 },
        ],
        binary: [
            { field: 'date', headerName: 'Date', width: 150 },
            { field: 'camera', headerName: 'Camera', width: 150 },
        ],
        weather: [
            { field: 'date', headerName: 'Date', width: 150 },
        ],
        gcpLocations: [],
        platformLogs: [
            { field: 'date', headerName: 'Date', width: 150 },
            { field: 'platform', headerName: 'Platform', width: 150 },
            { field: 'sensor', headerName: 'Sensor', width: 150 },
        ],
    };

    useEffect(() => {
        setShowEditSuccess(false);
        setShowDeleteSuccess(false);
        setLoading(true);
        fetch(`${flaskUrl}list_dirs_nested`)
            .then((response) => response.json())
            .then((data) => {
                setData(data);
                const transformedData = transformNestedData(data);
                setProcData(transformedData);
                setFilteredData(transformedData);
                setLoading(false);
            })
            .catch((error) => {
                console.error("Error fetching nested directories:", error);
                setError(error);
                setLoading(false);
            });
    }, [flaskUrl]);
    
    useEffect(() => {
        const filtered = procData.filter(row => detectDataType(row) === selectedDataType);
        setFilteredData(filtered);
    }, [selectedDataType, procData]);

    const detectDataType = (row) => {
        if (row.sensor && (row.platform && row.platform !== "rover") && row.date) return "image";
        if (row.platform === "rover" && row.camera !== "") return "binary";
        if ((row.date && row.date !== "[object Object]") && (!row.platform || row.platform === "[object Object]")) return "weather";
        if ((!row.date || row.date === "[object Object]") && row.population) return "gcpLocations";
        if (row.sensor && (row.platform && row.platform !== "rover")) return "platformLogs";
        return "unknown";
    };

    const handleViewReport = async (id) => {
        const row = procData.find((row) => row.id === id);
        if (!row) return;
    
        try {
            const response = await fetch(`${flaskUrl}get_binary_report`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    location: row.location,
                    population: row.population,
                    date: row.date,
                    year: row.year,
                    experiment: row.experiment,
                    camera: row.camera
                })
            });
    
            const data = await response.text();
            setReportContent(data);
            setReportDialogOpen(true);
        } catch (error) {
            console.error("Error fetching report:", error);
            setReportContent("Failed to load report.");
            setReportDialogOpen(true);
        }
    };    

    const handleEdit = (id) => {
        setShowEditSuccess(false);
        setShowDeleteSuccess(false);
        const row = procData.find((row) => row.id === id);
        setCurrentRow(row);
        setEditFields({ ...row });
        
        const dataType = detectDataType(row);
        setRowDataType(dataType);
        
        setDialogOpen(true);
    };

    const handleDelete = (id) => {
        setShowEditSuccess(false);
        setShowDeleteSuccess(false);
        const row = procData.find((row) => row.id === id);
        if (!row) {
            console.error("Row not found");
            return;
        }
    
        setCurrentRow(row);
    
        const data_to_del = {
            location: row.location,
            population: row.population,
            date: row.date,
            year: row.year,
            experiment: row.experiment,
            sensor: row.sensor,
            platform: row.platform
        };
    
        fetch(`${flaskUrl}delete_files`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data_to_del }),
        })
            .then(response => response.json())
            .then(() => {
                setProcData((prevData) =>
                    prevData.filter((row) => row.id !== id)
                );
                setShowDeleteSuccess(true);
                fetch(`${flaskUrl}list_dirs_nested`)
                    .then((response) => response.json())
                    .then((data) => {
                        setNestedDirectories(data);
                    })
                    .catch((error) => {
                        console.error("Error fetching nested directories:", error);
                        setUploadedData(false);
                    });
            })
            .catch((error) => {
                console.error("Error deleting data:", error);
                setShowDeleteSuccess(false);
            });
    };

    const handleDialogClose = () => {
        setDialogOpen(false);
    };

    const handleViewDialogClose = () => {
        setDialogViewOpen(false);
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setEditFields((prev) => ({ ...prev, [name]: value }));
    };

    const handleView = (id) => {
        const row = procData.find((row) => row.id === id);
        console.log(rowDataType);
        if (row && row.platform !== "") {
            const obj = {
                location: row.location,
                population: row.population,
                date: row.date,
                year: row.year,
                experiment: row.experiment,
                sensor: row.sensor,
                platform: row.platform,
                camera: row.camera
            };
            setImagePreviewData(obj);
            setImagePreviewOpen(true);
        }
        // else if (row) {
        //     const obj = {
        //         location: row.location,
        //         population: row.population,
        //         year: row.year,
        //         experiment: row.experiment,
        //         date: row.date
        //     };
        //     console.log("CSV Preview Data: ", obj);
        //     setCSVPreviewData(obj);
        //     setCSVPreviewOpen(true);
            
        // }
    };

    const handleSave = () => {
        setShowEditSuccess(false);
        setShowDeleteSuccess(false);
        const oldData = {
            location: currentRow.location,
            population: currentRow.population,
            date: currentRow.date,
            year: currentRow.year,
            experiment: currentRow.experiment,
            sensor: currentRow.sensor,
            platform: currentRow.platform
        };
    
        const updatedData = {
            location: editFields.location || '',
            population: editFields.population || '',
            date: editFields.date || '',
            year: editFields.year || '',
            experiment: editFields.experiment || '',
            sensor: editFields.sensor || '',
            platform: editFields.platform || ''
        };
    
        fetch(`${flaskUrl}update_data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldData, updatedData }),
        })
            .then(response => response.json())
            .then(() => {
                setProcData((prevData) =>
                    prevData.map((row) =>
                        row.id === currentRow.id ? { ...row, ...editFields } : row
                    )
                );
                handleDialogClose();
            })
            .then(() => {
                setShowEditSuccess(true);
            })
            .catch((error) => {
                console.error("Error updating data:", error);
            });
    };
    const convertToPath = (data) => {
        const paths = [];
    
        const traverse = (node, path = []) => {
            if (typeof node === 'object' && node !== null && Object.keys(node).length > 0) {
                for (const [key, value] of Object.entries(node)) {
                    traverse(value, [...path, key]);
                }
            } else {
                paths.push([...path, node].join(' > '));
            }
        };
    
        for (const [key, value] of Object.entries(data)) {
            traverse(value, [key]);
        }
    
        return paths;
    };
    
    const transformNestedData = (nestedData) => {
        const flattenedPaths = convertToPath(nestedData);
        return flattenedPaths.map((path, index) => {
            const parts = path.split(' > ');
            let camera = '';
            if (parts[5] === 'rover' && parts[7] === 'Images') { 
                camera = parts[8];
            }
            return {
                id: index,
                year: parts[0] || '',
                experiment: parts[1] || '',
                location: parts[2] || '',
                population: parts[3] || '',
                date: parts[4] || '',
                platform: parts[5] || '',
                sensor: parts[6] || '',
                camera: camera // for Amiga file viewing
            };
        });
    };

    const handleViewSyncedData = async (id) => {
        const row = procData.find((row) => row.id === id);  
        if (!row) return;
    
        const baseDir = `Raw/${row.year}/${row.experiment}/${row.location}/${row.population}/${row.date}/${row.platform}/${row.sensor}`;
    
        try {
            const response = await fetch(`${flaskUrl}view_synced_data`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ base_dir: baseDir }),
            });
    
            const data = await response.json();
    
            if (response.ok && data.data) {
                setCsvData(data.data);  // ✅ Directly set parsed JSON
                setCsvDialogOpen(true);
            } else {
                console.error("Error fetching CSV:", data.error || "Unknown error");
            }
        } catch (err) {
            console.error("Fetch error:", err);
        }
    };
            
    const getColumns = () => {
        const actionsColumn = [
            {
            field: 'actions',
            headerName: 'Actions',
            width: 180,
            
            renderCell: (params) => (
                <div style={{ display: 'flex', gap: '12px' }}>
                {selectedDataType !== "binary" && (
                    <>
                    <Edit
                        color="primary"
                        style={{ cursor: 'pointer' }}
                        onClick={() => handleEdit(params.id)}
                    />
                    <Delete
                        color="error"
                        style={{ cursor: 'pointer' }}
                        onClick={() => handleDelete(params.id)}
                    />
                    </>
                )}
                {selectedDataType !== "gcpLocations" && selectedDataType !== "weather" && selectedDataType !== "platformLogs" && (
                    <Tooltip title="View Image">
                        <Visibility
                            color="action"
                            style={{ cursor: 'pointer' }}
                            onClick={() => handleView(params.id)}
                        />
                    </Tooltip>
                )}
                {selectedDataType === "binary" && (
                <>
                    <Tooltip title="View Report">
                        <ArticleIcon
                            color="action"
                            style={{ cursor: 'pointer' }}
                            onClick={() => handleViewReport(params.id)}
                        />
                        </Tooltip>
                    <Tooltip title="View Synced Data">
                        <ExploreIcon
                            color="action"
                            style={{ cursor: 'pointer' }}
                            onClick={() => handleViewSyncedData(params.id)}
                        />
                    </Tooltip>
                </>
                )}
                </div>
            ),
            }
        ];
        
        return [
            ...baseColumns,
            ...(typeSpecificColumns[selectedDataType] || []),
            ...actionsColumn
        ];
    };

    if (loading) return <p>Loading...</p>;
    if (error) return <p>Error: {error.message}</p>;

    return (
        <div>
            {showEditSuccess && <Alert severity="success">Successfully updated data.</Alert>}
            {showDeleteSuccess && <Alert severity="success">Successfully deleted data.</Alert>}
            <h2>Data Table</h2>
            <FormControl fullWidth style={{ marginBottom: '20px' }}>
                <InputLabel>Data Type</InputLabel>
                <Select
                    value={selectedDataType}
                    label="Data Type"
                    onChange={(e) => setSelectedDataType(e.target.value)}
                >
                    {Object.entries(dataTypes).map(([type, config]) => (
                        <MenuItem key={type} value={type}>
                            {config.label}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>
            <div style={{ height: 400, width: '100%' }}>
                <DataGrid
                    rows={filteredData}
                    columns={getColumns()}
                    pageSize={10}
                    rowsPerPageOptions={[10]}
                    getRowId={(row) => row.id}
                />
            </div>

            <Dialog open={dialogOpen} onClose={handleDialogClose}>
                <DialogTitle>Edit Row</DialogTitle>
                <DialogContent>
                    {currentRow && (
                        <div>
                            {baseColumns.map(column => (
                                <TextField
                                    key={column.field}
                                    margin="dense"
                                    name={column.field}
                                    label={column.headerName}
                                    fullWidth
                                    value={editFields[column.field] || ''}
                                    onChange={handleInputChange}
                                />
                            ))}
                            {typeSpecificColumns[rowDataType] && typeSpecificColumns[rowDataType].map(column => (
                                <TextField
                                    key={column.field}
                                    margin="dense"
                                    name={column.field}
                                    label={column.headerName}
                                    fullWidth
                                    value={editFields[column.field] || ''}
                                    onChange={handleInputChange}
                                />
                            ))}
                        </div>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleDialogClose}>Cancel</Button>
                    <Button onClick={handleSave}>Save</Button>
                </DialogActions>
            </Dialog>
            <ImagePreviewer
                open={imagePreviewOpen}
                obj={imagePreviewData}
                onClose={() => setImagePreviewOpen(false)}
            /> 
            {/* <CSVPreviewer
                open={csvPreviewOpen}
                obj={csvPreviewData}
                onClose={() => setCSVPreviewOpen(false)}
            />  */}
            <Dialog open={csvDialogOpen} onClose={() => setCsvDialogOpen(false)} maxWidth="xl" fullWidth>
            <DialogTitle>Synced CSV Data</DialogTitle>
                <DialogContent>
                    <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                    <CSVDataTable data={csvData} />
                    </div>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCsvDialogOpen(false)}>Close</Button>
                </DialogActions>
            </Dialog>
            <Dialog
                open={reportDialogOpen}
                onClose={() => setReportDialogOpen(false)}
                maxWidth="lg"
                fullWidth
                PaperProps={{
                    style: {
                    maxHeight: '80vh', // taller dialog
                    width: '90vw'       // wider dialog
                    }
                }}
                >
                <DialogTitle>Amiga File Report</DialogTitle>
                <DialogContent dividers>
                    <pre style={{
                    whiteSpace: 'pre-wrap',
                    wordWrap: 'break-word',
                    maxHeight: '60vh',
                    overflowY: 'auto',
                    fontFamily: 'monospace'
                    }}>
                    {reportContent}
                    </pre>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setReportDialogOpen(false)}>Close</Button>
                </DialogActions>
            </Dialog>
        </div>
    );
};
