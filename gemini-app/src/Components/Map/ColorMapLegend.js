import React from 'react';
import { scaleLinear } from 'd3-scale';
import { rgb } from 'd3-color';
import './ColorMapLegend.css';

const ColorMapLegend = ({ colorScale, lowerPercentileValue, upperPercentileValue, selectedMetric }) => {

  // Define quantile probabilities
  const probs = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0];

  // Calculate percentiles and corresponding colors
  const percentiles = probs.map(p => lowerPercentileValue + (p * (upperPercentileValue - lowerPercentileValue)));
  const colors = percentiles.map(value => {
    const [r, g, b] = colorScale(value);
    return rgb(r, g, b);
  });

  // Convert colors to CSS rgba strings
  const colorStrings = colors.map(color => color.toString());

  // Create the gradient string
  const linearGradientString = `linear-gradient(to right, ${colorStrings.join(',')})`;

  return (
    <div className="outer-container">
      <div className="colormap-container">
        <div className="colormap-legend">
          <div className="colormap-gradient-container">
            <div
              className="colormap-gradient"
              style={{
                background: linearGradientString,
              }}
            />
          </div>
          <div className="colormap-labels">
            {percentiles.map((value, index) => (
              <div key={index} className="colormap-label" style={{ left: `${probs[index] * 100}%` }}>
                {value.toFixed(1)}
              </div>
            ))}
          </div>
        </div>
        <div className="colormap-title">
          {selectedMetric}
        </div>
      </div>
    </div>
  );
};

export default ColorMapLegend;
