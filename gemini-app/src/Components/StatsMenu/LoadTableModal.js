import { useState, useEffect, useMemo } from 'react';
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import Button from "@mui/material/Button";

// import { useTable } from 'react-table';

import { fetchData, useDataSetters, useDataState } from "../../DataContext.js";

import { geojsonToCSV, downloadCSV, tableBuilder } from "./GeojsonUtils.js";
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
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
        flaskUrl,
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
    const [aggregateMultiple, setAggregateMultiple] = useState(false);
    

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

    // Original implementation (preserved as comment):
    // useEffect(() => {
    //     //console.log("geojsonData", geojsonData);
    //     const csv = geojsonToCSV(geojsonData);
    //     //console.log("csv", csv);
    //     setCsvString(csv);
    // }, [geojsonData]);
    // Modified: Convert geojson -> CSV after normalizing keys (shorten model names, add platform and prediction_count)


    useEffect(() => {
        const buildCsvFromSingle = (gjson) => {
            const normalized = normalizeGeojsonProperties(gjson);
            return geojsonToCSV(normalized);
        };

        const fetchAndBuildMultiple = async () => {
            // fetch list of dates that have trait geojsons under the current selection
            try {
                const basePath = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`;
                const dates = await fetchData(`${flaskUrl}list_dirs/${basePath}`);
                const allGeojsons = [];
                for (const date of dates) {
                    // list platforms
                    const platforms = await fetchData(`${flaskUrl}list_dirs/${basePath}/${date}`);
                    for (const platform of platforms) {
                        const sensors = await fetchData(`${flaskUrl}list_dirs/${basePath}/${date}/${platform}`);
                        for (const sensor of sensors) {
                            // call backend get_orthomosaic_versions to find trait files including versions
                            try {
                                const resp = await fetch(`${flaskUrl}get_orthomosaic_versions`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ year: selectedYearGCP, experiment: selectedExperimentGCP, location: selectedLocationGCP, population: selectedPopulationGCP, date, platform, sensor })
                                });
                                if (resp.ok) {
                                    const versions = await resp.json();
                                    for (const v of versions) {
                                        if (v.path) {
                                            try {
                                                const g = await fetch(`${flaskUrl}${v.path}`).then(r => r.json());
                                                // attach source metadata so tableBuilder can add source_date/platform if needed
                                                g._source_meta = { date, platform };
                                                allGeojsons.push(g);
                                            } catch (e) {
                                                console.warn('Failed to fetch geojson at', `${flaskUrl}${v.path}`, e);
                                            }
                                        }
                                    }
                                }
                            } catch (e) {
                                console.warn('Error fetching versions for', date, platform, sensor, e);
                            }
                        }
                    }
                }

                if (allGeojsons.length > 0) {
                    const csv = tableBuilder(allGeojsons, { includePlatform: true, includeSourceDate: true });
                    setCsvString(csv);
                } else {
                    setCsvString("");
                }
            } catch (err) {
                console.error('Error fetching multiple geojsons:', err);
                setCsvString("");
            }
        };

        if (!geojsonData) {
            setCsvString("");
            return;
        }

        if (aggregateMultiple) {
            // fetch multiple geojsons based on current dataset selection and build table
            fetchAndBuildMultiple();
        } else {
            try {
                const csv = buildCsvFromSingle(geojsonData);
                setCsvString(csv);
            } catch (err) {
                console.error('Error normalizing/serializing geojson:', err);
                setCsvString("");
            }
        }
    }, [geojsonData, aggregateMultiple, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP, flaskUrl]);

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

    // Normalize GeoJSON properties to simplify column names and add platform & prediction_count
    // Example key: "kaziga-single-class-flowers-secuc/2/Flower"
    // -> platform: "kaziga" (first chunk before '-')
    // -> prediction_count: 2 (middle segment)
    // -> property key renamed to: "Flower"
    const normalizeGeojsonProperties = (data) => {
        if (!data || !data.features) return data;

        // Clone minimal structure to avoid mutating original
        const cloned = { ...data, features: data.features.map(f => ({ ...f, properties: { ...f.properties } })) };

        cloned.features.forEach((feature) => {
            const newProps = { ...feature.properties };

            Object.keys(feature.properties).forEach((origKey) => {
                if (origKey && origKey.includes('/')) {
                    const parts = origKey.split('/');
                    // parts example: ["kaziga-single-class-flowers-secuc", "2", "Flower"]
                    const modelPart = parts[0] || '';
                    const predCount = parts.length > 1 ? parts[1] : '';
                    const fieldName = parts.length > 2 ? parts.slice(2).join('/') : parts[parts.length - 1];

                    // platform: first token before '-'
                    const platform = modelPart.split('-')[0] || modelPart;

                    // set simplified field value
                    newProps[fieldName] = feature.properties[origKey];

                    // set platform and prediction_count fields (override if multiple keys; prefer first)
                    if (!newProps.platform) newProps.platform = platform;
                    if (!newProps.prediction_count) {
                        const n = parseInt(predCount, 10);
                        newProps.prediction_count = Number.isNaN(n) ? predCount : n;
                    }

                    // remove the original complex key if it's different
                    if (origKey !== fieldName) {
                        delete newProps[origKey];
                    }
                }
            });

            // prefer top-level source meta if present on the geojson
            const sourceMeta = data._source_meta || {};
            if (sourceMeta.date && !newProps.date) newProps.date = sourceMeta.date;
            if (sourceMeta.platform && !newProps.source_platform) newProps.source_platform = sourceMeta.platform;

            // ensure 'plot' field is present (look for common variants)
            if (newProps.plot === undefined) {
                if (newProps.Plot !== undefined) newProps.plot = newProps.Plot;
                else if (newProps.plot_number !== undefined) newProps.plot = newProps.plot_number;
                else if (newProps.PlotNumber !== undefined) newProps.plot = newProps.PlotNumber;
            }

            // unify flower columns into 'flower_count'
            const flowerKeys = Object.keys(newProps).filter(k => k.toLowerCase().includes('flower'));
            if (flowerKeys.length > 0) {
                // prefer closed_flower, then Flower, then first
                const chosen = flowerKeys.find(k => k.toLowerCase() === 'closed_flower') || flowerKeys.find(k => k === 'Flower') || flowerKeys[0];
                newProps['flower_count'] = newProps[chosen];
                flowerKeys.forEach(k => { if (k !== chosen) delete newProps[k]; });
                if (newProps['Flower'] && chosen !== 'Flower') delete newProps['Flower'];
            }

            // build unified model string and remove separate keys
            const platformVal = newProps.source_platform || newProps.platform || null;
            const predVal = newProps.prediction_count !== undefined ? String(newProps.prediction_count) : null;
            const versionVal = sourceMeta.versionName || newProps.versionName || null;
            const parts = [];
            if (platformVal) parts.push(platformVal);
            if (predVal) parts.push(predVal);
            if (versionVal && !parts.includes(versionVal)) parts.push(versionVal);
            if (parts.length > 0) newProps.model = parts.join('/');

            // cleanup separate keys that will be represented by model
            delete newProps.platform;
            delete newProps.source_platform;
            delete newProps.prediction_count;
            if (newProps.source_date && !newProps.date) newProps.date = newProps.source_date;
            delete newProps.source_date;

            // replace properties with normalized version
            feature.properties = newProps;
        });

        return cloned;
    }

    // Original parseCSV (preserved as comment):
    // const parseCSV = (csvText) => {
    //     console.log("parseCSV", csvText);
    //     const lines = csvText.split("\n");
    //     const headers = lines[0].split(",");
    //     const parsedData = [];
    //   
    //     for (let i = 1; i < lines.length; i++) {
    //       const currentLine = lines[i].split(",");
    //   
    //       if (currentLine.length === headers.length) {
    //         const row = {};
    //         for (let j = 0; j < headers.length; j++) {
    //           row[headers[j].trim()] = currentLine[j].trim();
    //         }
    //         parsedData.push(row);
    //       }
    //     }
    //   
    //     setCsvData(parsedData);
    // };

    const parseCSV = (csvText) => {
        if (!csvText || csvText.trim() === "") {
            setCsvData([]);
            return;
        }

        // naive CSV parser: split by lines and commas. If values can contain commas, consider using PapaParse.
        console.log("parseCSV", csvText ? csvText.slice(0, 200) : csvText);
        const lines = csvText.split("\n").filter(l => l.trim() !== "");
        if (lines.length === 0) {
            setCsvData([]);
            return;
        }

        const headers = lines[0].split(",").map(h => h.trim());
        const parsedData = [];

        for (let i = 1; i < lines.length; i++) {
            const currentLine = lines[i].split(",");
            if (currentLine.length === headers.length) {
                const row = {};
                for (let j = 0; j < headers.length; j++) {
                    row[headers[j]] = currentLine[j].trim();
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
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth={true}>
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
                <Grid item xs={12} style={{ textAlign: 'center', marginBottom: 8 }}>
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={aggregateMultiple}
                                onChange={(e) => setAggregateMultiple(e.target.checked)}
                            />
                        }
                        label="Aggregate multiple dates/platforms into one table"
                    />
                </Grid>
                <CSVDataTable data={csvData} />
                </Grid>

            </DialogContent>
        </Dialog>
    );
};

export default LoadTableModal;