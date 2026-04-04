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

// -- Binary Extraction (FLIR) --

export const extractBinaryFile = (formData) => {
    if (BACKEND_MODE === 'flask') {
        return fetch(`${FLASK_URL}extract_binary_file`, { method: 'POST', body: formData }).then(r => r.json());
    }
    return postJson(`${FRAMEWORK_URL}jobs/submit`, { job_type: 'EXTRACT_BINARY', parameters: {} });
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
