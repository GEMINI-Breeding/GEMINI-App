import { useState, useEffect } from 'react';
import { scaleLinear } from 'd3-scale';

function TraitsColorMap({ traitsGeoJsonPath }) {
  const [traitsGeoJsonData, setTraitsGeoJsonData] = useState(null);
  
  useEffect(() => {
    if (traitsGeoJsonPath !== '') {
      fetch(traitsGeoJsonPath)
        .then(response => response.json())
        .then(data => {
            setTraitsGeoJsonData(data);
        })
        .catch((error) => {
          console.error('Error fetching GeoJSON data:', error);
        });
    }
  }, [traitsGeoJsonPath]);

  const colorScale = traitsGeoJsonData ? scaleLinear()
    .domain([
      Math.min(...traitsGeoJsonData.features.map(f => f.properties.Height_95p_meters)),
      Math.max(...traitsGeoJsonData.features.map(f => f.properties.Height_95p_meters))
    ])
    .range([
      [255, 0, 0], // red for min height
      [0, 0, 255]  // green for max height
    ]) : null;

  return colorScale;
}

export default TraitsColorMap;