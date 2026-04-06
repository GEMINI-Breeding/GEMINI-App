/**
 * API calls for gemini-framework entities.
 * Provides CRUD operations for gemini-framework entities.
 */

import { fetchJson, postJson } from './client';
import { FRAMEWORK_URL } from './config';

// -- Experiments --

export const getExperiments = (limit = 100, offset = 0) =>
    fetchJson(`${FRAMEWORK_URL}experiments/all?limit=${limit}&offset=${offset}`);

export const getExperiment = (name) =>
    fetchJson(`${FRAMEWORK_URL}experiments?experiment_name=${encodeURIComponent(name)}`);

export const getExperimentById = (id) =>
    fetchJson(`${FRAMEWORK_URL}experiments/id/${id}`);

export const getExperimentHierarchy = (id) =>
    fetchJson(`${FRAMEWORK_URL}experiments/id/${id}/hierarchy`);

// -- Seasons --

export const getSeasons = (experimentName) =>
    fetchJson(`${FRAMEWORK_URL}experiments/seasons?experiment_name=${encodeURIComponent(experimentName)}`);

// -- Sites --

export const getSites = (limit = 100, offset = 0) =>
    fetchJson(`${FRAMEWORK_URL}sites/all?limit=${limit}&offset=${offset}`);

export const getExperimentSites = (experimentName) =>
    fetchJson(`${FRAMEWORK_URL}experiments/sites?experiment_name=${encodeURIComponent(experimentName)}`);

// -- Populations --

export const getPopulations = (limit = 100, offset = 0) =>
    fetchJson(`${FRAMEWORK_URL}populations/all?limit=${limit}&offset=${offset}`);

export const getExperimentPopulations = (experimentName) =>
    fetchJson(`${FRAMEWORK_URL}experiments/populations?experiment_name=${encodeURIComponent(experimentName)}`);

// -- Sensors & Platforms --

export const getSensors = (limit = 100, offset = 0) =>
    fetchJson(`${FRAMEWORK_URL}sensors/all?limit=${limit}&offset=${offset}`);

export const getSensorPlatforms = (limit = 100, offset = 0) =>
    fetchJson(`${FRAMEWORK_URL}sensor_platforms/all?limit=${limit}&offset=${offset}`);

export const getExperimentSensors = (experimentName) =>
    fetchJson(`${FRAMEWORK_URL}experiments/sensors?experiment_name=${encodeURIComponent(experimentName)}`);

// -- Plots --

export const getPlots = (experimentName, limit = 100, offset = 0) =>
    fetchJson(`${FRAMEWORK_URL}plots/all?limit=${limit}&offset=${offset}`);

// -- Datasets --

export const getDatasets = (limit = 100, offset = 0) =>
    fetchJson(`${FRAMEWORK_URL}datasets/all?limit=${limit}&offset=${offset}`);

// -- Models --

export const getModels = (limit = 100, offset = 0) =>
    fetchJson(`${FRAMEWORK_URL}models/all?limit=${limit}&offset=${offset}`);

export const getModelById = (id) =>
    fetchJson(`${FRAMEWORK_URL}models/${id}`);

// -- Traits --

export const getTraits = (limit = 100, offset = 0) =>
    fetchJson(`${FRAMEWORK_URL}traits/all?limit=${limit}&offset=${offset}`);

// -- Entity Creation (get-or-create semantics on the backend) --

export const createExperiment = (body) =>
    postJson(`${FRAMEWORK_URL}experiments`, body);

export const createExperimentSeason = (experimentId, body) =>
    postJson(`${FRAMEWORK_URL}experiments/id/${experimentId}/seasons`, body);

export const createExperimentSite = (experimentId, body) =>
    postJson(`${FRAMEWORK_URL}experiments/id/${experimentId}/sites`, body);

export const createExperimentPopulation = (experimentId, body) =>
    postJson(`${FRAMEWORK_URL}experiments/id/${experimentId}/populations`, body);

export const createExperimentSensorPlatform = (experimentId, body) =>
    postJson(`${FRAMEWORK_URL}experiments/id/${experimentId}/sensor_platforms`, body);

export const createExperimentSensor = (experimentId, body) =>
    postJson(`${FRAMEWORK_URL}experiments/id/${experimentId}/sensors`, body);

export const createExperimentDataset = (experimentId, body) =>
    postJson(`${FRAMEWORK_URL}experiments/id/${experimentId}/datasets`, body);

/**
 * Normalize a user-entered date string to ISO format (YYYY-MM-DD).
 * Handles common formats: M-D-YYYY, MM-DD-YYYY, YYYY-MM-DD, M/D/YYYY, etc.
 * Returns the original string if parsing fails (let the backend reject it).
 */
const normalizeDate = (dateStr) => {
    if (!dateStr) return dateStr;
    // Already ISO format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    // Try parsing with Date constructor
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, '0');
        const d = String(parsed.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    return dateStr;
};

/**
 * Register all entities for an uploaded dataset based on form field values.
 * Creates experiment, season, site, population, sensor_platform, sensor, and dataset
 * as needed (backend uses get-or-create semantics — safe to call repeatedly).
 *
 * @param {Object} values - Form values with keys: year, experiment, location, population, date, platform, sensor
 * @param {string} dataType - The upload data type (image, binary, weather, gcpLocations, platformLogs, ortho)
 * @param {string[]} fileNames - Names of uploaded files
 * @returns {Object} Created entities { experiment, season, site, population, sensorPlatform, sensor, dataset }
 */
export const registerUploadEntities = async (values, dataType, fileNames) => {
    const result = {};

    // 1. Create experiment (always required)
    result.experiment = await createExperiment({
        experiment_name: values.experiment,
    });
    // Response uses "id" (not "experiment_id") for the create endpoint
    const expId = result.experiment.id || result.experiment.experiment_id;

    // 2. Create season from year (always required)
    // Must provide start/end dates — the framework Pydantic model rejects None
    const yearStart = `${values.year}-01-01`;
    const yearEnd = `${values.year}-12-31`;
    result.season = await createExperimentSeason(expId, {
        season_name: values.year,
        season_start_date: yearStart,
        season_end_date: yearEnd,
    });

    // 3. Create site from location (always required)
    result.site = await createExperimentSite(expId, {
        site_name: values.location,
    });

    // 4. Create population (always required)
    // population_accession is NOT NULL in DB — use population name as default accession
    result.population = await createExperimentPopulation(expId, {
        population_name: values.population,
        population_accession: values.population,
    });

    // 5. Create sensor platform if present (image, platformLogs, ortho have platform field)
    if (values.platform) {
        result.sensorPlatform = await createExperimentSensorPlatform(expId, {
            sensor_platform_name: values.platform,
        });
    }

    // 6. Create sensor if present
    if (values.sensor) {
        result.sensor = await createExperimentSensor(expId, {
            sensor_name: values.sensor,
            sensor_platform_name: values.platform || null,
        });
    }

    // 7. Create dataset for the collection date
    if (values.date) {
        const isoDate = normalizeDate(values.date);
        const datasetName = `${values.experiment}_${values.location}_${isoDate}_${dataType}`;
        result.dataset = await createExperimentDataset(expId, {
            dataset_name: datasetName,
            collection_date: isoDate,
            dataset_info: {
                data_type: dataType,
                files: fileNames,
                population: values.population,
                platform: values.platform || null,
                sensor: values.sensor || null,
            },
        });
    }

    return result;
};
