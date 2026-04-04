/**
 * Base HTTP client for backend API calls.
 * Provides fetch wrappers with error handling and JSON parsing.
 */

/**
 * GET request returning parsed JSON.
 */
export const fetchJson = async (url, options = {}) => {
    const response = await fetch(url, options);
    if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`API error ${response.status}: ${errorText}`);
    }
    return response.json();
};

/**
 * POST request with JSON body, returning parsed JSON.
 */
export const postJson = async (url, body, options = {}) => {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        body: JSON.stringify(body),
        ...options,
    });
    if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`API error ${response.status}: ${errorText}`);
    }
    return response.json();
};

/**
 * POST request with FormData (for file uploads), returning parsed JSON.
 */
export const postFormData = async (url, formData, options = {}) => {
    const response = await fetch(url, {
        method: 'POST',
        body: formData,
        ...options,
    });
    if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`API error ${response.status}: ${errorText}`);
    }
    return response.json();
};
