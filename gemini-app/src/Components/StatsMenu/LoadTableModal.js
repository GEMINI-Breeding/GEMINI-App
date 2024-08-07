import { useState, useEffect, useMemo } from 'react';
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import Button from "@mui/material/Button";

// import { useTable } from 'react-table';

import { fetchData, useDataSetters, useDataState } from "../../DataContext.js";

import { geojsonToCSV, downloadCSV } from "./GeojsonUtils.js";
import CSVDataTable from "./CSVDataTable.js";

// export let COLUMNS = [
//     // {
//     //     Header: 'ID',
//     //     accessor: 'id_number',
//     // },
//     // {
//     //     Header: 'First Name',
//     //     accessor: 'firstName',
//     // },
//     // {
//     //     Header: 'Last Name',
//     //     accessor: 'lastName',
//     // },
//     // {
//     //     Header: 'Email',
//     //     accessor: 'email',
//     // },
//     // {
//     //     Header: 'Department',
//     //     accessor: 'department',
//     // },
//     // {
//     //     Header: 'Date Joined',
//     //     accessor: 'dateJoined',
//     // },
// ];

const LoadTableModal = ({ open, onClose, item }) => {

    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedYearGCP,
        selectedExperimentGCP,
    } = useDataState();

    const { 
    } = useDataSetters();

    const [tableData, setTableData] = useState([]);
    
    const [geojsonData, setGeojsonData] = useState(null);
    const [csvString, setCsvString] = useState("");
    const [csvData, setCsvData] = useState([]);
    

    //const columns = useMemo(() => COLUMNS, []);
    // const { getTableProps, getTableBodyProps, headerGroups, rows, prepareRow } =
    //     useTable({ columns, tableData });

    useEffect(() => {
        if(open){
            //console.log("LoadTableModal useEffect",open);
            //console.log("item", item);
            // Load Geojson Data
            if (item.geoJsonFile) {
                fetch(item.geoJsonFile)
                    .then((response) => response.json())
                    .then((data) => setGeojsonData(data))
                    .catch((error) => console.error("Error fetching geojson:", error));
            }else{
                console.log("No Geojson File");
            }
        }
    }, [open]);

    useEffect(() => {
        //console.log("geojsonData", geojsonData);
        const csv = geojsonToCSV(geojsonData);
        //console.log("csv", csv);
        setCsvString(csv);
    }, [geojsonData]);

    const downloadCsvOnClick = () => {
        // @TODO: Add more detaild to the file
        const csv_name = (item && item.date) + ".csv";
        downloadCSV(csvString, `${csv_name}`);
    };

    const makeColumnsFromGeoJson = (data) => {
        const columns = [];
        if (data && data.features.length > 0) {
            const feature = data.features[0];
            for (const key in feature.properties) {
                columns.push({
                    Header: key,
                    accessor: `properties.${key}`,
                });
            }
        }
        return columns;
    }

    const updateDataFromGeoJson = (data) => {
        const updatedData = [];
        if (data && data.features.length > 0) {
            data.features.forEach((feature) => {
                updatedData.push(feature.properties);
            });
        }
        return updatedData;
    }

    const parseCSV = (csvText) => {
        console.log("parseCSV", csvText);
        const lines = csvText.split("\n");
        const headers = lines[0].split(",");
        const parsedData = [];
      
        for (let i = 1; i < lines.length; i++) {
          const currentLine = lines[i].split(",");
      
          if (currentLine.length === headers.length) {
            const row = {};
            for (let j = 0; j < headers.length; j++) {
              row[headers[j].trim()] = currentLine[j].trim();
            }
            parsedData.push(row);
          }
        }
      
        setCsvData(parsedData);
      };

    useEffect(() => {
        parseCSV(csvString)
    },[csvString]);



    // useEffect(() => {
    //     const fetchData = async () => {
    //         COLUMNS = makeColumnsFromGeoJson(geojsonData);
    //         //console.log("COLUMNS", COLUMNS);
    //         setTableData(updateDataFromGeoJson(geojsonData));
    //     };
    //     fetchData();
    // }, [geojsonData]);
    
    

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth={false}>
            <DialogTitle style={{ textAlign: "center", fontWeight: "bold", fontSize: "x-large" }}>
                {"Table view of " + (item && item.date)}
            </DialogTitle>
            <DialogContent>
                {/* <img src="/table_sample.jpg" alt="Place holder for Table Tab" style={{ maxWidth: "100%" }}/> */}
                <Grid container spacing={1} justifyContent="center" alignItems="center" style={{ marginTop: "20px" }}>
                    <Grid item>
                        <Button variant="contained" color="primary"  onClick={downloadCsvOnClick}>
                            Download CSV
                        </Button>
                    </Grid>
                    <Grid item>
                        <Button variant="contained" color="primary" onClick={onClose}>
                            Close
                        </Button>
                    </Grid>
                </Grid>
                <Grid container spacing={1} justifyContent="center" alignItems="center" style={{ marginTop: "20px" }}>
                <CSVDataTable data={csvData} />
                </Grid>

            </DialogContent>
        </Dialog>
    );
};

export default LoadTableModal;