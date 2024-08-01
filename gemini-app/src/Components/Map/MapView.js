import React, { useEffect, useRef } from "react";
import DeckGL from "@deck.gl/react";
import { Map as MapGL } from "react-map-gl";
import { BitmapLayer, GeoJsonLayer } from "@deck.gl/layers";
import { TileLayer } from "@deck.gl/geo-layers";
import { FlyToInterpolator } from "@deck.gl/core";
import SplitButton from "../Util/SplitButton";

import { useDataSetters, useDataState } from "../../DataContext";
import useTraitsColorMap from "./ColorMap";
import GeoJsonTooltip from "./ToolTip";
import useExtentFromBounds from "./MapHooks";
import ColorMapLegend from "./ColorMapLegend";

import useTrackComponent from "../../useTrackComponent";

function geojsonToCSV(geojson) {
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
                return feature.properties[header] ? `"${feature.properties[header]}"` : "";
            })
            .join(",");
        csvString += row + "\n";
    });

    return csvString;
}

function downloadCSV(csvString, filename = "data.csv") {
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

export default function MapView() {
    useTrackComponent("MapView");

    const INITIAL_TILE_URL =
        "http://127.0.0.1:8091/cog/tiles/WebMercatorQuad/{z}/{x}/{y}?scale=1&url=${FILE_PATH}&unscale=false&resampling=nearest&return_mask=true";
    const INITIAL_BOUNDS_URL = "http://127.0.0.1:8091/cog/bounds?url=${FILE_PATH}";

    const {
        viewState,
        selectedTilePath,
        selectedTraitsGeoJsonPath,
        hoverInfo,
        selectedMetric,
        isLoadingColorScale,
        geojsonData,
        selectedGenotypes,
        flaskUrl,
        tileUrl,
        boundsUrl,
    } = useDataState();

    const { setViewState, setHoverInfo, setIsLoadingColorScale, setGeojsonData, setTileUrl, setBoundsUrl } =
        useDataSetters();
    const selectedMetricRef = useRef(selectedMetric);

    const { colorScale, lowerPercentileValue, upperPercentileValue } = useTraitsColorMap(
        selectedTraitsGeoJsonPath,
        selectedMetric,
        setIsLoadingColorScale
    );

    useEffect(() => {
        selectedMetricRef.current = selectedMetric;
    }, [selectedMetric]);

    useEffect(() => {
        if (selectedTilePath) {
            setTileUrl(INITIAL_TILE_URL.replace("${FILE_PATH}", encodeURIComponent(`${flaskUrl}${selectedTilePath}`)));
            setBoundsUrl(
                INITIAL_BOUNDS_URL.replace("${FILE_PATH}", encodeURIComponent(`${flaskUrl}${selectedTilePath}`))
            );
        } else {
            // Reset to initial state
            setTileUrl(INITIAL_TILE_URL);
            setBoundsUrl(INITIAL_BOUNDS_URL);
        }
    }, [selectedTilePath]);

    const extentBounds = useExtentFromBounds(boundsUrl);

    useEffect(() => {
        console.log("extentBounds changed");
        if (extentBounds) {
            const [minLon, minLat, maxLon, maxLat] = extentBounds;
            const longitude = (minLon + maxLon) / 2;
            const latitude = (minLat + maxLat) / 2;

            // Width and height of the current view in pixels
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            // Map extents in degrees
            const mapLngDelta = maxLon - minLon;
            const mapLatDelta = maxLat - minLat;

            // Calculate zoom level
            let zoomLng = Math.floor(Math.log((viewportWidth * 360) / mapLngDelta) / Math.log(2));
            let zoomLat = Math.floor(Math.log((viewportHeight * 360) / mapLatDelta) / Math.log(2));

            const zoom = Math.min(zoomLng, zoomLat) - 9.5;

            setViewState((prevViewState) => ({
                ...prevViewState,
                longitude,
                latitude,
                zoom,
                transitionDuration: 1000, // 1 second transition
                transitionInterpolator: new FlyToInterpolator(),
            }));
        }
    }, [extentBounds]);

    const orthoTileLayer = tileUrl.includes("FILE_PATH")
        ? null
        : new TileLayer({
              id: "geotiff-tile-layer",
              minZoom: 15,
              maxZoom: 22,
              tileSize: 256,
              data: tileUrl,
              renderSubLayers: (props) => {
                  const {
                      bbox: { west, south, east, north },
                  } = props.tile;

                  return new BitmapLayer(props, {
                      data: null,
                      image: props.data,
                      bounds: [west, south, east, north],
                  });
              },
          });

    // This should be moved out to a separate data component (I think)
    useEffect(() => {
        if (selectedTraitsGeoJsonPath) {
            fetch(selectedTraitsGeoJsonPath)
                .then((response) => response.json())
                .then((data) => setGeojsonData(data))
                .catch((error) => console.error("Error fetching geojson:", error));
        }
    }, [selectedTraitsGeoJsonPath]);

    //
    const filteredGeoJsonData = React.useMemo(() => {
        if (geojsonData && selectedGenotypes) {
            // Return original data if "All Genotypes" is selected
            if (selectedGenotypes.includes("All Genotypes")) {
                return geojsonData;
            }

            const filteredFeatures = geojsonData.features.filter((feature) =>
                selectedGenotypes.includes(feature.properties.accession)
            );

            return {
                ...geojsonData,
                features: filteredFeatures,
            };
        }
        return geojsonData;
    }, [geojsonData, selectedGenotypes]);

    const traitsGeoJsonLayer = React.useMemo(() => {
        if (selectedTraitsGeoJsonPath) {
            // Check if selectedTraitsGeoJsonPath exists
            return new GeoJsonLayer({
                id: isLoadingColorScale
                    ? `traits-geojson-layer-loading`
                    : `traits-geojson-layer-${selectedMetric}-${colorScale}`,
                data: filteredGeoJsonData,
                filled: true,
                getFillColor: (d) => {
                    if (colorScale) {
                        const value = d.properties[selectedMetricRef.current];
                        const color = colorScale(value);
                        return color;
                    } else {
                        return [160, 160, 180, 200];
                    }
                },
                stroked: false,
                pickable: true,
                onHover: (info) => setHoverInfo(info),
            });
        }
        return null; // Return null or any default value when selectedTraitsGeoJsonPath doesn't exist
    }, [selectedTraitsGeoJsonPath, colorScale, selectedMetric, isLoadingColorScale, viewState, selectedGenotypes]);

    const handleDownloadFilteredCSV = () => {
        const csvString = geojsonToCSV(filteredGeoJsonData);
        downloadCSV(csvString, "traits.csv");
    };

    const handleDownloadAllCSV = () => {
        const csvString = geojsonToCSV(geojsonData);
        downloadCSV(csvString, "traits.csv");
    };

    const buttonOptions = [
        { text: "Download Filtered CSV", action: handleDownloadFilteredCSV },
        { text: "Download All CSV", action: handleDownloadAllCSV },
    ];

    return (
        <React.Fragment>
            <DeckGL
                viewState={viewState}
                controller={{
                    scrollZoom: { speed: 1.0, smooth: true },
                }}
                layers={[orthoTileLayer, traitsGeoJsonLayer]}
                onViewStateChange={({ viewState }) => setViewState(viewState)}
            >
                <MapGL
                    mapStyle="mapbox://styles/mapbox/satellite-v9"
                    mapboxAccessToken={
                        "pk.eyJ1IjoibWFzb25lYXJsZXMiLCJhIjoiY2xkeXR3bXNyMG5heDNucHJhYWFscnZnbyJ9.A03O6PN1N1u771c4Qqg1SA"
                    }
                />
            </DeckGL>
            <GeoJsonTooltip hoverInfo={hoverInfo} selectedMetric={selectedMetric} />
            {colorScale && (
                <ColorMapLegend
                    colorScale={colorScale}
                    lowerPercentileValue={lowerPercentileValue}
                    upperPercentileValue={upperPercentileValue}
                    selectedMetric={selectedMetric}
                />
            )}
            <SplitButton
                buttonOptions={buttonOptions}
                style={{ position: "relative", bottom: "20px", right: "20px" }}
            />
        </React.Fragment>
    );
}
