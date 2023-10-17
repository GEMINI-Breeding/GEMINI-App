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
    const [geojsonData, setGeojsonData] = useState(null);
    const [hoverInfo, setHoverInfo] = useState(null);
    const [selectedMetric, setSelectedMetric] = useState(null);
    const [isLoadingColorScale, setIsLoadingColorScale] = useState(false);
    const [currentView, setCurrentView] = useState(null);

    // DataSelectionMenu State
    const [locationOptions, setLocationOptions] = useState([]);
    const [selectedLocation, setSelectedLocation] = useState(null);
    const [populationOptions, setPopulationOptions] = useState([]);
    const [selectedPopulation, setSelectedPopulation] = useState(null);
    const [genotypeOptions, setGenotypeOptions] = useState([]);
    const [selectedGenotypes, setSelectedGenotypes] = useState([]);
    const [dateOptions, setDateOptions] = useState([]);
    const [selectedDate, setSelectedDate] = useState(null);
    const [sensorOptions, setSensorOptions] = useState([]);
    const [selectedSensor, setSelectedSensor] = useState(null);
    const [metricOptions, setMetricOptions] = useState([]);
    const [nowDroneProcessing, setNowDroneProcessing] = useState();

    // CollapsibleSideBar State
    const [isSidebarCollapsed, setSidebarCollapsed] = useState(false);

    // ColorMap State
    const [colorScale, setColorScale] = useState(null);
    const [lowerPercentileValue, setLowerPercentileValue] = useState(null);
    const [upperPercentileValue, setUpperPercentileValue] = useState(null);

    // GCPPickerSelectionMenu State
    const [csvOptions, setCsvOptions] = useState([]);
    const [selectedCsv, setSelectedCsv] = useState(null);
    const [imageFolderOptions, setImageFolderOptions] = useState([]);
    const [selectedImageFolder, setSelectedImageFolder] = useState(null);
    const [radiusMeters, setRadiusMeters] = useState(5);
    const [gcpPath, setGcpPath] = useState(null);

    // ImageViewer State
    const [imageIndex, setImageIndex] = useState(0);
    const [imageList, setImageList] = useState([]);
    const [imageViewerLoading, setImageViewerLoading] = useState(false);
    const [imageViewerError, setImageViewerError] = useState(null);
    const [locationOptionsGCP, setLocationOptionsGCP] = useState([]);
    const [selectedLocationGCP, setSelectedLocationGCP] = useState(null);
    const [populationOptionsGCP, setPopulationOptionsGCP] = useState([]);
    const [selectedPopulationGCP, setSelectedPopulationGCP] = useState(null);
    const [dateOptionsGCP, setDateOptionsGCP] = useState([]);
    const [selectedDateGCP, setSelectedDateGCP] = useState(null);
    const [sliderMarks, setSliderMarks] = useState([]);

    // Backend
    const [flaskUrl, setFlaskUrl] = useState('http://127.0.0.1:5000/flask_app/');
    const [tileServerUrl, setTileServerUrl] = useState('http://127.0.0.1:8090/');

  return (

    <DataStateContext.Provider value={{ 

        // App State
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
        geojsonData,

        // DataSelectionMenu State
        locationOptions, 
        selectedLocation,
        populationOptions,
        selectedPopulation,
        genotypeOptions,
        selectedGenotypes,
        dateOptions,
        selectedDate,
        sensorOptions,
        selectedSensor,
        metricOptions,
        geojsonData,
        nowDroneProcessing,

        // CollapsibleSideBarState
        isSidebarCollapsed,

        // ColorMap State
        colorScale,
        lowerPercentileValue,
        upperPercentileValue,

        // GCPPickerSelectionMenu State
        csvOptions,
        selectedCsv,
        imageFolderOptions,
        selectedImageFolder,
        radiusMeters,
        locationOptionsGCP,
        selectedLocationGCP, 
        populationOptionsGCP,
        selectedPopulationGCP,
        dateOptionsGCP,
        selectedDateGCP,
        gcpPath,

        // ImageViewer State
        imageIndex,
        imageList,
        imageViewerLoading,
        imageViewerError,
        sliderMarks,

        // Backend
        flaskUrl,
        tileServerUrl

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
        setGeojsonData,

        // DataSelectionMenu state
        setLocationOptions, 
        setSelectedLocation,
        setPopulationOptions,
        setSelectedPopulation,
        setGenotypeOptions,
        setSelectedGenotypes,
        setDateOptions,
        setSelectedDate,
        setSensorOptions,
        setSelectedSensor,
        setMetricOptions,
        setNowDroneProcessing,

        // CollapsibleSideBar State
        setSidebarCollapsed,

        // ColorMap State
        setColorScale,
        setLowerPercentileValue,
        setUpperPercentileValue,

        // GCPPickerSelectionMenu State
        setCsvOptions,
        setSelectedCsv,
        setImageFolderOptions,
        setSelectedImageFolder,
        setRadiusMeters,
        setLocationOptionsGCP,
        setSelectedLocationGCP,
        setPopulationOptionsGCP,
        setSelectedPopulationGCP,
        setDateOptionsGCP,
        setSelectedDateGCP,
        setGcpPath,

        // ImageViewer State
        setImageIndex,
        setImageList,
        setImageViewerLoading,
        setImageViewerError,
        setSliderMarks,

        // Backend
        setFlaskUrl,
        setTileServerUrl

        }}>

        {children}

      </DataSettersContext.Provider>
    </DataStateContext.Provider>
  );
};
