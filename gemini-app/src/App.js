// App.js

import React, { useState, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { Map as MapGL } from 'react-map-gl';
import { BitmapLayer } from '@deck.gl/layers';
import { TileLayer } from '@deck.gl/geo-layers';

import CollapsibleSidebar from './Components/Menu/CollapsibleSidebar';

// Initial tile server URL and path
const TILE_URL_TEMPLATE = 'http://localhost:8090/cog/tiles/WebMercatorQuad/{z}/{x}/{y}?scale=1&url=${FILE_PATH}&unscale=false&resampling=nearest&return_mask=true';

const initialViewState = {
  longitude: -121.781381,
  latitude: 38.535257,
  zoom: 17,
  pitch: 0,
  bearing: 0,
};

function App() {
  const [viewState, setViewState] = useState(initialViewState);
  const [selectedTilePath, setSelectedTilePath] = useState('')

  const tileUrl = TILE_URL_TEMPLATE.replace('${FILE_PATH}', encodeURIComponent(`http://127.0.0.1:5000${selectedTilePath}`));

  const layer = new TileLayer({
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

  return (
    <div className="App">

      <DeckGL
        viewState={viewState}
        controller={{
            scrollZoom: {speed: 1.0, smooth: true}
        }}
        layers={[layer]}
        onViewStateChange={({ viewState }) => setViewState(viewState)}
      >

        <MapGL
          mapStyle="mapbox://styles/mapbox/satellite-v9"
          mapboxAccessToken={"pk.eyJ1IjoibWFzb25lYXJsZXMiLCJhIjoiY2xkeXR3bXNyMG5heDNucHJhYWFscnZnbyJ9.A03O6PN1N1u771c4Qqg1SA"}
        />

      </DeckGL>

      <CollapsibleSidebar 
        onTilePathChange={setSelectedTilePath} 
      />

    </div>
  );
}

export default App;
