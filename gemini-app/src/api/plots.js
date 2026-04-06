/**
 * Plot geometry operations API (used by GroundPlotMarker).
 *
 * Flask mode: calls Flask endpoints directly.
 * Framework mode: calls the plot_geometry controller endpoints.
 */

import { postJson } from './client';
import { BACKEND_MODE, FLASK_URL, FRAMEWORK_URL } from './config';

export const getPlotData = (params) => {
    if (BACKEND_MODE === 'flask') return postJson(`${FLASK_URL}get_plot_data`, params);
    return postJson(`${FRAMEWORK_URL}plot_geometry/data`, params);
};

export const getImagePlotIndex = (params) => {
    if (BACKEND_MODE === 'flask') return postJson(`${FLASK_URL}get_image_plot_index`, params);
    return postJson(`${FRAMEWORK_URL}plot_geometry/image_plot_index`, params);
};

export const getGpsData = (params) => {
    if (BACKEND_MODE === 'flask') return postJson(`${FLASK_URL}get_gps_data`, params);
    return postJson(`${FRAMEWORK_URL}plot_geometry/gps_data`, params);
};

export const getStitchDirection = (params) => {
    if (BACKEND_MODE === 'flask') return postJson(`${FLASK_URL}get_stitch_direction`, params);
    return postJson(`${FRAMEWORK_URL}plot_geometry/stitch_direction`, params);
};

export const getGpsReference = (params) => {
    if (BACKEND_MODE === 'flask') return postJson(`${FLASK_URL}get_gps_reference`, params);
    return postJson(`${FRAMEWORK_URL}plot_geometry/gps_reference`, params);
};

export const setGpsReference = (params) => {
    if (BACKEND_MODE === 'flask') return postJson(`${FLASK_URL}set_gps_reference`, params);
    return postJson(`${FRAMEWORK_URL}plot_geometry/set_gps_reference`, params);
};

export const shiftGps = (params) => {
    if (BACKEND_MODE === 'flask') return postJson(`${FLASK_URL}shift_gps`, params);
    return postJson(`${FRAMEWORK_URL}plot_geometry/shift_gps`, params);
};

export const undoGpsShift = (params) => {
    if (BACKEND_MODE === 'flask') return postJson(`${FLASK_URL}undo_gps_shift`, params);
    return postJson(`${FRAMEWORK_URL}plot_geometry/undo_gps_shift`, params);
};

export const checkGpsShiftStatus = (params) => {
    if (BACKEND_MODE === 'flask') return postJson(`${FLASK_URL}check_gps_shift_status`, params);
    return postJson(`${FRAMEWORK_URL}plot_geometry/gps_shift_status`, params);
};

export const markPlot = (params) => {
    if (BACKEND_MODE === 'flask') return postJson(`${FLASK_URL}mark_plot`, params);
    return postJson(`${FRAMEWORK_URL}plot_geometry/mark`, params);
};

export const deletePlot = (params) => {
    if (BACKEND_MODE === 'flask') return postJson(`${FLASK_URL}delete_plot`, params);
    return postJson(`${FRAMEWORK_URL}plot_geometry/delete`, params);
};

export const saveStitchMask = (params) => {
    if (BACKEND_MODE === 'flask') return postJson(`${FLASK_URL}save_stitch_mask`, params);
    return postJson(`${FRAMEWORK_URL}plot_geometry/stitch_mask/save`, params);
};

export const getStitchMaskData = (params) => {
    if (BACKEND_MODE === 'flask') return postJson(`${FLASK_URL}get_stitch_mask_data`, params);
    return postJson(`${FRAMEWORK_URL}plot_geometry/stitch_mask/check`, params);
};

export const getMaxPlotIndex = (params) => {
    if (BACKEND_MODE === 'flask') return postJson(`${FLASK_URL}get_max_plot_index`, params);
    return postJson(`${FRAMEWORK_URL}plot_geometry/max_index`, params);
};

export const getAgrowstitchPlotAssociations = (params) => {
    if (BACKEND_MODE === 'flask') return postJson(`${FLASK_URL}get_agrowstitch_plot_associations`, params);
    return postJson(`${FRAMEWORK_URL}plot_geometry/associations`, params);
};

export const associatePlotsWithBoundaries = (params) => {
    if (BACKEND_MODE === 'flask') return postJson(`${FLASK_URL}associate_plots_with_boundaries`, params);
    return postJson(`${FRAMEWORK_URL}plot_geometry/associate`, params);
};
