// MapHooks.js

import { DataProvider, useDataSetters, useDataState } from '../../DataContext';

import { useState, useEffect } from 'react';

const useExtentFromBounds = (url) => {
  const [bounds, setBounds] = useState(null);

  useEffect(() => {
    const fetchBounds = async () => {
      try {
        const response = await fetch(url);
        const data = await response.json();
        setBounds(data.bounds);
      } catch (error) {
        console.error('Could not fetch bounds of GeoTIFF:', error);
      }
    };

    fetchBounds();
  }, [url]);

  return bounds;
};

export default useExtentFromBounds;
