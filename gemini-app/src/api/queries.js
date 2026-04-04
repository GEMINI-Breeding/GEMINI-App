/**
 * Query API calls for images, traits, and GeoJSON data.
 * Supports both Flask and framework backends.
 */

import { fetchJson, postJson } from './client';
import { BACKEND_MODE, FLASK_URL, FRAMEWORK_URL } from './config';

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

export const getOrthomosaicVersions = (params) => {
    // This endpoint stays Flask-only until processing workers are built
    return postJson(`${FLASK_URL}get_orthomosaic_versions`, params);
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
    if (BACKEND_MODE === 'framework') {
        // Framework: query plots with geometry
        return fetchJson(`${FRAMEWORK_URL}plots/all`);
    }
    return postJson(`${FLASK_URL}filter_plot_borders`, params);
};
