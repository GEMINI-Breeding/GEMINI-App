// DataContext.js
import React, { createContext, useContext, useState } from 'react';

const DataStateContext = createContext();
const DataSettersContext = createContext();

export const useDataState = () => {
  const context = useContext(DataStateContext);
  if (!context) {
    throw new Error("useDataState must be used within a DataProvider");
  }
  return context;
};

export const useDataSetters = () => {
  const context = useContext(DataSettersContext);
  if (!context) {
    throw new Error("useDataSetters must be used within a DataProvider");
  }
  return context;
};

export const DataProvider = ({ children }) => {

    const initialViewState = {
        longitude: -121.781381,
        latitude: 38.535257,
        zoom: 17,
        pitch: 0,
        bearing: 0,
      };

    // App State
    const [viewState, setViewState] = useState(initialViewState);
    const [selectedTilePath, setSelectedTilePath] = useState('');
    const [selectedTraitsGeoJsonPath, setSelectedTraitsGeoJsonPath] = useState('');
    const [hoverInfo, setHoverInfo] = useState(null);
    const [selectedMetric, setSelectedMetric] = useState(null);
    const [isLoadingColorScale, setIsLoadingColorScale] = useState(false);
    const [currentView, setCurrentView] = useState(null);
    const [selectedCsv, setSelectedCsv] = useState(null);
    const [selectedImageFolder, setSelectedImageFolder] = useState(null);
    const [radiusMeters, setRadiusMeters] = useState(null);

    // DataSelectionMenu State
    const [locationOptions, setLocationOptions] = useState([]);
    const [selectedLocation, setSelectedLocation] = useState(null);
    const [populationOptions, setPopulationOptions] = useState([]);
    const [selectedPopulation, setSelectedPopulation] = useState(null);
    const [dateOptions, setDateOptions] = useState([]);
    const [selectedDate, setSelectedDate] = useState(null);
    const [sensorOptions, setSensorOptions] = useState([]);
    const [selectedSensor, setSelectedSensor] = useState(null);
    const [metricOptions, setMetricOptions] = useState([]);

  return (

    <DataStateContext.Provider value={{ 

        // App state
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

        // DataSelectionMenu state
        locationOptions, 
        selectedLocation,
        populationOptions,
        selectedPopulation,
        dateOptions,
        selectedDate,
        sensorOptions,
        selectedSensor,
        metricOptions

        }}>

      <DataSettersContext.Provider value={{ 

        // App state
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

        // DataSelectionMenu state
        setLocationOptions, 
        setSelectedLocation,
        setPopulationOptions,
        setSelectedPopulation,
        setDateOptions,
        setSelectedDate,
        setSensorOptions,
        setSelectedSensor,
        setMetricOptions

        }}>

        {children}

      </DataSettersContext.Provider>
    </DataStateContext.Provider>
  );
};
