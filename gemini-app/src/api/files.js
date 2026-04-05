/**
 * File management API calls.
 * Supports both Flask (filesystem) and framework (MinIO) backends.
 */

import { fetchJson, postJson, postFormData } from './client';
import { getBaseUrl, BACKEND_MODE, FRAMEWORK_URL, FLASK_URL, STORAGE_BUCKET } from './config';

const baseUrl = () => getBaseUrl('files');

// -- Directory listing --

/**
 * List subdirectories at a path. Returns array of directory name strings.
 * Framework mode: queries MinIO via files/list and extracts unique directory prefixes.
 */
export const listDirs = async (dirPath) => {
    if (BACKEND_MODE !== 'flask') {
        const items = await fetchJson(`${FRAMEWORK_URL}files/list/gemini/${dirPath}`);
        // Extract unique immediate subdirectory names from object_name paths
        const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
        const dirNames = new Set();
        for (const item of items) {
            const objectName = item.object_name || '';
            // Get the relative path after our prefix
            const relative = objectName.startsWith(prefix)
                ? objectName.slice(prefix.length)
                : objectName.replace(new RegExp(`^.*?${dirPath.split('/').pop()}/`), '');
            // If there's a slash, the first segment is a subdirectory
            const slashIdx = relative.indexOf('/');
            if (slashIdx > 0) {
                dirNames.add(relative.slice(0, slashIdx));
            }
        }
        return [...dirNames].sort();
    }
    return fetchJson(`${baseUrl()}list_dirs/${dirPath}`);
};

/**
 * List files at a path. Returns array of filename strings.
 * Framework mode: queries MinIO via files/list and extracts leaf filenames.
 */
export const listFiles = async (dirPath) => {
    if (BACKEND_MODE !== 'flask') {
        const items = await fetchJson(`${FRAMEWORK_URL}files/list/gemini/${dirPath}`);
        const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
        const fileNames = [];
        for (const item of items) {
            const objectName = item.object_name || '';
            const relative = objectName.startsWith(prefix)
                ? objectName.slice(prefix.length)
                : objectName.split('/').pop();
            // Only include direct children (no further slashes)
            if (relative && !relative.includes('/')) {
                fileNames.push(relative);
            }
        }
        return fileNames.sort();
    }
    return fetchJson(`${baseUrl()}list_files/${dirPath}`);
};

export const listDirsNested = () =>
    fetchJson(`${baseUrl()}list_dirs_nested`);

export const listDirsNestedProcessed = () =>
    fetchJson(`${baseUrl()}list_dirs_nested_processed`);

// -- File serving --

export const getFileUrl = (filePath) => {
    if (BACKEND_MODE === 'framework') {
        return `${FRAMEWORK_URL}files/download/${filePath}`;
    }
    return `${baseUrl()}files/${filePath}`;
};

export const getImageUrl = (filePath) => {
    if (BACKEND_MODE === 'framework') {
        return `${FRAMEWORK_URL}files/download/${filePath}`;
    }
    return `${baseUrl()}images/${filePath}`;
};

/**
 * Get a presigned URL for direct MinIO access (framework mode only).
 * Falls back to getFileUrl in Flask mode.
 */
export const getPresignedUrl = async (filePath) => {
    if (BACKEND_MODE === 'framework') {
        const data = await fetchJson(`${FRAMEWORK_URL}files/presign/${filePath}`);
        return data.url;
    }
    return getFileUrl(filePath);
};

/**
 * Build a file URL suitable for TiTiler tile requests.
 * In framework mode: returns an S3 path (s3://bucket/object) for direct MinIO access.
 * In flask mode: returns an HTTP URL to the Flask file endpoint.
 */
export const getTileFileUrl = (filePath, flaskUrl) => {
    if (BACKEND_MODE === 'framework') {
        const objectPath = filePath.replace(/^files\//, '');
        return `s3://${STORAGE_BUCKET}/${objectPath}`;
    }
    return `${flaskUrl}${filePath}`;
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

/**
 * Delete files. Framework mode: delete from MinIO.
 */
export const deleteFiles = async (body) => {
    if (BACKEND_MODE !== 'flask') {
        const path = body.path || body.dirPath || '';
        const response = await fetch(`${FRAMEWORK_URL}files/delete/gemini/${path}`, {
            method: 'DELETE',
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => response.statusText);
            throw new Error(`Delete failed: ${errorText}`);
        }
        return { status: 'deleted' };
    }
    return postJson(`${baseUrl()}delete_files`, body);
};

/**
 * Convert TIF to PNG. Framework mode: submit TIF_TO_PNG job.
 * Returns the job response (caller should poll for completion) or the PNG data.
 */
export const getTifToPng = async (body) => {
    if (BACKEND_MODE !== 'flask') {
        // Check if a PNG already exists at the expected path
        const tifPath = body.filePath || body.path || '';
        const pngPath = tifPath.replace(/\.tif$/i, '.png');
        try {
            const items = await fetchJson(`${FRAMEWORK_URL}files/list/gemini/${pngPath}`);
            if (items && items.length > 0) {
                return { url: `${FRAMEWORK_URL}files/download/gemini/${pngPath}` };
            }
        } catch (_) {
            // PNG doesn't exist, submit conversion job
        }
        return postJson(`${FRAMEWORK_URL}jobs/submit`, {
            job_type: 'TIF_TO_PNG',
            parameters: { file_path: tifPath },
        });
    }
    return postJson(`${baseUrl()}get_tif_to_png`, body);
};

/**
 * Get PNG file URL/data. Framework mode: serve via download endpoint.
 */
export const getPngFile = (body) => {
    if (BACKEND_MODE !== 'flask') {
        const filePath = body.filePath || body.path || '';
        return Promise.resolve({ url: `${FRAMEWORK_URL}files/download/gemini/${filePath}` });
    }
    return postJson(`${baseUrl()}get_png_file`, body);
};

// -- Ortho-specific operations --

/**
 * Delete an orthomosaic file or AgRowStitch directory from storage.
 */
export const deleteOrtho = async (params) => {
    if (BACKEND_MODE !== 'flask') {
        const { year, experiment, location, population, date, platform, sensor, fileName, agrowstitchDir, deleteType } = params;
        const basePath = `Processed/${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}`;
        const targetPath = deleteType === 'agrowstitch' ? `${basePath}/${agrowstitchDir}` : `${basePath}/${fileName}`;
        // Delete all files under this prefix
        const items = await fetchJson(`${FRAMEWORK_URL}files/list/gemini/${targetPath}`);
        for (const item of items) {
            await fetch(`${FRAMEWORK_URL}files/delete/gemini/${item.object_name}`, { method: 'DELETE' });
        }
        return { status: 'deleted' };
    }
    return postJson(`${FLASK_URL}delete_ortho`, params);
};

/**
 * Download an orthomosaic. Framework mode: returns presigned URL.
 */
export const downloadOrtho = async (params) => {
    if (BACKEND_MODE !== 'flask') {
        const { year, experiment, location, population, date, platform, sensor, fileName } = params;
        const filePath = `Processed/${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/${fileName || `${date}-RGB.tif`}`;
        const url = await getPresignedUrl(`gemini/${filePath}`);
        return { url, fileName: fileName || `${date}-RGB.tif` };
    }
    // Flask mode: return raw fetch response for blob handling
    const response = await fetch(`${FLASK_URL}download_ortho`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });
    if (!response.ok) throw new Error('Failed to download ortho');
    return response;
};

/**
 * Download plot orthomosaics as zip. Framework mode: download individual files.
 */
export const downloadPlotOrtho = async (params) => {
    if (BACKEND_MODE !== 'flask') {
        const { year, experiment, location, population, date, platform, sensor, agrowstitchDir } = params;
        const dirPath = `Processed/${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/${agrowstitchDir}`;
        const items = await fetchJson(`${FRAMEWORK_URL}files/list/gemini/${dirPath}`);
        const pngFiles = items.filter(f => (f.object_name || '').endsWith('.png'));
        const urls = [];
        for (const f of pngFiles) {
            const url = await getPresignedUrl(`gemini/${f.object_name}`);
            urls.push({ url, name: (f.object_name || '').split('/').pop() });
        }
        return { files: urls };
    }
    const response = await fetch(`${FLASK_URL}download_plot_ortho`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
    });
    if (!response.ok) throw new Error('Failed to download plot ortho');
    return response;
};

/**
 * Download a single plot image.
 */
export const downloadSinglePlot = async (params) => {
    if (BACKEND_MODE !== 'flask') {
        const filePath = params.filePath || params.path || '';
        const url = await getPresignedUrl(`gemini/${filePath}`);
        return { url };
    }
    return postJson(`${FLASK_URL}download_single_plot`, params);
};

/**
 * Remove images (move to Removed/ directory).
 */
export const removeImages = async (payload) => {
    if (BACKEND_MODE !== 'flask') {
        // In MinIO, "move" = copy + delete. For each file, download and re-upload to Removed/ path.
        const { files, directory } = payload;
        const removedDir = directory.replace('/Images', '/Removed');
        for (const fileName of files) {
            const srcPath = `${directory}/${fileName}`;
            const dstPath = `${removedDir}/${fileName}`;
            // Copy via download + upload
            const srcUrl = `${FRAMEWORK_URL}files/download/gemini/${srcPath}`;
            const fileData = await fetch(srcUrl);
            if (fileData.ok) {
                const blob = await fileData.blob();
                const formData = new FormData();
                formData.append('file', blob, fileName);
                formData.append('bucket_name', STORAGE_BUCKET);
                formData.append('object_name', dstPath);
                await fetch(`${FRAMEWORK_URL}files/upload`, {
                    method: 'POST',
                    body: formData,
                });
                await fetch(`${FRAMEWORK_URL}files/delete/gemini/${srcPath}`, { method: 'DELETE' });
            }
        }
        return { status: 'ok', moved: files.length };
    }
    return postJson(`${FLASK_URL}remove_images`, payload);
};

/**
 * Restore images (move from Removed/ back to Images/).
 */
export const restoreImages = async (payload) => {
    if (BACKEND_MODE !== 'flask') {
        const { files, directory } = payload;
        const imagesDir = directory.replace('/Removed', '/Images');
        for (const fileName of files) {
            const srcPath = `${directory}/${fileName}`;
            const dstPath = `${imagesDir}/${fileName}`;
            const srcUrl = `${FRAMEWORK_URL}files/download/gemini/${srcPath}`;
            const fileData = await fetch(srcUrl);
            if (fileData.ok) {
                const blob = await fileData.blob();
                const formData = new FormData();
                formData.append('file', blob, fileName);
                formData.append('bucket_name', STORAGE_BUCKET);
                formData.append('object_name', dstPath);
                await fetch(`${FRAMEWORK_URL}files/upload`, {
                    method: 'POST',
                    body: formData,
                });
                await fetch(`${FRAMEWORK_URL}files/delete/gemini/${srcPath}`, { method: 'DELETE' });
            }
        }
        return { status: 'ok', restored: files.length };
    }
    return postJson(`${FLASK_URL}restore_images`, payload);
};

/**
 * Get orthomosaic metadata. Framework mode: try to read metadata JSON from MinIO.
 */
export const getOrthoMetadata = async (params) => {
    if (BACKEND_MODE !== 'flask') {
        const { year, experiment, location, population, date, platform, sensor, fileName } = params;
        const metadataPath = `Processed/${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/${fileName}.metadata.json`;
        try {
            const data = await fetchJson(`${FRAMEWORK_URL}files/download/gemini/${metadataPath}`);
            return data;
        } catch (_) {
            return { quality: 'N/A', timestamp: 'N/A' };
        }
    }
    const qs = new URLSearchParams(params).toString();
    return fetchJson(`${FLASK_URL}get_ortho_metadata?${qs}`);
};
