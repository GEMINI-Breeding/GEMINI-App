/**
 * File management API calls.
 * Supports both Flask (filesystem) and framework (MinIO) backends.
 */

import { fetchJson, postJson, postFormData } from './client';
import { getBaseUrl, BACKEND_MODE, FRAMEWORK_URL } from './config';

const baseUrl = () => getBaseUrl('files');

// -- Directory listing (Flask) --

export const listDirs = (dirPath) =>
    fetchJson(`${baseUrl()}list_dirs/${dirPath}`);

export const listDirsNested = () =>
    fetchJson(`${baseUrl()}list_dirs_nested`);

export const listDirsNestedProcessed = () =>
    fetchJson(`${baseUrl()}list_dirs_nested_processed`);

export const listFiles = (dirPath) =>
    fetchJson(`${baseUrl()}list_files/${dirPath}`);

// -- File serving --

export const getFileUrl = (filePath) => {
    if (BACKEND_MODE === 'framework') {
        return `${FRAMEWORK_URL}/files/download/${filePath}`;
    }
    return `${baseUrl()}files/${filePath}`;
};

export const getImageUrl = (filePath) => {
    if (BACKEND_MODE === 'framework') {
        return `${FRAMEWORK_URL}/files/download/${filePath}`;
    }
    return `${baseUrl()}images/${filePath}`;
};

/**
 * Get a presigned URL for direct MinIO access (framework mode only).
 * Falls back to getFileUrl in Flask mode.
 */
export const getPresignedUrl = async (filePath) => {
    if (BACKEND_MODE === 'framework') {
        const data = await fetchJson(`${FRAMEWORK_URL}/files/presign/${filePath}`);
        return data.url;
    }
    return getFileUrl(filePath);
};

export const fetchDataRootDir = () =>
    fetchJson(`${baseUrl()}fetch_data_root_dir`);

// -- Upload (Flask chunked) --

export const uploadFile = (formData) =>
    postFormData(`${baseUrl()}upload`, formData);

export const uploadChunk = (formData) =>
    postFormData(`${baseUrl()}upload_chunk`, formData);

export const checkFiles = (body) =>
    postJson(`${baseUrl()}check_files`, body);

export const checkUploadedChunks = (body) =>
    postJson(`${baseUrl()}check_uploaded_chunks`, body);

export const clearUploadDir = (body) =>
    postJson(`${baseUrl()}clear_upload_dir`, body);

export const clearUploadCache = (body) =>
    postJson(`${baseUrl()}clear_upload_cache`, body);

// -- File operations --

export const deleteFiles = (body) =>
    postJson(`${baseUrl()}delete_files`, body);

export const getTifToPng = (body) =>
    postJson(`${baseUrl()}get_tif_to_png`, body);

export const getPngFile = (body) =>
    postJson(`${baseUrl()}get_png_file`, body);
