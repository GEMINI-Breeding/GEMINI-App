import React, { useEffect, useState } from "react";
import { useDataState } from "../../DataContext";
import { DataGrid } from '@mui/x-data-grid';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { Alert, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Button } from '@mui/material';

export const TableComponent = () => {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const { flaskUrl } = useDataState();
    const [procData, setProcData] = useState([]);

    const [dialogOpen, setDialogOpen] = useState(false);
    const [currentRow, setCurrentRow] = useState(null);
    const [editFields, setEditFields] = useState({});
    const [showEditSuccess, setShowEditSuccess] = useState(false);
    const [showDeleteSuccess, setShowDeleteSuccess] = useState(false);

    useEffect(() => {
        setShowEditSuccess(false);
        setShowDeleteSuccess(false);
        setLoading(true);
        fetch(`${flaskUrl}list_dirs_nested`)
            .then((response) => response.json())
            .then((data) => {
                setData(data);
                setProcData(transformNestedData(data));
                setLoading(false);
            })
            .catch((error) => {
                console.error("Error fetching nested directories:", error);
                setError(error);
                setLoading(false);
            });
    }, [flaskUrl]);

    const handleEdit = (id) => {
        setShowEditSuccess(false);
        setShowDeleteSuccess(false);
        const row = procData.find((row) => row.id === id);
        setCurrentRow(row);
        setEditFields({ ...row });
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
            })
            .catch((error) => {
                console.error("Error deleting data:", error);
                setShowDeleteSuccess(false);
            });
    };

    const handleDialogClose = () => {
        setDialogOpen(false);
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setEditFields((prev) => ({ ...prev, [name]: value }));
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

    // Make sure it gets nested under same parent correctly
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
            return {
                id: index,
                year: parts[0] || '',
                experiment: parts[1] || '',
                location: parts[2] || '',
                population: parts[3] || '',
                date: parts[4] || '',
                platform: parts[5] || '',
                sensor: parts[6] || '',
            };
        });
    };

    const columns = [
        { field: 'year', headerName: 'Year', width: 100 },
        { field: 'experiment', headerName: 'Experiment', width: 150 },
        { field: 'location', headerName: 'Location', width: 150 },
        { field: 'population', headerName: 'Population', width: 150 },
        { field: 'date', headerName: 'Date', width: 150 },
        { field: 'platform', headerName: 'Platform', width: 150 },
        { field: 'sensor', headerName: 'Sensor', width: 150 },
        {
            field: 'actions',
            headerName: 'Actions',
            width: 120,
            renderCell: (params) => (
                <div style={{ display: 'flex', gap: '12px' }}>
                    <EditIcon
                        color="primary"
                        style={{ cursor: 'pointer' }}
                        onClick={() => handleEdit(params.id)}
                    />
                    <DeleteIcon
                        color="error"
                        style={{ cursor: 'pointer' }}
                        onClick={() => handleDelete(params.id)}
                    />
                </div>
            ),
        },
    ];

    if (loading) return <p>Loading...</p>;
    if (error) return <p>Error: {error.message}</p>;

    return (
        <div>
            {showEditSuccess && <Alert severity="success">Successfully updated data.</Alert>}
            {showDeleteSuccess && <Alert severity="success">Successfully deleted data.</Alert>}
            <h2>Data Table</h2>
            <div style={{ height: 400, width: '100%' }}>
                <DataGrid
                    rows={procData}
                    columns={columns}
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
                            <TextField
                                margin="dense"
                                name="year"
                                label="Year"
                                fullWidth
                                value={editFields.year || ''}
                                onChange={handleInputChange}
                            />
                            <TextField
                                margin="dense"
                                name="experiment"
                                label="Experiment"
                                fullWidth
                                value={editFields.experiment || ''}
                                onChange={handleInputChange}
                            />
                            <TextField
                                margin="dense"
                                name="location"
                                label="Location"
                                fullWidth
                                value={editFields.location || ''}
                                onChange={handleInputChange}
                            />
                            <TextField
                                margin="dense"
                                name="population"
                                label="Population"
                                fullWidth
                                value={editFields.population || ''}
                                onChange={handleInputChange}
                            />
                            <TextField
                                margin="dense"
                                name="date"
                                label="Date"
                                fullWidth
                                value={editFields.date || ''}
                                onChange={handleInputChange}
                            />
                            <TextField
                                margin="dense"
                                name="platform"
                                label="Platform"
                                fullWidth
                                value={editFields.platform || ''}
                                onChange={handleInputChange}
                            />
                            <TextField
                                margin="dense"
                                name="sensor"
                                label="Sensor"
                                fullWidth
                                value={editFields.sensor || ''}
                                onChange={handleInputChange}
                            />
                        </div>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleDialogClose}>Cancel</Button>
                    <Button onClick={handleSave}>Save</Button>
                </DialogActions>
            </Dialog>
        </div>

        
    );
};
