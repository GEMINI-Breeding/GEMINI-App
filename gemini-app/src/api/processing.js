/**
 * Processing API calls for long-running operations.
 *
 * In Flask mode: calls Flask endpoints directly.
 * In framework mode: submits jobs via the job queue and returns job IDs.
 */

import { fetchJson, postJson } from './client';
import { BACKEND_MODE, FLASK_URL, FRAMEWORK_URL } from './config';

// -- Training --

export const trainModel = (body) => {
    if (BACKEND_MODE === 'flask') {
        return postJson(`${FLASK_URL}train_model`, body);
    }
    return postJson(`${FRAMEWORK_URL}jobs/submit`, { job_type: 'TRAIN_MODEL', parameters: body });
};

export const getTrainingProgress = () => {
    if (BACKEND_MODE === 'flask') {
        return fetchJson(`${FLASK_URL}get_progress`);
    }
    return Promise.resolve(null); // Framework uses WebSocket — see jobs.js
};

export const stopTraining = () => {
    if (BACKEND_MODE === 'flask') {
        return postJson(`${FLASK_URL}stop_training`, {});
    }
    return Promise.resolve(null); // Framework uses job cancellation
};

// -- Plant Location --

export const locatePlants = (body) => {
    if (BACKEND_MODE === 'flask') {
        return postJson(`${FLASK_URL}locate_plants`, body);
    }
    return postJson(`${FRAMEWORK_URL}jobs/submit`, { job_type: 'LOCATE_PLANTS', parameters: body });
};

export const getLocateProgress = () => {
    if (BACKEND_MODE === 'flask') {
        return fetchJson(`${FLASK_URL}get_locate_progress`);
    }
    return Promise.resolve(null);
};

export const stopLocate = () => {
    if (BACKEND_MODE === 'flask') {
        return postJson(`${FLASK_URL}stop_locate`, {});
    }
    return Promise.resolve(null);
};

// -- Trait Extraction --

export const extractTraits = (body) => {
    if (BACKEND_MODE === 'flask') {
        return postJson(`${FLASK_URL}extract_traits`, body);
    }
    return postJson(`${FRAMEWORK_URL}jobs/submit`, { job_type: 'EXTRACT_TRAITS', parameters: body });
};

export const getExtractProgress = () => {
    if (BACKEND_MODE === 'flask') {
        return fetchJson(`${FLASK_URL}get_extract_progress`);
    }
    return Promise.resolve(null);
};

export const stopExtract = () => {
    if (BACKEND_MODE === 'flask') {
        return postJson(`${FLASK_URL}stop_extract`, {});
    }
    return Promise.resolve(null);
};

// -- Orthomosaic (ODM / AgRowStitch) --

export const runOdm = (body) => {
    if (BACKEND_MODE === 'flask') {
        return postJson(`${FLASK_URL}run_odm`, body);
    }
    return postJson(`${FRAMEWORK_URL}jobs/submit`, { job_type: 'RUN_ODM', parameters: body });
};

export const runStitch = (body) => {
    if (BACKEND_MODE === 'flask') {
        return postJson(`${FLASK_URL}run_stitch`, body);
    }
    return postJson(`${FRAMEWORK_URL}jobs/submit`, { job_type: 'RUN_STITCH', parameters: body });
};

export const getOrthoProgress = () => {
    if (BACKEND_MODE === 'flask') {
        return fetchJson(`${FLASK_URL}get_ortho_progress`);
    }
    return Promise.resolve(null);
};

export const stopOdm = (body) => {
    if (BACKEND_MODE === 'flask') {
        return postJson(`${FLASK_URL}stop_odm`, body);
    }
    return Promise.resolve(null);
};

// -- Drone Processing --

export const processDroneTiff = (body) => {
    if (BACKEND_MODE === 'flask') {
        return postJson(`${FLASK_URL}process_drone_tiff`, body);
    }
    return postJson(`${FRAMEWORK_URL}jobs/submit`, { job_type: 'PROCESS_DRONE_TIFF', parameters: body });
};

export const getDroneExtractProgress = () => {
    if (BACKEND_MODE === 'flask') {
        return fetchJson(`${FLASK_URL}get_drone_extract_progress`);
    }
    return Promise.resolve(null);
};

export const stopDroneExtract = (body) => {
    if (BACKEND_MODE === 'flask') {
        return postJson(`${FLASK_URL}stop_drone_extract`, body);
    }
    return Promise.resolve(null);
};

// -- COG Creation --

export const createCog = (body) => {
    if (BACKEND_MODE === 'flask') {
        // Flask creates COGs inline during orthomosaic generation — no separate endpoint
        return Promise.resolve(null);
    }
    return postJson(`${FRAMEWORK_URL}jobs/submit`, { job_type: 'CREATE_COG', parameters: body });
};

// -- Binary Extraction (FLIR) --

export const extractBinaryFile = (data) => {
    if (BACKEND_MODE === 'flask') {
        return fetch(`${FLASK_URL}extract_binary_file`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        }).then(r => r.json());
    }
    return postJson(`${FRAMEWORK_URL}jobs/submit`, {
        job_type: 'EXTRACT_BINARY',
        parameters: { files: data.files, localDirPath: data.localDirPath },
    });
};

export const getBinaryProgress = (body) => {
    if (BACKEND_MODE === 'flask') {
        return postJson(`${FLASK_URL}get_binary_progress`, body);
    }
    return Promise.resolve(null);
};

export const getBinaryStatus = () => {
    if (BACKEND_MODE === 'flask') {
        return fetchJson(`${FLASK_URL}get_binary_status`);
    }
    return Promise.resolve(null);
};

// -- Stitch Mask --

/**
 * Check if a stitch mask exists for a dataset.
 * Framework mode: try to read stitch_mask.json from MinIO.
 */
export const checkMask = async (params) => {
    if (BACKEND_MODE === 'flask') {
        return postJson(`${FLASK_URL}check_mask`, params);
    }
    const { year, experiment, location, population, date, platform, sensor } = params;
    const maskPath = `Processed/${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/stitch_mask.json`;
    try {
        const data = await fetchJson(`${FRAMEWORK_URL}files/download/gemini/${maskPath}`);
        return { exists: true, mask: data };
    } catch (_) {
        return { exists: false };
    }
};

// -- ODM Logs --

/**
 * Get ODM processing logs.
 * Framework mode: read log from job artifacts in MinIO.
 */
export const getOdmLogs = async (params) => {
    if (BACKEND_MODE === 'flask') {
        return postJson(`${FLASK_URL}get_odm_logs`, params);
    }
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
