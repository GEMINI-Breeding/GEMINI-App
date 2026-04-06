/**
 * Processing API calls for long-running operations.
 *
 * Submits jobs via the job queue and returns job IDs.
 */

import { fetchJson, postJson } from './client';
import { FRAMEWORK_URL } from './config';

// -- Training --

export const trainModel = (body) =>
    postJson(`${FRAMEWORK_URL}jobs/submit`, { job_type: 'TRAIN_MODEL', parameters: body });

export const getTrainingProgress = () =>
    Promise.resolve(null); // Framework uses WebSocket — see jobs.js

export const stopTraining = () =>
    Promise.resolve(null); // Framework uses job cancellation

// -- Plant Location --

export const locatePlants = (body) =>
    postJson(`${FRAMEWORK_URL}jobs/submit`, { job_type: 'LOCATE_PLANTS', parameters: body });

export const getLocateProgress = () =>
    Promise.resolve(null);

export const stopLocate = () =>
    Promise.resolve(null);

// -- Trait Extraction --

export const extractTraits = (body) =>
    postJson(`${FRAMEWORK_URL}jobs/submit`, { job_type: 'EXTRACT_TRAITS', parameters: body });

export const getExtractProgress = () =>
    Promise.resolve(null);

export const stopExtract = () =>
    Promise.resolve(null);

// -- Orthomosaic (ODM / AgRowStitch) --

export const runOdm = (body) =>
    postJson(`${FRAMEWORK_URL}jobs/submit`, { job_type: 'RUN_ODM', parameters: body });

export const runStitch = (body) =>
    postJson(`${FRAMEWORK_URL}jobs/submit`, { job_type: 'RUN_STITCH', parameters: body });

export const getOrthoProgress = () =>
    Promise.resolve(null);

export const stopOdm = () =>
    Promise.resolve(null);

// -- Drone Processing --

export const processDroneTiff = (body) =>
    postJson(`${FRAMEWORK_URL}jobs/submit`, { job_type: 'PROCESS_DRONE_TIFF', parameters: body });

export const getDroneExtractProgress = () =>
    Promise.resolve(null);

export const stopDroneExtract = () =>
    Promise.resolve(null);

// -- COG Creation --

export const createCog = (body) =>
    postJson(`${FRAMEWORK_URL}jobs/submit`, { job_type: 'CREATE_COG', parameters: body });

// -- Binary Extraction (FLIR) --

export const extractBinaryFile = (data) =>
    postJson(`${FRAMEWORK_URL}jobs/submit`, {
        job_type: 'EXTRACT_BINARY',
        parameters: { files: data.files, localDirPath: data.localDirPath },
    });

export const getBinaryProgress = () =>
    Promise.resolve(null);

export const getBinaryStatus = () =>
    Promise.resolve(null);

// -- Stitch Mask --

/**
 * Check if a stitch mask exists for a dataset.
 * Try to read stitch_mask.json from MinIO.
 */
export const checkMask = async (params) => {
    const { year, experiment, location, population, date, platform, sensor } = params;
    const maskPath = `Processed/${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/stitch_mask.json`;
    try {
        const data = await fetchJson(`${FRAMEWORK_URL}files/download/gemini/${maskPath}`);
        return { exists: true, mask: data };
    } catch (_) {
        return { exists: false };
    }
};

// -- Model Management --

export const getModelInfo = (body) =>
    postJson(`${FRAMEWORK_URL}model_management/info`, body);

export const getLocateInfo = (body) =>
    postJson(`${FRAMEWORK_URL}model_management/locate_info`, body);

export const bestLocateFile = (body) =>
    postJson(`${FRAMEWORK_URL}model_management/best_locate`, body);

export const bestModelFile = (body) =>
    postJson(`${FRAMEWORK_URL}model_management/best_model`, body);

export const doneTraining = () =>
    Promise.resolve({ status: 'ok' });

export const doneExtracting = () =>
    Promise.resolve({ status: 'ok' });

// -- Labels & Annotations --

export const checkExistingLabels = (body) =>
    postJson(`${FRAMEWORK_URL}annotations/check_labels`, body);

export const uploadTraitLabels = (formData) =>
    fetch(`${FRAMEWORK_URL}annotations/upload_labels`, {
        method: 'POST',
        body: formData,
    }).then(r => r.json());

export const startCvat = () =>
    postJson(`${FRAMEWORK_URL}annotations/start_cvat`, {});

// -- Orthomosaic Split --

export const splitOrthomosaics = (body) =>
    postJson(`${FRAMEWORK_URL}jobs/submit`, { job_type: 'SPLIT_ORTHOMOSAIC', parameters: body });

// -- Roboflow Inference --

export const runRoboflowInference = (body) =>
    postJson(`${FRAMEWORK_URL}jobs/submit`, { job_type: 'RUN_ROBOFLOW_INFERENCE', parameters: body });

// -- ODM Logs --

/**
 * Get ODM processing logs.
 * Read log from job artifacts in MinIO.
 */
export const getOdmLogs = async (params) => {
    const { year, experiment, location, population, date, platform, sensor } = params;
    const logPath = `Processed/${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/odm_log.txt`;
    try {
        const response = await fetch(`${FRAMEWORK_URL}files/download/gemini/${logPath}`);
        if (response.ok) {
            const text = await response.text();
            return { logs: text };
        }
        return { logs: '' };
    } catch (_) {
        return { logs: '' };
    }
};
