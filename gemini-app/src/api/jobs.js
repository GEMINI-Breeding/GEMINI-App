/**
 * Job queue API and WebSocket progress for gemini-framework.
 * Used when BACKEND_MODE is "framework".
 */

import { fetchJson, postJson } from './client';
import { FRAMEWORK_URL } from './config';

/**
 * Get job status by ID.
 */
export const getJobStatus = (jobId) =>
    fetchJson(`${FRAMEWORK_URL}jobs/${jobId}`);

/**
 * Cancel a running job.
 */
export const cancelJob = (jobId) =>
    postJson(`${FRAMEWORK_URL}jobs/${jobId}/cancel`, {});

/**
 * Connect to a WebSocket for real-time job progress.
 * Returns a WebSocket instance. Caller is responsible for:
 *   ws.onmessage = (event) => { ... }
 *   ws.onclose = () => { ... }
 *   ws.close() when done
 *
 * @param {string} jobId - The job UUID
 * @param {function} onProgress - Called with progress data on each message
 * @param {function} onComplete - Called when job completes
 * @param {function} onError - Called on error
 * @returns {WebSocket}
 */
export const connectJobProgress = (jobId, { onProgress, onComplete, onError }) => {
    const wsUrl = FRAMEWORK_URL.replace(/^http/, 'ws');
    const ws = new WebSocket(`${wsUrl}/jobs/${jobId}/progress`);

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.status === 'COMPLETED') {
            onComplete?.(data);
        } else if (data.status === 'FAILED' || data.status === 'CANCELLED') {
            onError?.(data);
        } else {
            onProgress?.(data);
        }
    };

    ws.onerror = (event) => {
        onError?.({ error: 'WebSocket connection error', event });
    };

    ws.onclose = () => {
        // Connection closed
    };

    return ws;
};
