//import React, { useEffect } from "react";

export function geojsonToCSV(geojson) {
    // Check if the GeoJSON has features
    if (!geojson || !geojson.features || !geojson.features.length) {
        return "";
    }

    // Extract header (property names)
    const headers = Object.keys(geojson.features[0].properties);
    let csvString = headers.join(",") + "\n"; // Create the header row

    // Iterate over features to extract properties and create rows
    geojson.features.forEach((feature) => {
        const row = headers
            .map((header) => {
                // Ensure value is present, else empty string
                return feature.properties[header] ? `${feature.properties[header]}` : "";
            })
            .join(",");
        csvString += row + "\n";
    });

    return csvString;
}

export function downloadCSV(csvString, filename = "data.csv") {
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Build a CSV from multiple geojson objects (or a single one) with normalization.
// geojsonList: array of GeoJSON objects
// options: { includePlatform: true, includeSourceDate: true, aggregateBy: 'Plot' }
export function tableBuilder(geojsonList, options = {}) {
    if (!geojsonList || geojsonList.length === 0) return "";

    // Normalize input to array of geojson objects
    const list = Array.isArray(geojsonList) ? geojsonList : [geojsonList];

    // mergedFeatures will be an array of feature objects with normalized properties
    const mergedFeatures = [];

    list.forEach((gjson, idx) => {
        if (!gjson || !gjson.features) return;

        // try to infer a source date or platform from top-level metadata if available
        const sourceMeta = gjson._source_meta || {};
        const sourceDate = sourceMeta.date || sourceMeta.source_date || null;
        const sourcePlatform = sourceMeta.platform || null;

        gjson.features.forEach((feature) => {
            const props = { ...(feature.properties || {}) };

            // If a property key contains '/', normalize it (same logic as in LoadTableModal normalization)
            Object.keys(props).forEach((k) => {
                if (k.includes('/')) {
                    const parts = k.split('/');
                    const modelPart = parts[0] || '';
                    const predCount = parts.length > 1 ? parts[1] : '';
                    const fieldName = parts.length > 2 ? parts.slice(2).join('/') : parts[parts.length - 1];
                    const platform = modelPart.split('-')[0] || modelPart;

                    // move to short name
                    props[fieldName] = props[k];
                    if (!props.platform) props.platform = platform;
                    if (!props.prediction_count) {
                        const n = parseInt(predCount, 10);
                        props.prediction_count = Number.isNaN(n) ? predCount : n;
                    }
                    delete props[k];
                }
            });

            // attach source meta if requested: normalize source_date -> date
            if (options.includeSourceDate && sourceDate) props.date = props.date || sourceDate;
            if (props.source_date && !props.date) props.date = props.source_date;
            // prefer sourcePlatform if provided
            if (options.includePlatform && sourcePlatform) props.source_platform = props.source_platform || sourcePlatform;

            mergedFeatures.push({ properties: props, geometry: feature.geometry });
        });
    });

    if (mergedFeatures.length === 0) return "";

    // Build full header set from union of all property keys in mergedFeatures
    const headerSet = new Set();
    mergedFeatures.forEach((f) => {
        Object.keys(f.properties || {}).forEach((k) => headerSet.add(k));
    });
    const headers = Array.from(headerSet);

    // Normalize properties across features before creating headers
    mergedFeatures.forEach((f) => {
        const p = f.properties || {};

        // prefer any existing source_date -> date
        if (p.source_date && !p.date) p.date = p.source_date;

        // unify flower-related columns into one 'flower_count' column (keep priority if multiple)
        const flowerKeys = Object.keys(p).filter(k => k.toLowerCase().includes('flower'));
        if (flowerKeys.length > 0) {
            // priority: closed_flower (case-insensitive) then exact 'Flower' then any
            let chosenKey = flowerKeys.find(k => k.toLowerCase() === 'closed_flower') || flowerKeys.find(k => k === 'Flower') || flowerKeys[0];
            const chosenVal = p[chosenKey];
            p['flower_count'] = chosenVal;
            // remove other flower keys
            flowerKeys.forEach(k => { if (k !== chosenKey) delete p[k]; });
            // remove original 'Flower' if present and not chosen
            if (p['Flower'] && chosenKey !== 'Flower') delete p['Flower'];
        }

        // build unified model string from platform/source_platform/prediction_count/versionName
        const platform = p.source_platform || p.platform || null;
        const pred = p.prediction_count !== undefined ? String(p.prediction_count) : null;
        const version = (f._source_meta && f._source_meta.versionName) || p.versionName || null;
        const parts = [];
        if (platform) parts.push(platform);
        if (pred) parts.push(pred);
        // include version if no platform info or as extra info
        if (version && !parts.includes(version)) parts.push(version);
        if (parts.length > 0) p.model = parts.join('/');

        // remove separate platform/prediction_count/source_platform/source_date keys from final output
        delete p.platform;
        delete p.source_platform;
        delete p.prediction_count;
        delete p.source_date;
    });

    // Recompute header set after normalization to reflect removals and unifications
    const headerSet2 = new Set();
    mergedFeatures.forEach((f) => Object.keys(f.properties || {}).forEach(k => headerSet2.add(k)));
    let hdrs = Array.from(headerSet2);

    // remove closed_flower variants entirely (we only expose 'Flower')
    hdrs = hdrs.filter(h => h.toLowerCase() !== 'closed_flower');

    // ensure date is first column
    const withoutModel = hdrs.filter(h => h !== 'model');
    const others = withoutModel.filter(h => h !== 'date');
    const finalHeaders = [];
    if (hdrs.includes('date')) finalHeaders.push('date');
    finalHeaders.push(...others);
    // ensure model is last
    if (!finalHeaders.includes('model')) finalHeaders.push('model');

    // Serialize CSV
    let csv = finalHeaders.join(',') + '\n';
    mergedFeatures.forEach((f) => {
        const row = finalHeaders.map((h) => {
            const v = f.properties[h];
            return v === undefined || v === null ? '' : `${v}`;
        }).join(',');
        csv += row + '\n';
    });

    return csv;
}
