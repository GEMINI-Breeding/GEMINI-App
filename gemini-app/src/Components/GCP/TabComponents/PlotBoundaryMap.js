import { useState } from "react";
import DeckGL from "@deck.gl/react";
import { Map } from "react-map-gl";
import { EditableGeoJsonLayer, TranslateMode } from "nebula.gl";
import { useDataState } from '../../../DataContext';

const fc = {
  type: "FeatureCollection",
  features: []
};

function PlotBoundaryMap() {

  const {
    viewState
  } = useDataState();

  console.log("initialViewState: ", viewState)
  const [featureCollection, setFetureCollection] = useState(fc);
  const [selectedFeIndex, setSelectedFeIndex] = useState(0);

  const selectedFeatureIndexes = [selectedFeIndex]; //[...Array(featureCollection.features.length).keys()]

  const layer = new EditableGeoJsonLayer({
    data: featureCollection,
    mode: TranslateMode,
    pickable: true,
    selectedFeatureIndexes: selectedFeatureIndexes,
    autoHighlight: true,
    onClick: (info, event) => {
      setSelectedFeIndex(info.index);
    },
    onEdit: ({ updatedData }) => {
      console.log("onEdit: ", updatedData);
      setFetureCollection(updatedData);
    }
  });

  console.log("layer: ", layer);

  return (
    <div style={{ height: '70vh', width: '70vw', position: 'relative' }}>
      <DeckGL
        initialViewState={viewState}
        controller={{ doubleClickZoom: false }}
        layers={[layer]}
      >
        <Map
          mapStyle={"mapbox://styles/mapbox/satellite-v9"}
          mapboxAccessToken={"pk.eyJ1IjoibWFzb25lYXJsZXMiLCJhIjoiY2xkeXR3bXNyMG5heDNucHJhYWFscnZnbyJ9.A03O6PN1N1u771c4Qqg1SA"}
        />
      </DeckGL>
    </div>
  );
};
export default PlotBoundaryMap;