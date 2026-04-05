/**
 * API helpers for E2E test verification and cleanup.
 * All calls go directly to the framework REST API — no mocking.
 */

const API_BASE = "http://localhost:7777/api";

/**
 * List files at a given path in MinIO via the framework API.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} objectPath - Path within the bucket (e.g., "2024/TestExp/Davis")
 * @returns {Promise<object>} File listing response
 */
async function listFilesInMinIO(request, objectPath) {
    const resp = await request.get(`${API_BASE}/files/list/gemini/${objectPath}`);
    return { status: resp.status(), body: resp.ok() ? await resp.json() : null };
}

/**
 * Verify a specific file exists in MinIO by checking the file listing.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} dirPath - Directory path in MinIO
 * @param {string} fileName - Expected file name
 * @returns {Promise<boolean>} True if file found
 */
async function verifyFileInMinIO(request, dirPath, fileName) {
    const result = await listFilesInMinIO(request, dirPath);
    if (!result.body) return false;

    // The list endpoint may return objects with different structures
    // depending on the framework version. Check common patterns.
    if (Array.isArray(result.body)) {
        return result.body.some(
            (item) =>
                (item.object_name && item.object_name.includes(fileName)) ||
                (item.name && item.name.includes(fileName)) ||
                (typeof item === "string" && item.includes(fileName))
        );
    }
    if (result.body.objects) {
        return result.body.objects.some((obj) => obj.includes(fileName));
    }
    return false;
}

/**
 * Delete a file or directory from MinIO.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} objectPath - Full object path to delete
 */
async function deleteFromMinIO(request, objectPath) {
    try {
        await request.delete(`${API_BASE}/files/delete/gemini/${objectPath}`);
    } catch (e) {
        // Ignore delete failures during cleanup
    }
}

/**
 * Recursively delete all files under a prefix in MinIO.
 * Lists files first, then deletes each one.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} prefix - Directory prefix to clean up
 */
async function cleanupMinIOPrefix(request, prefix) {
    const result = await listFilesInMinIO(request, prefix);
    if (!result.body) return;

    const items = Array.isArray(result.body)
        ? result.body
        : result.body.objects || [];

    for (const item of items) {
        const path =
            typeof item === "string"
                ? item
                : item.object_name || item.name || "";
        if (path) {
            await deleteFromMinIO(request, path);
        }
    }
}

/**
 * Clear the chunked upload cache for a given file identifier.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} fileIdentifier
 */
async function clearUploadCache(request, fileIdentifier) {
    try {
        await request.post(`${API_BASE}/files/clear_upload_cache`, {
            data: { file_identifier: fileIdentifier },
        });
    } catch (e) {
        // Ignore
    }
}

/**
 * Get all jobs of a specific type.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} jobType - e.g., "EXTRACT_BINARY"
 * @returns {Promise<Array>} List of jobs
 */
async function getJobsByType(request, jobType) {
    const resp = await request.get(
        `${API_BASE}/jobs/all?job_type=${jobType}`
    );
    if (!resp.ok()) return [];
    return resp.json();
}

/**
 * Cancel a job by ID.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} jobId
 */
async function cancelJob(request, jobId) {
    try {
        await request.post(`${API_BASE}/jobs/${jobId}/cancel`);
    } catch (e) {
        // Ignore
    }
}

/**
 * Delete a job by ID.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} jobId
 */
async function deleteJob(request, jobId) {
    try {
        await request.delete(`${API_BASE}/jobs/${jobId}`);
    } catch (e) {
        // Ignore
    }
}

/**
 * Get an experiment by name.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} name - Experiment name
 * @returns {Promise<object|null>} Experiment entity or null
 */
async function getExperimentByName(request, name) {
    const resp = await request.get(
        `${API_BASE}/experiments?experiment_name=${encodeURIComponent(name)}`
    );
    if (!resp.ok()) return null;
    const data = await resp.json();
    // Response is an array — return first match, normalize id field
    if (Array.isArray(data) && data.length > 0) {
        const exp = data[0];
        exp.experiment_id = exp.experiment_id || exp.id;
        return exp;
    }
    return null;
}

/**
 * Get the full entity hierarchy for an experiment.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} experimentId - Experiment UUID
 * @returns {Promise<object|null>} Hierarchy with seasons, sites, populations, etc.
 */
async function getExperimentHierarchy(request, experimentId) {
    const resp = await request.get(
        `${API_BASE}/experiments/id/${experimentId}/hierarchy`
    );
    if (!resp.ok()) return null;
    return resp.json();
}

/**
 * Delete an experiment by ID.
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} experimentId
 */
async function deleteExperiment(request, experimentId) {
    try {
        await request.delete(`${API_BASE}/experiments/id/${experimentId}`);
    } catch (e) {
        // Ignore
    }
}

module.exports = {
    API_BASE,
    listFilesInMinIO,
    verifyFileInMinIO,
    deleteFromMinIO,
    cleanupMinIOPrefix,
    clearUploadCache,
    getJobsByType,
    cancelJob,
    deleteJob,
    getExperimentByName,
    getExperimentHierarchy,
    deleteExperiment,
};
