/**
 * Ground Control Point (GCP) operations API.
 * Supports both Flask and framework backends.
 */

import { fetchJson, postJson } from './client';
import { BACKEND_MODE, FLASK_URL, FRAMEWORK_URL } from './config';
import { getFileUrl } from './files';

/**
 * Get GCP-selected images for annotation.
 * Framework mode: query sensor records near GCP coordinates.
 */
export const getGcpSelectedImages = async (data) => {
    if (BACKEND_MODE !== 'flask') {
        // Framework: list images in the dataset directory and return matching ones
        const { year, experiment, location, population, date, platform, sensor } = data;
        const dirPath = `${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/Images`;
        try {
            const items = await fetchJson(`${FRAMEWORK_URL}files/list/gemini/${dirPath}`);
            const images = (items || [])
                .filter(item => {
                    const name = (item.object_name || '').toLowerCase();
                    return name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.png');
                })
                .map(item => {
                    const objectName = item.object_name || '';
                    return {
                        fileName: objectName.split('/').pop(),
                        url: `${FRAMEWORK_URL}files/download/gemini/${objectName}`,
                    };
                });
            return { images };
        } catch (_) {
            return { images: [] };
        }
    }
    return postJson(`${FLASK_URL}get_gcp_selcted_images`, data);
};

/**
 * Refresh GCP-selected images (cache bypass).
 */
export const refreshGcpSelectedImages = async (data) => {
    if (BACKEND_MODE !== 'flask') {
        // Framework: same as getGcpSelectedImages (no server-side cache)
        return getGcpSelectedImages(data);
    }
    return postJson(`${FLASK_URL}refresh_gcp_selcted_images`, data);
};

/**
 * Initialize a GCP annotation file.
 * Framework mode: check if the file exists in MinIO, create if not.
 */
export const initializeGcpFile = async (data) => {
    if (BACKEND_MODE !== 'flask') {
        const { filePath, defaultContent } = data;
        try {
            // Try to read existing file
            const existing = await fetchJson(`${FRAMEWORK_URL}files/download/gemini/${filePath}`);
            return existing;
        } catch (_) {
            // File doesn't exist — create with default content if provided
            if (defaultContent) {
                const blob = new Blob([JSON.stringify(defaultContent)], { type: 'application/json' });
                const formData = new FormData();
                formData.append('file', blob, filePath.split('/').pop());
                formData.append('bucket_name', 'gemini');
                formData.append('object_name', filePath);
                await fetch(`${FRAMEWORK_URL}files/upload`, {
                    method: 'POST',
                    body: formData,
                });
                return defaultContent;
            }
            return null;
        }
    }
    return postJson(`${FLASK_URL}initialize_file`, data);
};

/**
 * Save GCP annotation array data.
 * Framework mode: save as JSON file to MinIO.
 */
export const saveGcpArray = async (data) => {
    if (BACKEND_MODE !== 'flask') {
        const { filePath, content } = data;
        const blob = new Blob([JSON.stringify(content)], { type: 'application/json' });
        const formData = new FormData();
        formData.append('file', blob, filePath.split('/').pop());
        formData.append('bucket_name', 'gemini');
        formData.append('object_name', filePath);
        const response = await fetch(`${FRAMEWORK_URL}files/upload`, {
            method: 'POST',
            body: formData,
        });
        if (!response.ok) throw new Error('Failed to save GCP data');
        return response.json();
    }
    return postJson(`${FLASK_URL}save_array`, data);
};
