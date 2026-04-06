/**
 * File management API calls.
 * Uses the gemini-framework (MinIO) backend.
 */

import { fetchJson, postJson, postFormData } from './client';
import { FRAMEWORK_URL, STORAGE_BUCKET } from './config';

// -- Directory listing --

/**
 * List subdirectories at a path. Returns array of directory name strings.
 * Queries MinIO via files/list and extracts unique directory prefixes.
 */
export const listDirs = async (dirPath) => {
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
};

/**
 * List files at a path. Returns array of filename strings.
 * Queries MinIO via files/list and extracts leaf filenames.
 */
export const listFiles = async (dirPath) => {
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
};

export const listDirsNested = () =>
    fetchJson(`${FRAMEWORK_URL}files/list_nested`);

export const listDirsNestedProcessed = () =>
    fetchJson(`${FRAMEWORK_URL}files/list_nested_processed`);

// -- File serving --

export const getFileUrl = (filePath) =>
    `${FRAMEWORK_URL}files/download/${filePath}`;

export const getImageUrl = (filePath) =>
    `${FRAMEWORK_URL}files/download/${filePath}`;

/**
 * Get a presigned URL for direct MinIO access.
 */
export const getPresignedUrl = async (filePath) => {
    const data = await fetchJson(`${FRAMEWORK_URL}files/presign/${filePath}`);
    return data.url;
};

/**
 * Build a file URL suitable for TiTiler tile requests.
 * Returns an S3 path (s3://bucket/object) for direct MinIO access.
 */
export const getTileFileUrl = (filePath) => {
    const objectPath = filePath.replace(/^files\//, '');
    return `s3://${STORAGE_BUCKET}/${objectPath}`;
};

export const fetchDataRootDir = () =>
    fetchJson(`${FRAMEWORK_URL}fetch_data_root_dir`);

// -- Upload --

export const uploadFile = (formData) =>
    postFormData(`${FRAMEWORK_URL}upload`, formData);

export const uploadChunk = (formData) =>
    postFormData(`${FRAMEWORK_URL}upload_chunk`, formData);

export const checkFiles = (body) =>
    postJson(`${FRAMEWORK_URL}check_files`, body);

export const checkUploadedChunks = (body) =>
    postJson(`${FRAMEWORK_URL}check_uploaded_chunks`, body);

export const clearUploadDir = (body) =>
    postJson(`${FRAMEWORK_URL}clear_upload_dir`, body);

export const clearUploadCache = (body) =>
    postJson(`${FRAMEWORK_URL}clear_upload_cache`, body);

// -- File operations --

/**
 * Delete files from MinIO.
 */
export const deleteFiles = async (body) => {
    const path = body.path || body.dirPath || '';
    const response = await fetch(`${FRAMEWORK_URL}files/delete/gemini/${path}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`Delete failed: ${errorText}`);
    }
    return { status: 'deleted' };
};

/**
 * Convert TIF to PNG. Submit TIF_TO_PNG job.
 * Returns the job response (caller should poll for completion) or the PNG data.
 */
export const getTifToPng = async (body) => {
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
};

/**
 * Get PNG file URL/data. Serve via download endpoint.
 */
export const getPngFile = (body) => {
    const filePath = body.filePath || body.path || '';
    return Promise.resolve({ url: `${FRAMEWORK_URL}files/download/gemini/${filePath}` });
};

// -- Ortho-specific operations --

/**
 * Delete an orthomosaic file or AgRowStitch directory from storage.
 */
export const deleteOrtho = async (params) => {
    const { year, experiment, location, population, date, platform, sensor, fileName, agrowstitchDir, deleteType } = params;
    const basePath = `Processed/${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}`;
    const targetPath = deleteType === 'agrowstitch' ? `${basePath}/${agrowstitchDir}` : `${basePath}/${fileName}`;
    // Delete all files under this prefix
    const items = await fetchJson(`${FRAMEWORK_URL}files/list/gemini/${targetPath}`);
    for (const item of items) {
        await fetch(`${FRAMEWORK_URL}files/delete/gemini/${item.object_name}`, { method: 'DELETE' });
    }
    return { status: 'deleted' };
};

/**
 * Download an orthomosaic. Returns presigned URL.
 */
export const downloadOrtho = async (params) => {
    const { year, experiment, location, population, date, platform, sensor, fileName } = params;
    const filePath = `Processed/${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/${fileName || `${date}-RGB.tif`}`;
    const url = await getPresignedUrl(`gemini/${filePath}`);
    return { url, fileName: fileName || `${date}-RGB.tif` };
};

/**
 * Download plot orthomosaics. Returns individual file URLs.
 */
export const downloadPlotOrtho = async (params) => {
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
};

/**
 * Download a single plot image.
 */
export const downloadSinglePlot = async (params) => {
    const filePath = params.filePath || params.path || '';
    const url = await getPresignedUrl(`gemini/${filePath}`);
    return { url };
};

/**
 * Remove images (move to Removed/ directory).
 */
export const removeImages = async (payload) => {
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
};

/**
 * Restore images (move from Removed/ back to Images/).
 */
export const restoreImages = async (payload) => {
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
};

// -- Check labels (annotation file listing) --

/**
 * Check if label/annotation files exist at a path. Returns array of filenames.
 */
export const checkLabels = async (dirPath) => {
    try {
        const items = await fetchJson(`${FRAMEWORK_URL}files/list/gemini/${dirPath}`);
        const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
        const fileNames = [];
        for (const item of items) {
            const objectName = item.object_name || '';
            const relative = objectName.startsWith(prefix)
                ? objectName.slice(prefix.length)
                : objectName.split('/').pop();
            if (relative && !relative.includes('/')) {
                fileNames.push(relative);
            }
        }
        return fileNames;
    } catch (_) {
        return [];
    }
};

// -- Check runs (training/locate run directories) --

/**
 * Check runs/files at a given path. Returns a dict of subdirectories
 * with their contents by listing MinIO objects.
 */
export const checkRuns = async (dirPath) => {
    try {
        const items = await fetchJson(`${FRAMEWORK_URL}files/list/gemini/${dirPath}`);
        const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
        const result = {};
        for (const item of items) {
            const objectName = item.object_name || '';
            const relative = objectName.startsWith(prefix)
                ? objectName.slice(prefix.length)
                : objectName.split('/').pop();
            const parts = relative.split('/');
            if (parts.length >= 1 && parts[0]) {
                const dirName = parts[0];
                if (!result[dirName]) {
                    result[dirName] = [];
                }
                if (parts.length > 1) {
                    result[dirName].push(parts.slice(1).join('/'));
                }
            }
        }
        return result;
    } catch (_) {
        return {};
    }
};

// -- Directory management --

/**
 * Check if the data directory is accessible.
 * Checks if the MinIO bucket exists.
 */
export const checkDataDir = async () => {
    try {
        await fetchJson(`${FRAMEWORK_URL}files/list/gemini/`);
        return { exists: true };
    } catch (_) {
        return { exists: false };
    }
};

/**
 * Browse for a data directory.
 * Not applicable with MinIO (no directory picker).
 */
export const browseDataDir = () =>
    Promise.resolve({ path: '' });

/**
 * Create a data directory.
 * MinIO bucket is created at deployment; no-op.
 */
export const createDataDir = async () =>
    ({ status: 'ok' });

// -- Data management --

/**
 * Get binary report for an extracted dataset.
 * Returns the report as a text string.
 */
export const getBinaryReport = async (params) => {
    // Read report JSON from MinIO
    const { year, experiment, location, population, date, platform, sensor } = params;
    const reportPath = `Intermediate/${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/binary_report.json`;
    return fetchJson(`${FRAMEWORK_URL}files/download/gemini/${reportPath}`).catch(() => null);
};

/**
 * Download Amiga-format images as a zip.
 */
export const downloadAmigaImages = async (params) =>
    postJson(`${FRAMEWORK_URL}files/download_amiga`, params);

/**
 * Update dataset metadata (rename, edit).
 */
export const updateData = (params) =>
    postJson(`${FRAMEWORK_URL}datasets/update_metadata`, params);

/**
 * View synced data (msgs_synced.csv contents).
 */
export const viewSyncedData = async (params) => {
    const { year, experiment, location, population, date, platform, sensor } = params;
    const csvPath = `Raw/${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/msgs_synced.csv`;
    try {
        const response = await fetch(`${FRAMEWORK_URL}files/download/gemini/${csvPath}`);
        if (response.ok) {
            const text = await response.text();
            return { csv: text };
        }
        return { csv: '' };
    } catch (_) {
        return { csv: '' };
    }
};

/**
 * Get orthomosaic metadata. Try to read metadata JSON from MinIO.
 */
export const getOrthoMetadata = async (params) => {
    const { year, experiment, location, population, date, platform, sensor, fileName } = params;
    const metadataPath = `Processed/${year}/${experiment}/${location}/${population}/${date}/${platform}/${sensor}/${fileName}.metadata.json`;
    try {
        const data = await fetchJson(`${FRAMEWORK_URL}files/download/gemini/${metadataPath}`);
        return data;
    } catch (_) {
        return { quality: 'N/A', timestamp: 'N/A' };
    }
};
