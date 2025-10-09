import React, { useState, useEffect } from 'react';
import { Box, Grid, Typography, FormControl, InputLabel, Select, MenuItem, Button, CircularProgress } from '@mui/material';
import { fetchData, useDataState } from "../../DataContext.js";
import CSVDataTable from './CSVDataTable.js';
import { tableBuilder, downloadCSV } from './GeojsonUtils.js';

const TableBuilder = () => {
    const {
        flaskUrl,
        selectedYearGCP,
        selectedExperimentGCP,
        selectedLocationGCP,
        selectedPopulationGCP,
    } = useDataState();

    const [dateOptions, setDateOptions] = useState([]);
    const [selectedDates, setSelectedDates] = useState([]);

    const [platformOptions, setPlatformOptions] = useState([]);
    const [selectedPlatforms, setSelectedPlatforms] = useState([]);

    const [sensorOptions, setSensorOptions] = useState([]);
    const [selectedSensors, setSelectedSensors] = useState([]);

    const [modelOptions, setModelOptions] = useState([]);
    const [selectedModels, setSelectedModels] = useState([]);
    const [plotOptions, setPlotOptions] = useState([]);
    const [selectedPlots, setSelectedPlots] = useState([]);

    const [isBuilding, setIsBuilding] = useState(false);
    const [csvString, setCsvString] = useState("");
    const [csvData, setCsvData] = useState([]);

    // load dates under Processed
    useEffect(() => {
        const loadDates = async () => {
            if (!selectedYearGCP || !selectedExperimentGCP || !selectedLocationGCP || !selectedPopulationGCP) {
                setDateOptions([]);
                return;
            }
            try {
                const basePath = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`;
                const dates = await fetchData(`${flaskUrl}list_dirs/${basePath}`);
                setDateOptions(dates || []);
            } catch (e) {
                console.error('Error loading dates', e);
                setDateOptions([]);
            }
        };
        loadDates();
    }, [flaskUrl, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP]);

    // compute platform options based on selectedDates
    useEffect(() => {
        const loadPlatforms = async () => {
            const platformsSet = new Set();
            try {
                const base = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`;
                const dates = selectedDates.length > 0 ? selectedDates : dateOptions;
                for (const date of dates) {
                    const plats = await fetchData(`${flaskUrl}list_dirs/${base}/${date}`);
                    (plats || []).forEach(p => platformsSet.add(p));
                }
            } catch (e) {
                console.warn('Error loading platforms', e);
            }
            setPlatformOptions(Array.from(platformsSet));
        };
        if (selectedYearGCP) loadPlatforms();
    }, [selectedDates, dateOptions, flaskUrl, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP]);

    // compute sensors based on dates & platforms
    useEffect(() => {
        const loadSensors = async () => {
            const sensorsSet = new Set();
            try {
                const base = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`;
                const dates = selectedDates.length > 0 ? selectedDates : dateOptions;
                const plats = selectedPlatforms.length > 0 ? selectedPlatforms : platformOptions;
                for (const date of dates) {
                    for (const platform of plats) {
                        const sensors = await fetchData(`${flaskUrl}list_dirs/${base}/${date}/${platform}`);
                        (sensors || []).forEach(s => sensorsSet.add(s));
                    }
                }
            } catch (e) {
                console.warn('Error loading sensors', e);
            }
            setSensorOptions(Array.from(sensorsSet));
        };
        if (selectedYearGCP) loadSensors();
    }, [selectedDates, selectedPlatforms, dateOptions, platformOptions, flaskUrl, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP]);

    // compute model options (versions) from get_orthomosaic_versions across combos
    useEffect(() => {
        const loadModels = async () => {
            const modelsSet = new Set();
            try {
                const base = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`;
                const dates = selectedDates.length > 0 ? selectedDates : dateOptions;
                const plats = selectedPlatforms.length > 0 ? selectedPlatforms : platformOptions;
                const sens = selectedSensors.length > 0 ? selectedSensors : sensorOptions;
                for (const date of dates) {
                    for (const platform of plats) {
                        for (const sensor of sens) {
                            try {
                                const resp = await fetch(`${flaskUrl}get_orthomosaic_versions`, {
                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ year: selectedYearGCP, experiment: selectedExperimentGCP, location: selectedLocationGCP, population: selectedPopulationGCP, date, platform, sensor })
                                });
                                if (resp.ok) {
                                    const versions = await resp.json();
                                    (versions || []).forEach(v => { if (v.versionName) modelsSet.add(v.versionName); });
                                }
                            } catch (e) { /* ignore per-sensor errors */ }
                        }
                    }
                }
            } catch (e) {
                console.warn('Error loading models', e);
            }
            setModelOptions(Array.from(modelsSet));
            // discover plot IDs (sample) for UI
            (async () => {
                try {
                    const plotSet = new Set();
                    const base = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`;
                    const dates = selectedDates.length > 0 ? selectedDates : dateOptions;
                    const plats = selectedPlatforms.length > 0 ? selectedPlatforms : platformOptions;
                    const sens = selectedSensors.length > 0 ? selectedSensors : sensorOptions;
                    for (const date of dates) {
                        for (const platform of plats) {
                            for (const sensor of sens) {
                                try {
                                    const resp = await fetch(`${flaskUrl}get_orthomosaic_versions`, {
                                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ year: selectedYearGCP, experiment: selectedExperimentGCP, location: selectedLocationGCP, population: selectedPopulationGCP, date, platform, sensor })
                                    });
                                    if (!resp.ok) continue;
                                    const versions = await resp.json();
                                    if (versions && versions.length > 0 && versions[0].path) {
                                        try {
                                            const g = await fetch(`${flaskUrl}${versions[0].path}`).then(r => r.json());
                                            if (g && g.features) {
                                                g.features.forEach(f => {
                                                    if (f.properties) {
                                                        if (f.properties.Plot !== undefined) plotSet.add(String(f.properties.Plot));
                                                        if (f.properties.plot !== undefined) plotSet.add(String(f.properties.plot));
                                                    }
                                                });
                                            }
                                        } catch (e) { /* ignore */ }
                                    }
                                } catch (e) { /* ignore */ }
                            }
                        }
                    }
                    setPlotOptions(Array.from(plotSet).sort((a,b)=> a.localeCompare(b, undefined, {numeric: true})));
                } catch (e) { console.warn('plot discovery failed', e); }
            })();
        };
        if (selectedYearGCP) loadModels();
    }, [selectedDates, selectedPlatforms, selectedSensors, dateOptions, platformOptions, sensorOptions, flaskUrl, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP]);

    // Dedicated plot discovery: scan all versions for plot IDs (more exhaustive)
    useEffect(() => {
        const discoverPlotsExhaustive = async () => {
            if (!selectedYearGCP) {
                setPlotOptions([]);
                return;
            }
            try {
                const plotSet = new Set();
                const base = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`;
                const dates = selectedDates.length > 0 ? selectedDates : dateOptions;
                const plats = selectedPlatforms.length > 0 ? selectedPlatforms : platformOptions;
                const sens = selectedSensors.length > 0 ? selectedSensors : sensorOptions;

                for (const date of dates) {
                    for (const platform of plats) {
                        for (const sensor of sens) {
                            try {
                                const resp = await fetch(`${flaskUrl}get_orthomosaic_versions`, {
                                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ year: selectedYearGCP, experiment: selectedExperimentGCP, location: selectedLocationGCP, population: selectedPopulationGCP, date, platform, sensor })
                                });
                                if (!resp.ok) continue;
                                const versions = await resp.json();
                                for (const v of (versions || [])) {
                                    if (!v.path) continue;
                                    try {
                                        const g = await fetch(`${flaskUrl}${v.path}`).then(r => r.json());
                                        if (g && g.features) {
                                            g.features.forEach(f => {
                                                if (!f || !f.properties) return;
                                                if (f.properties.plot !== undefined) plotSet.add(String(f.properties.plot));
                                                if (f.properties.Plot !== undefined) plotSet.add(String(f.properties.Plot));
                                                if (f.properties.plot_number !== undefined) plotSet.add(String(f.properties.plot_number));
                                            });
                                        }
                                    } catch (e) { /* ignore fetch errors */ }
                                }
                            } catch (e) { /* ignore per-sensor errors */ }
                        }
                    }
                }

                setPlotOptions(Array.from(plotSet).sort((a,b)=> a.localeCompare(b, undefined, {numeric: true})));
            } catch (e) {
                console.warn('exhaustive plot discovery failed', e);
            }
        };

        // only run when we have date/platform/sensor options loaded
        discoverPlotsExhaustive();
    }, [dateOptions, platformOptions, sensorOptions, selectedDates, selectedPlatforms, selectedSensors, flaskUrl, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP]);

    const buildTable = async () => {
        setIsBuilding(true);
        try {
            const base = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`;
            const dates = selectedDates.length > 0 ? selectedDates : dateOptions;
            const plats = selectedPlatforms.length > 0 ? selectedPlatforms : platformOptions;
            const sens = selectedSensors.length > 0 ? selectedSensors : sensorOptions;

            const allGeojsons = [];

            for (const date of dates) {
                for (const platform of (plats.length ? plats : await fetchData(`${flaskUrl}list_dirs/${base}/${date}`))) {
                    const sensors = sens.length ? sens : await fetchData(`${flaskUrl}list_dirs/${base}/${date}/${platform}`) || [];
                    for (const sensor of sensors) {
                        // fetch versions
                        try {
                            const resp = await fetch(`${flaskUrl}get_orthomosaic_versions`, {
                                method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ year: selectedYearGCP, experiment: selectedExperimentGCP, location: selectedLocationGCP, population: selectedPopulationGCP, date, platform, sensor })
                            });
                            if (!resp.ok) continue;
                            const versions = await resp.json();
                            for (const v of versions) {
                                // filter by selectedModels if provided
                                if (selectedModels.length > 0 && !selectedModels.includes(v.versionName)) continue;
                                if (v.path) {
                                    try {
                                        const g = await fetch(`${flaskUrl}${v.path}`).then(r => r.json());
                                        // if user selected plots, filter features by plot id first
                                        let features = (g && g.features) ? g.features : [];
                                        if (selectedPlots.length > 0) {
                                            features = features.filter(f => {
                                                if (!f || !f.properties) return false;
                                                const val = f.properties.Plot ?? f.properties.plot ?? f.properties.plot_number ?? f.properties.PlotNumber;
                                                return val !== undefined && selectedPlots.includes(String(val));
                                            });
                                        }
                                        if (features.length > 0) {
                                            g.features = features;
                                            g._source_meta = { date, platform, sensor, versionName: v.versionName };
                                            allGeojsons.push(g);
                                        }
                                    } catch (e) { console.warn('Failed to fetch geojson', v.path, e); }
                                }
                            }
                        } catch (e) {
                            console.warn('versions fetch error', e);
                        }
                    }
                }
            }

            if (allGeojsons.length === 0) {
                setCsvString("");
                setCsvData([]);
            } else {
                const csv = tableBuilder(allGeojsons, { includePlatform: true, includeSourceDate: true });
                setCsvString(csv);
                // parse CSV into rows for display
                const lines = csv.split('\n').filter(l => l.trim() !== '');
                const headers = lines[0].split(',').map(h => h.trim());
                const rows = [];
                for (let i = 1; i < lines.length; i++) {
                    const cols = lines[i].split(',');
                    if (cols.length !== headers.length) continue;
                    const row = {};
                    for (let j = 0; j < headers.length; j++) row[headers[j]] = cols[j].trim();
                    rows.push(row);
                }
                setCsvData(rows);
            }
        } catch (err) {
            console.error('Error building table', err);
        } finally {
            setIsBuilding(false);
        }
    };

    const download = () => {
        const name = `table_${selectedDates.join('-') || 'all'}.csv`;
        downloadCSV(csvString, name);
    };

    return (
        <Box sx={{ width: '100%' }}>
            <Typography variant="h5" align="center" gutterBottom>Table Builder</Typography>
            <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} sm={6} md={3} sx={{ flexBasis: { xs: '100%', sm: '50%', md: '20%' } }}>
                    <FormControl fullWidth>
                        <InputLabel id="dates-label">Dates</InputLabel>
                        <Select
                            labelId="dates-label"
                            multiple
                            value={selectedDates}
                            onChange={(e) => setSelectedDates(e.target.value)}
                            renderValue={(selected) => selected.join(', ')}
                        >
                            {dateOptions.map(d => <MenuItem key={d} value={d}>{d}</MenuItem>)}
                        </Select>
                    </FormControl>
                </Grid>
                <Grid item xs={12} sm={6} md={3} sx={{ flexBasis: { xs: '100%', sm: '50%', md: '20%' } }}>
                    <FormControl fullWidth>
                        <InputLabel id="platforms-label">Platforms</InputLabel>
                        <Select multiple value={selectedPlatforms} onChange={(e)=> setSelectedPlatforms(e.target.value)} renderValue={(v)=>v.join(', ')}>
                            {platformOptions.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                        </Select>
                    </FormControl>
                </Grid>
                <Grid item xs={12} sm={6} md={3} sx={{ flexBasis: { xs: '100%', sm: '50%', md: '20%' } }}>
                    <FormControl fullWidth>
                        <InputLabel id="sensors-label">Sensors</InputLabel>
                        <Select multiple value={selectedSensors} onChange={(e)=> setSelectedSensors(e.target.value)} renderValue={(v)=>v.join(', ')}>
                            {sensorOptions.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                        </Select>
                    </FormControl>
                </Grid>
                <Grid item xs={12} sm={6} md={3} sx={{ flexBasis: { xs: '100%', sm: '50%', md: '20%' } }}>
                    <FormControl fullWidth>
                        <InputLabel id="models-label">Models / Versions</InputLabel>
                        <Select multiple value={selectedModels} onChange={(e)=> setSelectedModels(e.target.value)} renderValue={(v)=>v.join(', ')}>
                            {modelOptions.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                        </Select>
                    </FormControl>
                </Grid>
                <Grid item xs={12} sm={6} md={3} sx={{ flexBasis: { xs: '100%', sm: '50%', md: '20%' } }}>
                    <FormControl fullWidth>
                        <InputLabel id="plots-label">Plots</InputLabel>
                        <Select multiple value={selectedPlots} onChange={(e)=> setSelectedPlots(e.target.value)} renderValue={(v)=>v.join(', ')}>
                            {plotOptions.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                        </Select>
                    </FormControl>
                </Grid>

                <Grid item xs={12} sx={{ textAlign: 'center' }}>
                    <Button variant="contained" color="primary" onClick={buildTable} disabled={isBuilding} startIcon={isBuilding ? <CircularProgress size={18}/> : null}>
                        {isBuilding ? 'Building...' : 'Build Table'}
                    </Button>
                    {csvString && (
                        <Button variant="outlined" sx={{ ml: 2 }} onClick={download}>Download CSV</Button>
                    )}
                </Grid>
            </Grid>

            {csvData && csvData.length > 0 && (
                <Box>
                    <CSVDataTable data={csvData} />
                </Box>
            )}
        </Box>
    );
};

export default TableBuilder;
