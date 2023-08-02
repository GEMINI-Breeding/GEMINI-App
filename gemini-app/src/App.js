// App.js

import React, { useState, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { Map as MapGL } from 'react-map-gl';
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers';
import { TileLayer } from '@deck.gl/geo-layers';
import { FlyToInterpolator } from '@deck.gl/core';
import { scaleLinear } from 'd3-scale';

import CollapsibleSidebar from './Components/Menu/CollapsibleSidebar';
import TraitsColorMap from './Components/Map/ColorMap';
import GeoJsonTooltip from './Components/Map/ToolTip';
import useExtentFromBounds from './Components/Map/MapHooks';

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

  const colorScale = TraitsColorMap({ traitsGeoJsonPath: selectedTraitsGeoJsonPath });

  const tileUrl = TILE_URL_TEMPLATE.replace('${FILE_PATH}', encodeURIComponent(`http://127.0.0.1:5000${selectedTilePath}`));
  const boundsUrl = BOUNDS_URL_TEMPLATE.replace('${FILE_PATH}', encodeURIComponent(`http://127.0.0.1:5000${selectedTilePath}`));
  const extentBounds = useExtentFromBounds(boundsUrl);
  console.log('extentBounds', extentBounds)
  

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
  
      const zoom = Math.min(zoomLng, zoomLat) - 9;
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


  const traitsGeoJsonLayer = new GeoJsonLayer({
    id: 'traits-geojson-layer',
    data: selectedTraitsGeoJsonPath,
    filled: true,
    getFillColor: d => colorScale ? colorScale(d.properties.Height_95p_meters) : [160, 160, 180, 200],
    stroked: false,
    pickable: true,
    onHover: info => setHoverInfo(info),
  });  

  return (
    <div className="App">

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

      <GeoJsonTooltip hoverInfo={hoverInfo} />

      <CollapsibleSidebar 
        onTilePathChange={setSelectedTilePath} 
        onGeoJsonPathChange={setSelectedTraitsGeoJsonPath}
      />

    </div>
  );
}

export default App;
