// App.js

import React, { useState, useEffect, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { Map as MapGL } from 'react-map-gl';
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers';
import { TileLayer } from '@deck.gl/geo-layers';
import { FlyToInterpolator } from '@deck.gl/core';
import { scaleLinear } from 'd3-scale';

import CollapsibleSidebar from './Components/Menu/CollapsibleSidebar';
import useTraitsColorMap from './Components/Map/ColorMap';
import GeoJsonTooltip from './Components/Map/ToolTip';
import useExtentFromBounds from './Components/Map/MapHooks';
import ColorMapLegend from './Components/Map/ColorMapLegend';

// Initial tile server URL and path
const TILE_URL_TEMPLATE = 'http://127.0.0.1:8090/cog/tiles/WebMercatorQuad/{z}/{x}/{y}?scale=1&url=${FILE_PATH}&unscale=false&resampling=nearest&return_mask=true';
const BOUNDS_URL_TEMPLATE = 'http://127.0.0.1:8090/cog/bounds?url=${FILE_PATH}';

const initialViewState = {
  longitude: -121.781381,
  latitude: 38.535257,
  zoom: 17,
  pitch: 0,
  bearing: 0,
};

function App() {
  const [viewState, setViewState] = useState(initialViewState);
  const [selectedTilePath, setSelectedTilePath] = useState('');
  const [selectedTraitsGeoJsonPath, setSelectedTraitsGeoJsonPath] = useState('');
  const [hoverInfo, setHoverInfo] = useState(null);
  const [selectedMetric, setSelectedMetric] = useState(null);
  const [isLoadingColorScale, setIsLoadingColorScale] = useState(false);

  const selectedMetricRef = useRef(selectedMetric);

  const { colorScale, lowerPercentileValue, upperPercentileValue } = useTraitsColorMap(selectedTraitsGeoJsonPath, selectedMetric, setIsLoadingColorScale);

  useEffect(() => {
    selectedMetricRef.current = selectedMetric;
  }, [selectedMetric]);

  const tileUrl = TILE_URL_TEMPLATE.replace('${FILE_PATH}', encodeURIComponent(`http://127.0.0.1:5000${selectedTilePath}`));
  const boundsUrl = BOUNDS_URL_TEMPLATE.replace('${FILE_PATH}', encodeURIComponent(`http://127.0.0.1:5000${selectedTilePath}`));
  const extentBounds = useExtentFromBounds(boundsUrl);
  
  useEffect(() => {
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
      console.log('zoom', zoom)
  
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


  const traitsGeoJsonLayer = React.useMemo(() => new GeoJsonLayer({
    id: isLoadingColorScale ? `traits-geojson-layer-loading` : `traits-geojson-layer-${selectedMetric}-${colorScale}`,
    data: selectedTraitsGeoJsonPath,
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
  }), [selectedTraitsGeoJsonPath, colorScale, selectedMetric, isLoadingColorScale]);

  const sidebar = CollapsibleSidebar({
    onTilePathChange: setSelectedTilePath,
    onGeoJsonPathChange: setSelectedTraitsGeoJsonPath,
    selectedMetric: selectedMetric,
    setSelectedMetric: setSelectedMetric
  });
  
  // Choose what to render based on the `currentView` state
  const contentView = (() => {
    switch (sidebar.currentView) {
      case 0:
        return (
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
        );
      case 1:
        return <div>Placeholder for view 1</div>;
      default:
        return null;
    }
  })();
  

  return (
    <div className="App">

      {contentView}

      {sidebar.jsx}

      <GeoJsonTooltip 
        hoverInfo={hoverInfo} 
        selectedMetric={selectedMetric}
      />

      {/* <CollapsibleSidebar 
        onTilePathChange={setSelectedTilePath} 
        onGeoJsonPathChange={setSelectedTraitsGeoJsonPath}
        selectedMetric={selectedMetric}
        setSelectedMetric={setSelectedMetric}
      /> */}

      {colorScale && 
        <ColorMapLegend 
          colorScale={colorScale}
          lowerPercentileValue={lowerPercentileValue}
          upperPercentileValue={upperPercentileValue}
          selectedMetric={selectedMetric}
        />
      }

    </div>
  );
}

export default App;
