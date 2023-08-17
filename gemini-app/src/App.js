// App.js

import React, { useState, useEffect, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { Map as MapGL } from 'react-map-gl';
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers';
import { TileLayer } from '@deck.gl/geo-layers';
import { FlyToInterpolator } from '@deck.gl/core';
import { scaleLinear } from 'd3-scale';

import { DataProvider, useDataSetters, useDataState } from './DataContext';
import CollapsibleSidebar from './Components/Menu/CollapsibleSidebar';
import useTraitsColorMap from './Components/Map/ColorMap';
import GeoJsonTooltip from './Components/Map/ToolTip';
import useExtentFromBounds from './Components/Map/MapHooks';
import ColorMapLegend from './Components/Map/ColorMapLegend';

// Initial tile server URL and path
const TILE_URL_TEMPLATE = 'http://127.0.0.1:8090/cog/tiles/WebMercatorQuad/{z}/{x}/{y}?scale=1&url=${FILE_PATH}&unscale=false&resampling=nearest&return_mask=true';
const BOUNDS_URL_TEMPLATE = 'http://127.0.0.1:8090/cog/bounds?url=${FILE_PATH}';

function App() {

  // App state management; see DataContext.js
  const {
    viewState,
    selectedTilePath,
    selectedTraitsGeoJsonPath,
    hoverInfo,
    selectedMetric,
    isLoadingColorScale,
    currentView,
    selectedCsv,
    selectedImageFolder,
    radiusMeters,
    geojsonData,
    selectedGenotypes
  } = useDataState();

  const {
    setViewState,
    setSelectedTilePath,
    setSelectedTraitsGeoJsonPath,
    setHoverInfo,
    setSelectedMetric,
    setIsLoadingColorScale,
    setCurrentView,
    setSelectedCsv,
    setSelectedImageFolder,
    setRadiusMeters,
    setGeojsonData,
    setSelectedGenotypes
  } = useDataSetters();

  const selectedMetricRef = useRef(selectedMetric);

  const { colorScale, lowerPercentileValue, upperPercentileValue } = useTraitsColorMap(selectedTraitsGeoJsonPath, selectedMetric, setIsLoadingColorScale);

  useEffect(() => {
    selectedMetricRef.current = selectedMetric;
  }, [selectedMetric]);

  const tileUrl = TILE_URL_TEMPLATE.replace('${FILE_PATH}', encodeURIComponent(`http://127.0.0.1:5000${selectedTilePath}`));
  const boundsUrl = BOUNDS_URL_TEMPLATE.replace('${FILE_PATH}', encodeURIComponent(`http://127.0.0.1:5000${selectedTilePath}`));
  const extentBounds = useExtentFromBounds(boundsUrl);
  
  useEffect(() => {
    console.log('extentBounds changed')
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
      let zoomLng = Math.floor(Math.log(viewportWidth * 360 / mapLngDelta) / Math.log(2));
      let zoomLat = Math.floor(Math.log(viewportHeight * 360 / mapLatDelta) / Math.log(2));
  
      const zoom = Math.min(zoomLng, zoomLat) - 9.5;
  
      setViewState(prevViewState => ({
        ...prevViewState,
        longitude,
        latitude,
        zoom,
        transitionDuration: 1000, // 1 second transition
        transitionInterpolator: new FlyToInterpolator(),
      }));
    }
  }, [extentBounds]);
  

  const orthoTileLayer = new TileLayer({
    id: 'geotiff-tile-layer',
    minZoom: 15,
    maxZoom: 22,
    tileSize: 256,
    data: tileUrl,
    renderSubLayers: (props) => {
      const {
        bbox: { west, south, east, north }
      } = props.tile;

      return new BitmapLayer(props, {
        data: null,
        image: props.data,
        bounds: [west, south, east, north]
      });
    }
  });

  // This should be moved out to a separate data component (I think)
  useEffect(() => {
    if (selectedTraitsGeoJsonPath) {
      fetch(selectedTraitsGeoJsonPath)
        .then(response => response.json())
        .then(data => setGeojsonData(data))
        .catch(error => console.error('Error fetching geojson:', error));
    }
  }, [selectedTraitsGeoJsonPath]);

  // 
  const filteredGeoJsonData = React.useMemo(() => {
    if (geojsonData && selectedGenotypes) {
      // Return original data if "All Genotypes" is selected
      if (selectedGenotypes.includes("All Genotypes")) {
        return geojsonData;
      }
  
      const filteredFeatures = geojsonData.features.filter(
        feature => selectedGenotypes.includes(feature.properties.Label)
      );
      
      return {
        ...geojsonData,
        features: filteredFeatures
      };
    }
    return geojsonData;
  }, [geojsonData, selectedGenotypes]);
  

  const traitsGeoJsonLayer = React.useMemo(() => 
  new GeoJsonLayer({
    id: isLoadingColorScale ? `traits-geojson-layer-loading` : `traits-geojson-layer-${selectedMetric}-${colorScale}`,
    data: filteredGeoJsonData,
    filled: true,
    getFillColor: d => {
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
    onHover: info => setHoverInfo(info),
  }), [selectedTraitsGeoJsonPath, colorScale, selectedMetric, isLoadingColorScale, viewState, selectedGenotypes]);

  const sidebar = <CollapsibleSidebar 
                  onTilePathChange={setSelectedTilePath} 
                  onGeoJsonPathChange={setSelectedTraitsGeoJsonPath} 
                  selectedMetric={selectedMetric} 
                  setSelectedMetric={setSelectedMetric}
                  currentView={currentView}
                  setCurrentView={setCurrentView}
                  onCsvChange={setSelectedCsv}
                  onImageFolderChange={setSelectedImageFolder}
                  onRadiusChange={setRadiusMeters}
                   />;

  // Choose what to render based on the `currentView` state
  const contentView = (() => {
    switch (currentView) {
      case 0:
        return (
          <React.Fragment>
            <DeckGL
              viewState={viewState}
              controller={{
                  scrollZoom: {speed: 1.0, smooth: true}
              }}
              layers={[orthoTileLayer, traitsGeoJsonLayer]}
              onViewStateChange={({ viewState }) => setViewState(viewState)}
            >
              <MapGL
                mapStyle="mapbox://styles/mapbox/satellite-v9"
                mapboxAccessToken={"pk.eyJ1IjoibWFzb25lYXJsZXMiLCJhIjoiY2xkeXR3bXNyMG5heDNucHJhYWFscnZnbyJ9.A03O6PN1N1u771c4Qqg1SA"}
              />
            </DeckGL>
            <GeoJsonTooltip 
              hoverInfo={hoverInfo} 
              selectedMetric={selectedMetric}
            />
            {colorScale && 
              <ColorMapLegend 
                colorScale={colorScale}
                lowerPercentileValue={lowerPercentileValue}
                upperPercentileValue={upperPercentileValue}
                selectedMetric={selectedMetric}
              />
            }
          </React.Fragment>
        );
      case 1:
        return (
          <div style={{ 
            position: 'absolute', 
            top: '50%', 
            left: '50%', 
            transform: 'translate(-50%, -50%)', 
            color: 'black', 
            backgroundColor: 'white', 
            padding: '20px', 
            zIndex: '1000',
            fontSize: '24px'
        }}>
          Placeholder for Prep View
        </div>
        );
      case 2:
        return (
          <div style={{ 
            position: 'absolute', 
            top: '50%', 
            left: '50%', 
            transform: 'translate(-50%, -50%)', 
            color: 'black', 
            backgroundColor: 'white', 
            padding: '20px', 
            zIndex: '1000',
            fontSize: '24px'
        }}>
          Placeholder for Stats View
        </div>
        );
      default:
        return null;
    }
  })();

  

  return (
    <div className="App">
      <div className="sidebar">
        {sidebar}
      </div>

      <div className="content">
        {console.log('App Component is Rendering')}
        {contentView}
      </div>
    </div>
  );
}

export default App;
