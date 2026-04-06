/**
 * Ground Control Point (GCP) operations API.
 * Uses the gemini-framework backend.
 */

import { fetchJson, postJson } from './client';
import { FRAMEWORK_URL } from './config';

/**
 * Get GCP-selected images for annotation.
 * List images in the dataset directory and return matching ones.
 */
export const getGcpSelectedImages = async (data) => {
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
};

/**
 * Refresh GCP-selected images (no server-side cache in framework mode).
 */
export const refreshGcpSelectedImages = async (data) =>
    getGcpSelectedImages(data);

/**
 * Initialize a GCP annotation file.
 * Check if the file exists in MinIO, create if not.
 */
export const initializeGcpFile = async (data) => {
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
};

/**
 * Save GCP annotation array data as JSON file to MinIO.
 */
export const saveGcpArray = async (data) => {
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
};
