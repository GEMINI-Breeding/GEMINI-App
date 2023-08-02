import React from 'react';

const GeoJsonTooltip = ({ hoverInfo }) => {
  return (
    hoverInfo && hoverInfo.object && (
      <div 
        style={{
          position: 'absolute', 
          zIndex: 1, 
          pointerEvents: 'none', 
          left: hoverInfo.x, 
          top: hoverInfo.y,
          backgroundColor: 'rgba(255, 255, 255, 0.8)', // semi-transparent white
          padding: '10px', // padding around text
          borderRadius: '5px', // rounded corners
          border: '1px solid #ccc', // light grey border
          color: '#333', // dark grey text
          fontFamily: 'Arial, sans-serif', // optional, to ensure consistent font across browsers
          lineHeight: '1.6', // optional, to adjust line spacing
        }}
      >
        <div style={{ marginBottom: '5px', display: 'flex', justifyContent: 'space-between'}}>
          <span style={{ marginRight: '5px' }}><b>Tier:</b> {hoverInfo.object.properties.Tier}</span>
          <span style={{ marginRight: '5px' }}><b>Bed:</b> {hoverInfo.object.properties.Bed}</span>
          <span style={{ marginRight: '5px' }}><b>Plot:</b> {hoverInfo.object.properties.Plot}</span>
        </div>
        <hr style={{borderTop: '1px solid #aaa', marginBottom: '5px'}} /> 
        <div><b>Height 95 pctl (m):</b> {hoverInfo.object.properties.Height_95p_meters.toFixed(2)}</div> 
      </div>
    )
  );
}

export default GeoJsonTooltip;
