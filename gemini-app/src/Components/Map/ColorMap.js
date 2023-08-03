import { useState, useEffect } from 'react';
import { scaleLinear } from 'd3-scale';
import * as d3Array from 'd3-array';

function useTraitsColorMap(traitsGeoJsonPath, selectedMetric, setIsLoadingColorScale) {
  const [colorScale, setColorScale] = useState(null);
  const [lowerPercentileValue, setLowerPercentileValue] = useState(null);
  const [upperPercentileValue, setUpperPercentileValue] = useState(null);

  useEffect(() => {
    if (traitsGeoJsonPath !== '' && selectedMetric) {
      setIsLoadingColorScale(true);
      fetch(traitsGeoJsonPath)
        .then(response => response.json())
        .then(data => {
          if (data) {
            // Filter out null or undefined values
            const metricValues = data.features
              .map(f => f.properties[selectedMetric])
              .filter(f => f !== null && f !== undefined);

            // Sort metricValues array
            metricValues.sort((a, b) => a - b);

            // Compute 2nd and 98th percentile
            const lowerPercentileValue = d3Array.quantile(metricValues, 0.02);
            const upperPercentileValue = d3Array.quantile(metricValues, 0.98);

            setLowerPercentileValue(lowerPercentileValue);
            setUpperPercentileValue(upperPercentileValue);

            const scale = scaleLinear()
              .domain([lowerPercentileValue, upperPercentileValue])
              .range([
                [255, 0, 0], // red for min value
                [0, 0, 255]  // blue for max value
              ]);

            setColorScale(prevScale => {
              return scale;
            });
            setIsLoadingColorScale(false);
          }
        })
        .catch((error) => {
          console.error('Error fetching GeoJSON data:', error);
        });
    } else {
      setColorScale(null);
      setIsLoadingColorScale(false);
    }
  }, [traitsGeoJsonPath, selectedMetric]);
  return { colorScale, lowerPercentileValue, upperPercentileValue };
  ;
}

export default useTraitsColorMap;
