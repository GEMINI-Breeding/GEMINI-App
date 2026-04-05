/**
 * Plot geometry operations API (used by GroundPlotMarker).
 *
 * These operations require specialized backend endpoints for plot marking,
 * GPS manipulation, and stitch mask management. Framework backend endpoints
 * for these operations are not yet implemented — framework mode returns
 * a rejection to signal "not available."
 */

import { postJson } from './client';
import { BACKEND_MODE, FLASK_URL } from './config';

const frameworkNotAvailable = (operation) =>
    Promise.reject(new Error(`${operation} is not yet available in framework mode`));

export const getPlotData = (params) => {
    if (BACKEND_MODE !== 'flask') return frameworkNotAvailable('Plot data');
    return postJson(`${FLASK_URL}get_plot_data`, params);
};

export const getImagePlotIndex = (params) => {
    if (BACKEND_MODE !== 'flask') return frameworkNotAvailable('Image plot index');
    return postJson(`${FLASK_URL}get_image_plot_index`, params);
};

export const getGpsData = (params) => {
    if (BACKEND_MODE !== 'flask') return frameworkNotAvailable('GPS data');
    return postJson(`${FLASK_URL}get_gps_data`, params);
};

export const getStitchDirection = (params) => {
    if (BACKEND_MODE !== 'flask') return frameworkNotAvailable('Stitch direction');
    return postJson(`${FLASK_URL}get_stitch_direction`, params);
};

export const getGpsReference = (params) => {
    if (BACKEND_MODE !== 'flask') return frameworkNotAvailable('GPS reference');
    return postJson(`${FLASK_URL}get_gps_reference`, params);
};

export const setGpsReference = (params) => {
    if (BACKEND_MODE !== 'flask') return frameworkNotAvailable('Set GPS reference');
    return postJson(`${FLASK_URL}set_gps_reference`, params);
};

export const shiftGps = (params) => {
    if (BACKEND_MODE !== 'flask') return frameworkNotAvailable('GPS shift');
    return postJson(`${FLASK_URL}shift_gps`, params);
};

export const undoGpsShift = (params) => {
    if (BACKEND_MODE !== 'flask') return frameworkNotAvailable('Undo GPS shift');
    return postJson(`${FLASK_URL}undo_gps_shift`, params);
};

export const checkGpsShiftStatus = (params) => {
    if (BACKEND_MODE !== 'flask') return frameworkNotAvailable('GPS shift status');
    return postJson(`${FLASK_URL}check_gps_shift_status`, params);
};

export const markPlot = (params) => {
    if (BACKEND_MODE !== 'flask') return frameworkNotAvailable('Mark plot');
    return postJson(`${FLASK_URL}mark_plot`, params);
};

export const deletePlot = (params) => {
    if (BACKEND_MODE !== 'flask') return frameworkNotAvailable('Delete plot');
    return postJson(`${FLASK_URL}delete_plot`, params);
};

export const saveStitchMask = (params) => {
    if (BACKEND_MODE !== 'flask') return frameworkNotAvailable('Save stitch mask');
    return postJson(`${FLASK_URL}save_stitch_mask`, params);
};

export const getStitchMaskData = (params) => {
    if (BACKEND_MODE !== 'flask') return frameworkNotAvailable('Stitch mask data');
    return postJson(`${FLASK_URL}get_stitch_mask_data`, params);
};

export const getMaxPlotIndex = (params) => {
    if (BACKEND_MODE !== 'flask') return frameworkNotAvailable('Max plot index');
    return postJson(`${FLASK_URL}get_max_plot_index`, params);
};

export const getAgrowstitchPlotAssociations = (params) => {
    if (BACKEND_MODE !== 'flask') return frameworkNotAvailable('AgRowStitch plot associations');
    return postJson(`${FLASK_URL}get_agrowstitch_plot_associations`, params);
};

export const associatePlotsWithBoundaries = (params) => {
    if (BACKEND_MODE !== 'flask') return frameworkNotAvailable('Associate plots with boundaries');
    return postJson(`${FLASK_URL}associate_plots_with_boundaries`, params);
};
