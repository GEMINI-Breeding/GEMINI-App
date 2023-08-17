import React, { useState, useEffect } from 'react';
import { Autocomplete, TextField, Button } from '@mui/material';

import { DataProvider, useDataSetters, useDataState } from '../../DataContext';

const GCPPickerSelectionMenu = ({ onCsvChange, onImageFolderChange, onRadiusChange, selectedMetric, setSelectedMetric }) => {

    // GCPPickerSelectionMenu state management; see DataContext.js
    const {
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
      csvOptions,
      selectedCsv,
      imageFolderOptions,
      selectedImageFolder,
      radiusMeters
    } = useDataState();
  
    const {
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
      setCsvOptions,
      setSelectedCsv,
      setImageFolderOptions,
      setSelectedImageFolder,
      setRadiusMeters
    } = useDataSetters();

  const handleProcessImages = () => {
    const data = {
      location: selectedLocation,
      population: selectedPopulation,
      date: selectedDate
    };
  
    fetch('http://127.0.0.1:5000/flask_app/process_images', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
      // Do something with the data, e.g., print it to the console
      console.log('here is my data', data);
    })
    .catch((error) => {
      console.error('Error is here:', error);
    });
  }

  useEffect(() => {
    // fetch('http://127.0.0.1:5000/flask_app/list_dirs/Raw/Davis/Legumes/2022-07-25/Drone/GCP/')
    fetch('http://127.0.0.1:5000/flask_app/list_dirs/Raw/Davis/Legumes/2022-07-25/Drone/')
      .then((response) => {
        if (!response.ok) { throw new Error('Network response was not ok') }
        return response.json();
      })
      .then(data => setCsvOptions(data))
      .catch((error) => console.error('Error:', error));
  }, []);

  useEffect(() => {
    // fetch('http://127.0.0.1:5000/flask_app/list_dirs/Raw/Davis/Legumes/2022-07-25/Drone/Images/')
    fetch('http://127.0.0.1:5000/flask_app/list_dirs/Raw/Davis/Legumes/2022-07-25/Drone/')
      .then((response) => {
        if (!response.ok) { throw new Error('Network response was not ok') }
        return response.json();
      })
      .then(data => setImageFolderOptions(data))
      .catch((error) => console.error('Error:', error));
  }, []);

  useEffect(() => {
    onCsvChange(selectedCsv);
  }, [selectedCsv]);

  useEffect(() => {
    onImageFolderChange(selectedImageFolder);
  }, [selectedImageFolder]);

  useEffect(() => {
    onRadiusChange(radiusMeters);
  }, [radiusMeters]);

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
              setSelectedGenotypes(null);
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

      <Button 
        variant="contained"
        color="primary"
        onClick={handleProcessImages}
      >
        Run GCP Selection
      </Button>

    </>
  );
};

export default GCPPickerSelectionMenu;
