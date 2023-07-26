import React, { useState, useEffect } from 'react';
import { Autocomplete, TextField } from '@mui/material';

const DataSelectionMenu = ({ onTilePathChange }) => {
  const [locationOptions, setLocationOptions] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [populationOptions, setPopulationOptions] = useState([]);
  const [selectedPopulation, setSelectedPopulation] = useState(null);
  const [dateOptions, setDateOptions] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [sensorOptions, setSensorOptions] = useState([]);
  const [selectedSensor, setSelectedSensor] = useState(null);
  // const [genotypeOptions, setGenotypeOptions] = useState([]);
  // const [selectedGenotype, setSelectedGenotype] = useState(null);

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
        .then(data => setSensorOptions(data))
        .catch((error) => console.error('Error:', error));
    }
  }, [selectedLocation, selectedPopulation, selectedDate]);

  useEffect(() => {
    if (selectedSensor) {
      const newTilePath = `/flask_app/files/Processed/${selectedLocation}/${selectedPopulation}/${selectedDate}/${selectedSensor}/${selectedDate}-P4-RGB-Pyramid.tif`;
      onTilePathChange(newTilePath);
    }
    console.log('executed!')
  }, [ selectedSensor ]);

  return (
    <>
      <Autocomplete
        id="location-combo-box"
        options={locationOptions}
        value={selectedLocation}
        onChange={(event, newValue) => {
          setSelectedLocation(newValue);
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
          }}
          renderInput={(params) => <TextField {...params} label="Sensing Platform" />}
          sx={{ mb: 2 }}
        />
      ) : null}
    </>
  );
};

export default DataSelectionMenu;
