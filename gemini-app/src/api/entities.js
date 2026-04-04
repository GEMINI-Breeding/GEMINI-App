/**
 * API calls for gemini-framework entities.
 * Used when BACKEND_MODE is "framework" or "hybrid" with entity domain migrated.
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
