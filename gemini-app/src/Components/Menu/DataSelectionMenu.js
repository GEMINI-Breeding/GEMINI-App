import React, { useState, useEffect } from 'react';
import { Autocomplete, TextField } from '@mui/material';

import { useDataState, useDataSetters } from '../../DataContext';

const DataSelectionMenu = ({ onTilePathChange, onGeoJsonPathChange, selectedMetric, setSelectedMetric }) => {

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
    selectedTraitsGeoJsonPath
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
    setSelectedTraitsGeoJsonPath
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
      const newTilePath = `files/Processed/${selectedLocation}/${selectedPopulation}/${selectedDate}/Drone/${selectedDate}-P4-RGB-Pyramid.tif`;
      const newGeoJsonPath = `http://127.0.0.1:5000/flask_app/files/Processed/${selectedLocation}/${selectedPopulation}/${selectedDate}/Results/${selectedDate}-${selectedSensor}-Traits-WGS84.geojson`;
      const newGTGeoJsonPath = `http://127.0.0.1:5000/flask_app/files/Processed/${selectedLocation}/${selectedPopulation}/GroundTruth-Traits-WGS84.geojson`;
      onTilePathChange(newTilePath);
      onGeoJsonPathChange(newGeoJsonPath);

      fetch(newGeoJsonPath)
          .then(response => response.json())
          .then(data => {
            if(data) {
              const traitOutputLabels = data.features
              .map(f => f.properties.Label)

              const uniqueTraitOutputLabels = [...new Set(traitOutputLabels)];
              uniqueTraitOutputLabels.unshift('All Genotypes')
              console.log('uniqueTraitOutputLabels', uniqueTraitOutputLabels)
              setGenotypeOptions(uniqueTraitOutputLabels);
              if(selectedGenotypes == null) {
                setSelectedGenotypes(['All Genotypes'])
              }
            }
          }).catch((error) => console.error('newGeoJsonPath not loaded:', error));
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
    else if (selectedSensor == 'Rover') {
      setMetricOptions([
        'Average Height (cm)',
        'Average Leaf Area (cm2)',
        'Average Fruit Count',
        'Average Leaf Count',
        'Average Flower Count'
      ])
    }
  }, [selectedSensor])

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
          }}
          renderInput={(params) => <TextField {...params} label="Trait Metric" />}
          sx={{ mb: 2 }}
        />
      ) : null}

      { selectedMetric !== null ? (
        <Autocomplete
          multiple
          id="genotype-combo-box"
          options={genotypeOptions}
          value={selectedGenotypes}
          onChange={(event, newValue) => {
            
            // If "All Genotypes" is selected along with other options
            if (newValue.includes("All Genotypes") && newValue.length > 1) {
              if (selectedGenotypes.includes("All Genotypes")) {
                // This means that "All Genotypes" was already selected, so we remove other selections
                newValue = newValue.filter(val => val !== "All Genotypes");
              } else {
                // This means "All Genotypes" was freshly selected, so we only keep it and remove others
                newValue = ["All Genotypes"];
              }
            }
            
            if (newValue.length === 0 || (newValue.length === 1 && newValue[0] !== "All Genotypes")) {
              if (!genotypeOptions.includes("All Genotypes")) {
                setGenotypeOptions(prevOptions => ["All Genotypes", ...prevOptions]);
              }
            } else if (!newValue.includes("All Genotypes") && genotypeOptions.includes("All Genotypes")) {
              setGenotypeOptions(prevOptions => prevOptions.filter(val => val !== "All Genotypes"));
            }
            
            setSelectedGenotypes(newValue);
          }}
          renderInput={(params) => <TextField {...params} label="Genotype" />}
          sx={{ mb: 2 }}
        />
      ) : null}


    </> 
  );
};

export default DataSelectionMenu;
