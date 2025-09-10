import React, { useMemo } from "react";
import { DataGrid } from '@mui/x-data-grid';
import { Box, Typography } from "@mui/material";

const CSVDataTable = ({ data }) => {
  // Create columns dynamically from the data
  const columns = useMemo(() => {
    if (data.length === 0) return [];
    
    const headers = Object.keys(data[0]);
    return headers.map((header, index) => ({
      field: header,
      headerName: header,
      flex: 1,
      minWidth: 120,
      filterable: true,
      sortable: true,
      // Add custom styling for better readability
      renderCell: (params) => (
        <Box sx={{ 
          whiteSpace: 'normal', 
          wordWrap: 'break-word',
          lineHeight: 1.2,
          py: 1
        }}>
          {params.value}
        </Box>
      ),
    }));
  }, [data]);

  // Add unique IDs to rows for DataGrid
  const rows = useMemo(() => {
    return data.map((row, index) => ({
      id: index,
      ...row
    }));
  }, [data]);

  if (data.length === 0) {
    return (
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: 200,
        border: '1px solid #ddd',
        borderRadius: 1
      }}>
        <Typography variant="body1" color="text.secondary">
          No data available.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ 
      height: 600, 
      width: '100%',
      '& .MuiDataGrid-root': {
        borderRadius: 2,
        border: '1px solid #e0e0e0',
      },
      '& .MuiDataGrid-columnHeaders': {
        backgroundColor: '#6D95E0',
        color: '#ffffff',
        fontSize: '14px',
        fontWeight: 600,
      },
      '& .MuiDataGrid-columnHeaderTitle': {
        color: '#ffffff',
        fontWeight: 600,
      },
      '& .MuiDataGrid-menuIcon': {
        color: '#ffffff',
      },
      '& .MuiDataGrid-sortIcon': {
        color: '#ffffff',
      },
      '& .MuiDataGrid-filterIcon': {
        color: '#ffffff',
      },
      '& .MuiDataGrid-columnSeparator': {
        color: '#ffffff',
      },
      '& .MuiDataGrid-cell': {
        borderBottom: '1px solid #e0e0e0',
        fontSize: '14px',
      },
      '& .MuiDataGrid-row': {
        '&:hover': {
          backgroundColor: '#f5f5f5',
        },
      },
      '& .MuiDataGrid-footerContainer': {
        borderTop: '1px solid #e0e0e0',
        backgroundColor: '#fafafa',
      },
    }}>
      <DataGrid
        rows={rows}
        columns={columns}
        pageSize={25}
        rowsPerPageOptions={[10, 25, 50, 100]}
        disableSelectionOnClick
        autoHeight={false}
        density="comfortable"
        filterMode="client"
        sortingMode="client"
        componentsProps={{
          toolbar: {
            showQuickFilter: true,
            quickFilterProps: { debounceMs: 500 },
          },
        }}
        sx={{
          minHeight: 400,
          '& .MuiDataGrid-cell': {
            lineHeight: 'unset !important',
            maxHeight: 'none !important',
            whiteSpace: 'normal',
          },
          '& .MuiDataGrid-row': {
            maxHeight: 'none !important',
          },
        }}
      />
    </Box>
  );
};

export default CSVDataTable;