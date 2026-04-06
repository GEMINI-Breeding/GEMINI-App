/**
 * Plot geometry operations API (used by GroundPlotMarker).
 *
 * Calls the plot_geometry controller endpoints on the framework backend.
 */

import { postJson } from './client';
import { FRAMEWORK_URL } from './config';

export const getPlotData = (params) =>
    postJson(`${FRAMEWORK_URL}plot_geometry/data`, params);

export const getImagePlotIndex = (params) =>
    postJson(`${FRAMEWORK_URL}plot_geometry/image_plot_index`, params);

export const getGpsData = (params) =>
    postJson(`${FRAMEWORK_URL}plot_geometry/gps_data`, params);

export const getStitchDirection = (params) =>
    postJson(`${FRAMEWORK_URL}plot_geometry/stitch_direction`, params);

export const getGpsReference = (params) =>
    postJson(`${FRAMEWORK_URL}plot_geometry/gps_reference`, params);

export const setGpsReference = (params) =>
    postJson(`${FRAMEWORK_URL}plot_geometry/set_gps_reference`, params);

export const shiftGps = (params) =>
    postJson(`${FRAMEWORK_URL}plot_geometry/shift_gps`, params);

export const undoGpsShift = (params) =>
    postJson(`${FRAMEWORK_URL}plot_geometry/undo_gps_shift`, params);

export const checkGpsShiftStatus = (params) =>
    postJson(`${FRAMEWORK_URL}plot_geometry/gps_shift_status`, params);

export const markPlot = (params) =>
    postJson(`${FRAMEWORK_URL}plot_geometry/mark`, params);

export const deletePlot = (params) =>
    postJson(`${FRAMEWORK_URL}plot_geometry/delete`, params);

export const saveStitchMask = (params) =>
    postJson(`${FRAMEWORK_URL}plot_geometry/stitch_mask/save`, params);

export const getStitchMaskData = (params) =>
    postJson(`${FRAMEWORK_URL}plot_geometry/stitch_mask/check`, params);

export const getMaxPlotIndex = (params) =>
    postJson(`${FRAMEWORK_URL}plot_geometry/max_index`, params);

export const getAgrowstitchPlotAssociations = (params) =>
    postJson(`${FRAMEWORK_URL}plot_geometry/associations`, params);

export const associatePlotsWithBoundaries = (params) =>
    postJson(`${FRAMEWORK_URL}plot_geometry/associate`, params);
