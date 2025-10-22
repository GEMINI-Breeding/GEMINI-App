import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Box, Grid, FormControl, InputLabel, Select, MenuItem, Button, CircularProgress } from '@mui/material';
import { fetchData, useDataState } from "../../DataContext.js";
import CSVDataTable from './CSVDataTable.js';
import { tableBuilder, downloadCSV } from './GeojsonUtils.js';
import InferenceResultsPreview from '../Menu/InferenceResultsPreview.js';

const cleanKeyPart = (value) => {
    if (value === undefined || value === null) return '';
    const str = String(value).trim();
    return str;
};

const extractFolderFromPath = (path) => {
    if (!path) return null;
    const normalized = String(path).replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    if (segments.length === 0) return null;
    if (segments.length === 1) return segments[0];
    return segments[segments.length - 2] || segments[segments.length - 1];
};

const extractVersionCandidates = (info = {}) => {
    const candidates = new Set();
    const sourceMeta = info.sourceMeta || {};
    const addCandidate = (value) => {
        const str = cleanKeyPart(value);
        if (str) candidates.add(str);
    };

    addCandidate(info.versionName);
    addCandidate(info.version);
    addCandidate(info.versionType);
    addCandidate(info.version_type);
    addCandidate(info.orthomosaic);
    addCandidate(info.agrowstitch_version);
    addCandidate(info.modelVersion);
    addCandidate(info.model_version);
    addCandidate(sourceMeta.versionName);
    addCandidate(sourceMeta.version);
    addCandidate(sourceMeta.orthomosaic);
    addCandidate(sourceMeta.agrowstitch_version);

    if (info.path) addCandidate(extractFolderFromPath(info.path));
    if (info.csv_path) addCandidate(extractFolderFromPath(info.csv_path));
    if (info.result_path) addCandidate(extractFolderFromPath(info.result_path));
    if (sourceMeta.path) addCandidate(extractFolderFromPath(sourceMeta.path));

    if (info.plot_images_available || sourceMeta.plot_images_available) {
        addCandidate('Plot_Images');
    }

    return Array.from(candidates);
};

const buildComboKeys = (info = {}) => {
    const sourceMeta = info.sourceMeta || {};
    const date = info.date ?? sourceMeta.date;
    const platform = info.platform ?? sourceMeta.platform;
    const sensor = info.sensor ?? sourceMeta.sensor;

    const baseParts = [
        cleanKeyPart(date),
        cleanKeyPart(platform),
        cleanKeyPart(sensor),
    ];

    const versions = extractVersionCandidates(info);
    if (versions.length === 0) {
        return [baseParts.concat('').join('|')];
    }

    return versions.map((version) => baseParts.concat(cleanKeyPart(version)).join('|'));
};

const dedupeInferenceEntries = (entries = []) => {
    const seen = new Set();
    const result = [];
    entries.forEach((entry) => {
        if (!entry) return;
        const key = [
            cleanKeyPart(entry.model_id ?? entry.modelId),
            cleanKeyPart(entry.model_version ?? entry.modelVersion),
            cleanKeyPart(entry.orthomosaic ?? entry.agrowstitch_version ?? entry.versionName ?? entry.version),
            cleanKeyPart(entry.csv_path ?? entry.path ?? ''),
        ].join('|');
        if (seen.has(key)) return;
        seen.add(key);
        result.push(entry);
    });
    return result;
};

const extractPlotNumber = (value) => {
    if (value === null || value === undefined) return null;
    const match = String(value).match(/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
};

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
    const [accessionOptions, setAccessionOptions] = useState([]);
    const [selectedAccessions, setSelectedAccessions] = useState([]);

    const [isBuilding, setIsBuilding] = useState(false);
    const [csvString, setCsvString] = useState("");
    const [csvData, setCsvData] = useState([]);
    const [isLoadingAccessions, setIsLoadingAccessions] = useState(false);
    const [accessionsLoaded, setAccessionsLoaded] = useState(false);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const [previewData, setPreviewData] = useState(null);

    const versionsCacheRef = useRef(new Map());
    const geojsonCacheRef = useRef(new Map());

    const resetAccessions = useCallback(() => {
        setSelectedAccessions([]);
        setAccessionOptions([]);
        setAccessionsLoaded(false);
        setIsLoadingAccessions(false);
    }, []);

    const extractAccession = (properties = {}) => {
        const raw =
            properties.accession ??
            properties.Accession ??
            properties.label ??
            properties.Label ??
            properties.Label_ID ??
            properties.LabelId ??
            properties.LabelID ??
            properties.accession_id ??
            properties.Accession_ID;
        if (raw === undefined || raw === null) return null;
        const value = String(raw).trim();
        return value === "" ? null : value;
    };

    useEffect(() => {
        versionsCacheRef.current.clear();
        geojsonCacheRef.current.clear();
        resetAccessions();
    }, [flaskUrl, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP, resetAccessions]);

    const resolvedSelections = useMemo(() => {
        const resolvedDates = (selectedDates.length > 0 ? selectedDates : dateOptions).filter(Boolean);
        const resolvedPlatforms = (selectedPlatforms.length > 0 ? selectedPlatforms : platformOptions).filter(Boolean);
        const resolvedSensors = (selectedSensors.length > 0 ? selectedSensors : sensorOptions).filter(Boolean);
        return {
            dates: resolvedDates,
            platforms: resolvedPlatforms,
            sensors: resolvedSensors,
        };
    }, [selectedDates, dateOptions, selectedPlatforms, platformOptions, selectedSensors, sensorOptions]);

    const selectionCombos = useMemo(() => {
        const combos = [];
        for (const date of resolvedSelections.dates) {
            for (const platform of resolvedSelections.platforms) {
                for (const sensor of resolvedSelections.sensors) {
                    combos.push({ date, platform, sensor });
                }
            }
        }
        return combos;
    }, [resolvedSelections]);

    const combosKey = useMemo(() => {
        if (selectionCombos.length === 0) return '';
        const keyParts = selectionCombos.map(({ date, platform, sensor }) => `${date}|${platform}|${sensor}`);
        keyParts.sort();
        return keyParts.join(';');
    }, [selectionCombos]);

    const combosKeyRef = useRef(combosKey);
    useEffect(() => {
        combosKeyRef.current = combosKey;
    }, [combosKey]);

    useEffect(() => {
        resetAccessions();
    }, [combosKey, resetAccessions]);

    const fetchVersionsForCombo = useCallback(async (date, platform, sensor) => {
        if (!date || !platform || !sensor) return [];
        if (!selectedYearGCP || !selectedExperimentGCP || !selectedLocationGCP || !selectedPopulationGCP) return [];
        const cacheKey = `${date}|${platform}|${sensor}`;
        const cached = versionsCacheRef.current.get(cacheKey);
        if (cached) {
            return cached;
        }
        const fetchPromise = (async () => {
            try {
                const resp = await fetch(`${flaskUrl}get_orthomosaic_versions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        year: selectedYearGCP,
                        experiment: selectedExperimentGCP,
                        location: selectedLocationGCP,
                        population: selectedPopulationGCP,
                        date,
                        platform,
                        sensor,
                    }),
                });
                if (!resp.ok) return [];
                const data = await resp.json();
                return data || [];
            } catch (err) {
                console.warn('versions fetch error', err);
                return [];
            }
        })();
        versionsCacheRef.current.set(cacheKey, fetchPromise);
        const result = await fetchPromise;
        versionsCacheRef.current.set(cacheKey, result);
        return result;
    }, [flaskUrl, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP]);

    const fetchGeojsonData = useCallback(async (path) => {
        if (!path) return null;
        const url = path.startsWith('http') ? path : `${flaskUrl}${path}`;
        const cached = geojsonCacheRef.current.get(url);
        if (cached) {
            return cached;
        }

        const fetchPromise = (async () => {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch geojson ${url}`);
            }
            return await response.json();
        })();

        geojsonCacheRef.current.set(url, fetchPromise);
        try {
            const data = await fetchPromise;
            geojsonCacheRef.current.set(url, data);
            return data;
        } catch (err) {
            geojsonCacheRef.current.delete(url);
            throw err;
        }
    }, [flaskUrl]);

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
            if (!selectedYearGCP || !selectedExperimentGCP || !selectedLocationGCP || !selectedPopulationGCP) {
                setPlatformOptions([]);
                return;
            }
            const dates = resolvedSelections.dates;
            if (dates.length === 0) {
                setPlatformOptions([]);
                return;
            }
            try {
                const base = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`;
                const platformLists = await Promise.all(
                    dates.map(date =>
                        fetchData(`${flaskUrl}list_dirs/${base}/${date}`).catch(() => [])
                    )
                );
                const platformsSet = new Set();
                platformLists.forEach(list => (list || []).forEach(p => platformsSet.add(p)));
                setPlatformOptions(Array.from(platformsSet));
            } catch (e) {
                console.warn('Error loading platforms', e);
                setPlatformOptions([]);
            }
        };
        loadPlatforms();
    }, [flaskUrl, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP, resolvedSelections]);

    // compute sensors based on dates & platforms
    useEffect(() => {
        const loadSensors = async () => {
            if (!selectedYearGCP || !selectedExperimentGCP || !selectedLocationGCP || !selectedPopulationGCP) {
                setSensorOptions([]);
                return;
            }
            const { dates, platforms } = resolvedSelections;
            if (dates.length === 0 || platforms.length === 0) {
                setSensorOptions([]);
                return;
            }
            try {
                const base = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`;
                const sensorTasks = [];
                for (const date of dates) {
                    for (const platform of platforms) {
                        sensorTasks.push(
                            fetchData(`${flaskUrl}list_dirs/${base}/${date}/${platform}`).catch(() => [])
                        );
                    }
                }
                const sensorLists = await Promise.all(sensorTasks);
                const sensorsSet = new Set();
                sensorLists.forEach(list => (list || []).forEach(sensor => sensorsSet.add(sensor)));
                setSensorOptions(Array.from(sensorsSet));
            } catch (e) {
                console.warn('Error loading sensors', e);
                setSensorOptions([]);
            }
        };
        loadSensors();
    }, [flaskUrl, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP, resolvedSelections]);

    // compute model options (versions) from get_orthomosaic_versions across combos
    useEffect(() => {
        const loadModels = async () => {
            if (!selectedYearGCP || selectionCombos.length === 0) {
                setModelOptions([]);
                return;
            }
            try {
                const versionsByCombo = await Promise.all(
                    selectionCombos.map(({ date, platform, sensor }) =>
                        fetchVersionsForCombo(date, platform, sensor)
                    )
                );
                const modelsSet = new Set();
                versionsByCombo.forEach(versions => {
                    (versions || []).forEach(v => {
                        if (v && v.versionName) {
                            modelsSet.add(v.versionName);
                        }
                    });
                });
                setModelOptions(Array.from(modelsSet));
            } catch (e) {
                console.warn('Error loading models', e);
                setModelOptions([]);
            }
        };
        loadModels();
    }, [selectedYearGCP, selectionCombos, fetchVersionsForCombo]);

    const ensureAccessionsLoaded = useCallback(async () => {
        if (accessionsLoaded || isLoadingAccessions) return;
        if (selectionCombos.length === 0) {
            setAccessionOptions([]);
            setAccessionsLoaded(true);
            return;
        }
        const currentKey = combosKey;
        setIsLoadingAccessions(true);
        try {
            const accessionSet = new Set();
            const versionsByCombo = await Promise.all(
                selectionCombos.map(({ date, platform, sensor }) =>
                    fetchVersionsForCombo(date, platform, sensor)
                )
            );
            const geojsonTasks = [];
            versionsByCombo.forEach((versions) => {
                (versions || []).forEach((v) => {
                    if (!v || !v.path) return;
                    geojsonTasks.push(
                        fetchGeojsonData(v.path)
                            .then((geo) => {
                                if (!geo || !geo.features) return;
                                geo.features.forEach((feature) => {
                                    if (!feature || !feature.properties) return;
                                    const accessionValue = extractAccession(feature.properties);
                                    if (accessionValue !== null) accessionSet.add(accessionValue);
                                });
                            })
                            .catch(() => {
                                /* ignore per-geojson errors */
                            })
                    );
                });
            });
            await Promise.all(geojsonTasks);
            const sorted = Array.from(accessionSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
            if (combosKeyRef.current !== currentKey) {
                return;
            }
            setAccessionOptions(sorted);
            setAccessionsLoaded(true);
        } catch (e) {
            console.warn('accession discovery failed', e);
        } finally {
            setIsLoadingAccessions(false);
        }
    }, [accessionsLoaded, isLoadingAccessions, selectionCombos, fetchVersionsForCombo, fetchGeojsonData, combosKey]);

    const buildTable = async () => {
        setIsBuilding(true);
        try {
            if (selectionCombos.length === 0) {
                setCsvString("");
                setCsvData([]);
                return;
            }

            const accessionFilter = selectedAccessions.length > 0 ? new Set(selectedAccessions) : null;
            const versionResults = await Promise.all(
                selectionCombos.map(async ({ date, platform, sensor }) => {
                    const versions = await fetchVersionsForCombo(date, platform, sensor);
                    if (!versions || versions.length === 0) return [];

                    const filteredVersions = selectedModels.length > 0
                        ? versions.filter(v => v && selectedModels.includes(v.versionName))
                        : versions;
                    if (filteredVersions.length === 0) return [];

                    const geojsons = await Promise.all(
                        filteredVersions.map(async (v) => {
                            if (!v || !v.path) return null;
                            try {
                                const raw = await fetchGeojsonData(v.path);
                                if (!raw || !raw.features) return null;

                                let features = raw.features;
                                if (accessionFilter) {
                                    features = features.filter(f => {
                                        if (!f || !f.properties) return false;
                                        const accessionValue = extractAccession(f.properties);
                                        return accessionValue !== null && accessionFilter.has(accessionValue);
                                    });
                                    if (features.length === 0) return null;
                                }

                                const versionMeta = {
                                    date,
                                    platform,
                                    sensor,
                                    versionName: v.versionName,
                                    versionType: v.versionType,
                                    version: v.version,
                                    orthomosaic: v.orthomosaic,
                                    agrowstitch_version: v.agrowstitch_version,
                                    path: v.path,
                                    modelId: v.modelId ?? v.model_id,
                                    modelVersion: v.modelVersion ?? v.model_version,
                                };
                                return {
                                    ...raw,
                                    features,
                                    _source_meta: versionMeta,
                                };
                            } catch (e) {
                                console.warn('Failed to fetch geojson', v?.path, e);
                                return null;
                            }
                        })
                    );

                    return geojsons.filter(Boolean);
                })
            );

            const allGeojsons = versionResults.flat();
            if (allGeojsons.length === 0) {
                setCsvString("");
                setCsvData([]);
                return;
            }

            // Build lookup of inference results to support plot visualization actions
            let inferenceMap = new Map();
            try {
                const inferenceResponse = await fetch(`${flaskUrl}get_inference_results`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        year: selectedYearGCP,
                        experiment: selectedExperimentGCP,
                        location: selectedLocationGCP,
                        population: selectedPopulationGCP,
                    }),
                });
                if (inferenceResponse.ok) {
                    const inferencePayload = await inferenceResponse.json();
                    const results = inferencePayload.results || [];
                    const map = new Map();
                    results.forEach((entry) => {
                        const keys = buildComboKeys(entry);
                        keys.forEach((key) => {
                            if (!key) return;
                            if (!map.has(key)) map.set(key, []);
                            map.get(key).push(entry);
                        });
                    });
                    inferenceMap = map;
                }
            } catch (inferenceError) {
                console.warn('Failed to fetch inference results for visualization', inferenceError);
            }

            const tableResult = tableBuilder(allGeojsons, { includePlatform: true, includeSourceDate: true, returnDetails: true });
            const csv = typeof tableResult === 'string' ? tableResult : tableResult.csv;
            if (!csv) {
                setCsvString("");
                setCsvData([]);
                return;
            }

            setCsvString(csv);

            if (typeof tableResult === 'string') {
                const lines = csv.split('\n').filter(l => l.trim() !== '');
                if (lines.length === 0) {
                    setCsvData([]);
                    return;
                }
                const headers = lines[0].split(',').map(h => h.trim());
                const rows = [];
                for (let i = 1; i < lines.length; i++) {
                    const cols = lines[i].split(',');
                    if (cols.length !== headers.length) continue;
                    const row = {};
                    for (let j = 0; j < headers.length; j++) {
                        row[headers[j]] = cols[j].trim();
                    }
                    rows.push(row);
                }
                setCsvData(rows);
                return;
            }

            const baseRows = tableResult.rows || [];
            const featureMetas = tableResult.featureMetas || [];
            if (baseRows.length === 0) {
                setCsvData([]);
                return;
            }

            const rowsWithVisualize = baseRows.map((row, idx) => {
                const featureMeta = featureMetas[idx] || {};
                const sourceMeta = featureMeta.sourceMeta || {};
                const originalProps = featureMeta.originalProps || {};

                const combinedInfo = {
                    sourceMeta,
                    date: row.date || sourceMeta.date,
                    platform: sourceMeta.platform || row.platform || row.source_platform,
                    sensor: sourceMeta.sensor || row.sensor,
                    versionName: row.versionName || sourceMeta.versionName,
                    version: sourceMeta.version,
                    versionType: sourceMeta.versionType,
                    orthomosaic: sourceMeta.orthomosaic,
                    agrowstitch_version: sourceMeta.agrowstitch_version,
                    path: sourceMeta.path,
                    modelVersion: sourceMeta.modelVersion,
                };

                if (!combinedInfo.versionName && combinedInfo.orthomosaic) {
                    combinedInfo.versionName = combinedInfo.orthomosaic;
                }
                if (!combinedInfo.versionName && combinedInfo.agrowstitch_version) {
                    combinedInfo.versionName = combinedInfo.agrowstitch_version;
                }
                if (!combinedInfo.versionName && row.model) {
                    const parts = String(row.model).split('/').filter(Boolean);
                    if (parts.length > 0) {
                        combinedInfo.versionName = parts[parts.length - 1];
                    }
                }
                if (!combinedInfo.platform && row.model) {
                    const parts = String(row.model).split('/').filter(Boolean);
                    if (parts.length > 0) {
                        combinedInfo.platform = combinedInfo.platform || parts[0];
                    }
                }

                const sourcesOrdered = [row, originalProps, sourceMeta];
                const pickFirstString = (keys) => {
                    for (const src of sourcesOrdered) {
                        if (!src) continue;
                        for (const key of keys) {
                            const value = src[key];
                            if (value !== undefined && value !== null) {
                                const str = String(value).trim();
                                if (str !== '') return str;
                            }
                        }
                    }
                    return null;
                };

                const extractPlotNumber = (value) => {
                    if (!value) return null;
                    const match = String(value).match(/(\d+)/);
                    return match ? parseInt(match[1], 10) : null;
                };

                const plotHint = pickFirstString(['plot', 'Plot', 'plot_id', 'Plot_ID', 'PlotId', 'plotId', 'PlotNumber', 'plot_number', 'Plot_No', 'plotNo', 'PlotLabel', 'plotLabel', 'PlotID', 'Plot_Name', 'plotName', 'PlotName', 'Plot_Index', 'plot_index']);
                const accessionHint = pickFirstString(['accession', 'Accession', 'accession_id', 'Accession_ID', 'label', 'Label', 'genotype', 'Genotype', 'entry', 'Entry']);
                const populationHint = pickFirstString(['population', 'Population', 'population_name', 'PopulationName', 'population_code', 'PopulationCode', 'population_id', 'Population_ID']);
                const blockHint = pickFirstString(['block', 'Block', 'range', 'Range']);
                const imageHint = pickFirstString(['plot_image', 'Plot_Image', 'image_name', 'Image_Name', 'imageName', 'plotImage']);

                const modelTokens = [];
                const tokenSources = [combinedInfo, row, originalProps, sourceMeta];
                const tokenKeys = ['versionName', 'version', 'orthomosaic', 'agrowstitch_version', 'model', 'modelVersion', 'model_id', 'modelId', 'model_version', 'modelVersion', 'Csv', 'csv_path'];
                tokenSources.forEach((src) => {
                    if (!src) return;
                    tokenKeys.forEach((key) => {
                        if (src[key] !== undefined && src[key] !== null) {
                            const token = String(src[key]).trim();
                            if (token) modelTokens.push(token);
                        }
                    });
                });

                const comboKeys = buildComboKeys(combinedInfo);
                const matches = [];
                comboKeys.forEach((key) => {
                    const entries = inferenceMap.get(key);
                    if (entries) matches.push(...entries);
                });
                const dedupedMatches = dedupeInferenceEntries(matches);

                const rowContext = {
                    plotHint,
                    plotNumber: extractPlotNumber(plotHint),
                    accession: accessionHint,
                    population: populationHint,
                    block: blockHint,
                    imageName: imageHint,
                    properties: row,
                    originalProps,
                };

                return {
                    ...row,
                    visualizePlot: dedupedMatches.length > 0 ? 'Available' : '',
                    __visualizeMeta: {
                        sourceMeta: combinedInfo,
                        inferenceEntries: dedupedMatches,
                        comboKeys,
                        plotHint,
                        modelTokens,
                        rowContext,
                    },
                };
            });

            setCsvData(rowsWithVisualize);
        } catch (err) {
            console.error('Error building table', err);
        } finally {
            setIsBuilding(false);
        }
    };

    const handleDatesChange = useCallback((event) => {
        setSelectedDates(event.target.value);
    }, []);

    const handlePlatformsChange = useCallback((event) => {
        setSelectedPlatforms(event.target.value);
    }, []);

    const handleSensorsChange = useCallback((event) => {
        setSelectedSensors(event.target.value);
    }, []);

    const handleModelsChange = useCallback((event) => {
        setSelectedModels(event.target.value);
    }, []);

    const handleAccessionsChange = useCallback((event) => {
        setSelectedAccessions(event.target.value);
    }, []);

    const handleAccessionsOpen = useCallback(() => {
        ensureAccessionsLoaded();
    }, [ensureAccessionsLoaded]);

    const handleVisualizePlot = useCallback((row) => {
        if (!row || !row.__visualizeMeta) return;
        const meta = row.__visualizeMeta;
        const entries = Array.isArray(meta.inferenceEntries) ? meta.inferenceEntries : [];
        if (entries.length === 0) {
            return;
        }
        const modelTokens = (meta.modelTokens || []).map(t => String(t).toLowerCase()).filter(Boolean);
        const selectEntryByPredicate = (predicate) => entries.find((candidate) => {
            try {
                return predicate(candidate);
            } catch (e) {
                return false;
            }
        });

        const entryByModelVersion = modelTokens.length > 0 ? selectEntryByPredicate((candidate) => {
            const version = (candidate.model_version || candidate.modelVersion || '').toString().toLowerCase();
            const id = (candidate.model_id || candidate.modelId || '').toString().toLowerCase();
            const name = (candidate.model_name || '').toString().toLowerCase();
            return modelTokens.some(token => (version && (token.includes(version) || version.includes(token))) || (id && (token.includes(id) || id.includes(token))) || (name && (token.includes(name) || name.includes(token))));
        }) : null;

        const entryByOrthomosaic = modelTokens.length > 0 ? selectEntryByPredicate((candidate) => {
            const ortho = (candidate.orthomosaic || candidate.agrowstitch_version || candidate.versionName || '').toString().toLowerCase();
            if (!ortho) return false;
            return modelTokens.some(token => token.includes(ortho) || ortho.includes(token));
        }) : null;

        const selectedEntry = entryByModelVersion || entryByOrthomosaic || entries[0];
        const rowContext = meta.rowContext || {};
        const plotHintValue = meta.plotHint || rowContext.plotHint || null;
        setPreviewData({
            date: selectedEntry.date || meta.sourceMeta?.date,
            platform: selectedEntry.platform || meta.sourceMeta?.platform,
            sensor: selectedEntry.sensor || meta.sourceMeta?.sensor,
            agrowstitch_version: selectedEntry.orthomosaic || selectedEntry.agrowstitch_version || meta.sourceMeta?.versionName,
            orthomosaic: selectedEntry.orthomosaic,
            model_id: selectedEntry.model_id ?? selectedEntry.modelId,
            model_version: selectedEntry.model_version ?? selectedEntry.modelVersion,
            model_task: selectedEntry.model_task || 'detection',
            plot_hint: plotHintValue,
            row_context: rowContext,
        });
        setIsPreviewOpen(true);
    }, []);

    const handleClosePreview = useCallback(() => {
        setIsPreviewOpen(false);
        setPreviewData(null);
    }, []);

    const download = () => {
        const name = `table_${selectedDates.join('-') || 'all'}.csv`;
        downloadCSV(csvString, name);
    };

    return (
        <>
            <Box sx={{ width: '100%' }}>
            <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} sm={6} md={3} sx={{ flexBasis: { xs: '100%', sm: '50%', md: '20%' } }}>
                    <FormControl fullWidth>
                        <InputLabel id="dates-label">Dates</InputLabel>
                        <Select
                            labelId="dates-label"
                            multiple
                            value={selectedDates}
                            onChange={handleDatesChange}
                            renderValue={(selected) => selected.join(', ')}
                        >
                            {dateOptions.map(d => <MenuItem key={d} value={d}>{d}</MenuItem>)}
                        </Select>
                    </FormControl>
                </Grid>
                <Grid item xs={12} sm={6} md={3} sx={{ flexBasis: { xs: '100%', sm: '50%', md: '20%' } }}>
                    <FormControl fullWidth>
                        <InputLabel id="platforms-label">Platforms</InputLabel>
                        <Select multiple value={selectedPlatforms} onChange={handlePlatformsChange} renderValue={(v)=>v.join(', ')}>
                            {platformOptions.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                        </Select>
                    </FormControl>
                </Grid>
                <Grid item xs={12} sm={6} md={3} sx={{ flexBasis: { xs: '100%', sm: '50%', md: '20%' } }}>
                    <FormControl fullWidth>
                        <InputLabel id="sensors-label">Sensors</InputLabel>
                        <Select multiple value={selectedSensors} onChange={handleSensorsChange} renderValue={(v)=>v.join(', ')}>
                            {sensorOptions.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                        </Select>
                    </FormControl>
                </Grid>
                <Grid item xs={12} sm={6} md={3} sx={{ flexBasis: { xs: '100%', sm: '50%', md: '20%' } }}>
                    <FormControl fullWidth>
                        <InputLabel id="models-label">Models / Versions</InputLabel>
                        <Select multiple value={selectedModels} onChange={handleModelsChange} renderValue={(v)=>v.join(', ')}>
                            {modelOptions.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
                        </Select>
                    </FormControl>
                </Grid>
                <Grid item xs={12} sm={6} md={3} sx={{ flexBasis: { xs: '100%', sm: '50%', md: '20%' } }}>
                    <FormControl fullWidth>
                        <InputLabel id="accessions-label">Accessions</InputLabel>
                        <Select
                            multiple
                            value={selectedAccessions}
                            onChange={handleAccessionsChange}
                            onOpen={handleAccessionsOpen}
                            disabled={selectionCombos.length === 0}
                            renderValue={(v)=>v.join(', ')}
                        >
                            {isLoadingAccessions && (
                                <MenuItem disabled>
                                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                        <CircularProgress size={18} sx={{ mr: 1 }} />
                                        Loading...
                                    </Box>
                                </MenuItem>
                            )}
                            {!isLoadingAccessions && accessionsLoaded && accessionOptions.length === 0 && (
                                <MenuItem disabled>No accessions found</MenuItem>
                            )}
                            {accessionOptions.map(acc => <MenuItem key={acc} value={acc}>{acc}</MenuItem>)}
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
                    <CSVDataTable data={csvData} onVisualizePlot={handleVisualizePlot} />
                </Box>
            )}
            </Box>
            <InferenceResultsPreview
                open={isPreviewOpen}
                onClose={handleClosePreview}
                inferenceData={previewData}
                initialPlotHint={previewData?.plot_hint}
                rowContext={previewData?.row_context}
            />
        </>
    );
};

export default TableBuilder;
