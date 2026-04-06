/**
 * Query API calls for images, traits, and GeoJSON data.
 * Supports both Flask and framework backends.
 */

import { fetchJson, postJson } from './client';
import { BACKEND_MODE, FLASK_URL, FRAMEWORK_URL } from './config';
import { listDirs, listFiles, getPresignedUrl } from './files';

// -- Image Queries --

export const queryImages = (params) => {
    if (BACKEND_MODE === 'framework') {
        // Framework: query sensor records filtered by experiment/season/site/date
        const queryParams = new URLSearchParams();
        if (params.experiment) queryParams.append('experiment_name', params.experiment);
        if (params.season || params.year) queryParams.append('season_name', params.season || params.year);
        if (params.location) queryParams.append('site_name', params.location);
        if (params.date) queryParams.append('collection_date', params.date);
        return fetchJson(`${FRAMEWORK_URL}sensors/id/${params.sensorId}/records?${queryParams}`);
    }
    return postJson(`${FLASK_URL}query_images`, params);
};

// -- Trait Queries --

export const queryTraits = (params) => {
    if (BACKEND_MODE === 'framework') {
        const queryParams = new URLSearchParams();
        if (params.experiment) queryParams.append('experiment_name', params.experiment);
        if (params.season || params.year) queryParams.append('season_name', params.season || params.year);
        if (params.location) queryParams.append('site_name', params.location);
        if (params.date) queryParams.append('collection_date', params.date);
        return fetchJson(`${FRAMEWORK_URL}traits/id/${params.traitId}/records?${queryParams}`);
    }
    return postJson(`${FLASK_URL}query_traits`, params);
};

// -- GeoJSON Operations --

export const loadGeojson = (params) => {
    if (BACKEND_MODE === 'framework') {
        return postJson(`${FRAMEWORK_URL}geojson/load`, {
            file_path: params.filePath || params.path,
        });
    }
    return postJson(`${FLASK_URL}load_geojson`, params);
};

export const saveGeojson = (params) => {
    if (BACKEND_MODE === 'framework') {
        return postJson(`${FRAMEWORK_URL}geojson/save`, {
            file_path: params.filePath || params.path,
            geojson: params.geojson,
        });
    }
    return postJson(`${FLASK_URL}save_geojson`, params);
};

// -- CSV Operations --

export const saveCsv = (params) => {
    if (BACKEND_MODE === 'framework') {
        return postJson(`${FRAMEWORK_URL}csv/save`, {
            file_path: params.filePath || params.path,
            headers: params.headers,
            rows: params.rows,
        });
    }
    return postJson(`${FLASK_URL}save_csv`, params);
};

// -- Orthomosaic Versions --

/**
 * Get orthomosaic versions for a given data path.
 * Framework mode: list processed directories and reconstruct version info.
 */
export const getOrthomosaicVersions = async (params) => {
    if (BACKEND_MODE !== 'flask') {
        const { year, experiment, location, population } = params;
        const basePath = `Processed/${year}/${experiment}/${location}/${population}`;
        try {
            const dates = await listDirs(basePath);
            const versions = [];
            for (const date of dates) {
                const platforms = await listDirs(`${basePath}/${date}`);
                for (const platform of platforms) {
                    const sensors = await listDirs(`${basePath}/${date}/${platform}`);
                    for (const sensor of sensors) {
                        const sensorPath = `${basePath}/${date}/${platform}/${sensor}`;
                        const files = await listFiles(sensorPath);
                        const tifFiles = files.filter(f => f.endsWith('.tif'));
                        for (const tif of tifFiles) {
                            versions.push({
                                date,
                                platform,
                                sensor,
                                fileName: tif,
                                path: `${sensorPath}/${tif}`,
                            });
                        }
                        // Check for AgRowStitch versioned directories
                        const dirs = await listDirs(sensorPath);
                        const agrowstitchDirs = dirs.filter(d => d.startsWith('AgRowStitch_v'));
                        for (const aDir of agrowstitchDirs) {
                            versions.push({
                                date,
                                platform,
                                sensor,
                                fileName: aDir,
                                path: `${sensorPath}/${aDir}`,
                                isAgrowstitch: true,
                            });
                        }
                    }
                }
            }
            return versions;
        } catch (_) {
            return [];
        }
    }
    return postJson(`${FLASK_URL}get_orthomosaic_versions`, params);
};

// -- Plot Borders Data --

/**
 * Get plot borders data (GeoJSON-based plot boundaries).
 * Framework mode: load the plot border GeoJSON from MinIO.
 */
export const getPlotBordersData = async (params) => {
    if (BACKEND_MODE !== 'flask') {
        const { year, experiment, location, population } = params;
        const geoJsonPath = `Processed/${year}/${experiment}/${location}/${population}/Plot-Boundary-WGS84.geojson`;
        try {
            const geojson = await loadGeojson({ filePath: geoJsonPath });
            // Extract plot_data from GeoJSON features
            const plotData = {};
            if (geojson && geojson.features) {
                for (const feature of geojson.features) {
                    const props = feature.properties || {};
                    if (props.plot_index !== undefined) {
                        plotData[props.plot_index] = {
                            plot: props.plot || props.plot_label,
                            accession: props.accession || props.population,
                            start_lat: props.start_lat,
                            start_lon: props.start_lon,
                            end_lat: props.end_lat,
                            end_lon: props.end_lon,
                        };
                    }
                }
            }
            return { plot_data: plotData, geojson };
        } catch (_) {
            return { plot_data: {} };
        }
    }
    return postJson(`${FLASK_URL}get_plot_borders_data`, params);
};

// -- Inference Operations --

/**
 * Get inference progress. Framework mode: check for running inference jobs.
 */
export const getInferenceProgress = async () => {
    if (BACKEND_MODE !== 'flask') {
        try {
            const jobs = await fetchJson(`${FRAMEWORK_URL}jobs/all?status=RUNNING`);
            const inferenceJob = (jobs || []).find(j =>
                j.job_type === 'EXTRACT_TRAITS' || j.job_type === 'LOCATE_PLANTS'
            );
            if (inferenceJob) {
                return { running: true, progress: inferenceJob.progress || 0, jobId: inferenceJob.id };
            }
            return { running: false };
        } catch (_) {
            return { running: false };
        }
    }
    return fetchJson(`${FLASK_URL}get_inference_progress`);
};

/**
 * Get inference results. Framework mode: list inference CSVs in MinIO.
 */
export const getInferenceResults = async (params) => {
    if (BACKEND_MODE !== 'flask') {
        const { year, experiment, location, population } = params;
        const basePath = `Processed/${year}/${experiment}/${location}/${population}`;
        try {
            const dates = await listDirs(basePath);
            const results = [];
            for (const date of dates) {
                const platforms = await listDirs(`${basePath}/${date}`);
                for (const platform of platforms) {
                    const sensors = await listDirs(`${basePath}/${date}/${platform}`);
                    for (const sensor of sensors) {
                        const sensorPath = `${basePath}/${date}/${platform}/${sensor}`;
                        const files = await listFiles(sensorPath);
                        const csvFiles = files.filter(f => f.includes('inference') || f.includes('traits') || f.includes('predictions'));
                        for (const csv of csvFiles) {
                            results.push({
                                date,
                                platform,
                                sensor,
                                fileName: csv,
                                path: `${sensorPath}/${csv}`,
                            });
                        }
                    }
                }
            }
            return results;
        } catch (_) {
            return [];
        }
    }
    return postJson(`${FLASK_URL}get_inference_results`, params);
};

/**
 * Delete inference results. Framework mode: delete inference files from MinIO.
 */
export const deleteInferenceResults = async (params) => {
    if (BACKEND_MODE !== 'flask') {
        const path = params.path || params.filePath || '';
        const response = await fetch(`${FRAMEWORK_URL}files/delete/gemini/${path}`, {
            method: 'DELETE',
        });
        if (!response.ok) throw new Error('Failed to delete inference results');
        return { status: 'deleted' };
    }
    return postJson(`${FLASK_URL}delete_inference_results`, params);
};

/**
 * Download inference CSV. Framework mode: return presigned URL.
 */
export const downloadInferenceCsv = async (params) => {
    if (BACKEND_MODE !== 'flask') {
        const filePath = params.path || params.filePath || '';
        const url = await getPresignedUrl(`gemini/${filePath}`);
        return { url, fileName: filePath.split('/').pop() };
    }
    return postJson(`${FLASK_URL}download_inference_csv`, params);
};

/**
 * Get plot predictions. Framework mode: read predictions CSV from MinIO.
 */
export const getPlotPredictions = async (params) => {
    if (BACKEND_MODE !== 'flask') {
        const filePath = params.path || params.filePath || '';
        try {
            const data = await fetchJson(`${FRAMEWORK_URL}files/download/gemini/${filePath}`);
            return data;
        } catch (_) {
            return { predictions: [] };
        }
    }
    return postJson(`${FLASK_URL}get_plot_predictions`, params);
};

// -- Download --

export const downloadZipped = (params) => {
    if (BACKEND_MODE === 'framework') {
        return postJson(`${FRAMEWORK_URL}files/download_zip`, params);
    }
    return postJson(`${FLASK_URL}dload_zipped`, params);
};

// -- Plot Borders --

export const filterPlotBorders = (params) => {
    if (BACKEND_MODE !== 'flask') {
        return postJson(`${FRAMEWORK_URL}plot_geometry/borders`, params);
    }
    return postJson(`${FLASK_URL}filter_plot_borders`, params);
};
