import React, { useState, useEffect } from 'react';
import { Autocomplete, TextField } from '@mui/material';

import { useDataState, useDataSetters } from '../../DataContext';

const DataSelectionMenu = ({ onTilePathChange, onGeoJsonPathChange, selectedMetric, setSelectedMetric }) => {

  const {
    locationOptions,
    selectedLocation,
    populationOptions,
    selectedPopulation,
    dateOptions,
    selectedDate,
    sensorOptions,
    selectedSensor,
    metricOptions
  } = useDataState();

  const {
    setLocationOptions,
    setSelectedLocation,
    setPopulationOptions,
    setSelectedPopulation,
    setDateOptions,
    setSelectedDate,
    setSensorOptions,
    setSelectedSensor,
    setMetricOptions
  } = useDataSetters();

  useEffect(() => {
    fetch('http://127.0.0.1:5000/flask_app/list_dirs/Processed/')
      .then((response) => {
        if (!response.ok) { throw new Error('Network response was not ok') }
        return response.json();
      })
      .then(data => setLocationOptions(data))
      .catch((error) => console.error('Error:', error));
  }, []);

  useEffect(() => {
    if (selectedLocation) {
      // fetch the populations based on the selected location
      fetch(`http://127.0.0.1:5000/flask_app/list_dirs/Processed/${selectedLocation}`)
        .then((response) => {
          if (!response.ok) { throw new Error('Network response was not ok') }
          return response.json();
        })
        .then(data => setPopulationOptions(data))
        .catch((error) => console.error('Error:', error));
    }
  }, [selectedLocation]);

  useEffect(() => {
    if (selectedPopulation) {
      // fetch the dates based on the selected population
      fetch(`http://127.0.0.1:5000/flask_app/list_dirs/Processed/${selectedLocation}/${selectedPopulation}`)
        .then((response) => {
          if (!response.ok) { throw new Error('Network response was not ok') }
          return response.json();
        })
        .then(data => setDateOptions(data))
        .catch((error) => console.error('Error:', error));
    }
  }, [selectedLocation, selectedPopulation]);

  useEffect(() => {
    if (selectedDate) {
      // fetch the dates based on the selected population
      fetch(`http://127.0.0.1:5000/flask_app/list_dirs/Processed/${selectedLocation}/${selectedPopulation}/${selectedDate}`)
        .then((response) => {
          if (!response.ok) { throw new Error('Network response was not ok') }
          return response.json();
        })
        .then(data => setSensorOptions(data.filter((item) => item !== 'Results')))
        .catch((error) => console.error('Error:', error));
    }
  }, [selectedLocation, selectedPopulation, selectedDate]);

  useEffect(() => {
    if (selectedSensor) {
      const newTilePath = `/flask_app/files/Processed/${selectedLocation}/${selectedPopulation}/${selectedDate}/${selectedSensor}/${selectedDate}-P4-RGB-Pyramid.tif`;
      const newGeoJsonPath = `http://127.0.0.1:5000/flask_app/files/Processed/${selectedLocation}/${selectedPopulation}/${selectedDate}/Results/${selectedDate}-Traits-WebMerc.geojson`;
      onTilePathChange(newTilePath);
      onGeoJsonPathChange(newGeoJsonPath);
    }
    if (selectedLocation == null || selectedSensor == null || selectedMetric == null){
      onGeoJsonPathChange(null)
    }
  }, [ selectedMetric, selectedSensor, selectedLocation ]);

  useEffect(() => {
    if (selectedSensor == 'Drone') {
      setMetricOptions([
        'Height_95p_meters',
        'Vegetation_Fraction',
        'Avg_Temp_C'
      ])
    }
  }, [selectedSensor])

  useEffect(() => {
    if (selectedMetric) {
      console.log('Metric has changed to: ', selectedMetric);
      // perform some action here based on the new value of selectedMetric
    }
  }, [selectedMetric]);  

  return (
    <>
      <Autocomplete
        id="location-combo-box"
        options={locationOptions}
        value={selectedLocation}
        onChange={(event, newValue) => {
          setSelectedLocation(newValue);
          setSelectedPopulation(null);
          setSelectedDate(null);
          setSelectedSensor(null);
          setSelectedMetric(null);
        }}
        renderInput={(params) => <TextField {...params} label="Location" />}
        sx={{ mb: 2 }}
      />

      {selectedLocation !== null ? (
          <Autocomplete
            id="population-combo-box"
            options={populationOptions}
            value={selectedPopulation}
            onChange={(event, newValue) => {
              setSelectedPopulation(newValue);
              setSelectedDate(null);
              setSelectedSensor(null);
              setSelectedMetric(null);
            }}
            renderInput={(params) => <TextField {...params} label="Population" />}
            sx={{ mb: 2 }}
          />
        ) : null}

      {selectedPopulation !== null ? (
        <Autocomplete
          id="date-combo-box"
          options={dateOptions}
          value={selectedDate}
          onChange={(event, newValue) => {
            setSelectedDate(newValue);
            setSelectedSensor(null);
            setSelectedMetric(null);
          }}
          renderInput={(params) => <TextField {...params} label="Date" />}
          sx={{ mb: 2 }}
        />
      ) : null}
      
      {selectedDate !== null ? (
        <Autocomplete
          id="sensor-combo-box"
          options={sensorOptions}
          value={selectedSensor}
          onChange={(event, newValue) => {
            setSelectedSensor(newValue);
            setSelectedMetric(null);
          }}
          renderInput={(params) => <TextField {...params} label="Sensing Platform" />}
          sx={{ mb: 2 }}
        />
      ) : null}

      {selectedSensor !== null ? (
        <Autocomplete
          id="metric-combo-box"
          options={metricOptions}
          value={selectedMetric}
          onChange={(event, newValue) => {
            setSelectedMetric(newValue);
            console.log('new metric is: ', newValue)
          }}
          renderInput={(params) => <TextField {...params} label="Trait Metric" />}
          sx={{ mb: 2 }}
        />
      ) : null}
    </>
  );
};

export default DataSelectionMenu;
