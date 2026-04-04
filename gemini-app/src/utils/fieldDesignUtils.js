/**
 * Pure utility functions for field design calculations.
 */

export function calculateMaxMinusMin(data, field) {
    const values = data.map((row) => row[field]).filter((val) => val != null);
    return Math.max(...values) - Math.min(...values) + 1;
}

export function convertToMeters(value, unit) {
    return unit === "feet" ? value * 0.3048 : value;
}
