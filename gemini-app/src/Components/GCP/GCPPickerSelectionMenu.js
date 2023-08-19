import React, { useState, useEffect } from 'react';
import { Autocomplete, TextField, Button } from '@mui/material';

import { DataProvider, useDataSetters, useDataState } from '../../DataContext';

const GCPPickerSelectionMenu = ({ onCsvChange, onImageFolderChange, onRadiusChange, selectedMetric, setSelectedMetric }) => {

    // GCPPickerSelectionMenu state management; see DataContext.js
    const {
      locationOptionsGCP,
      selectedLocationGCP,
      populationOptionsGCP,
      selectedPopulationGCP,
      dateOptionsGCP,
      selectedDateGCP,
      selectedCsv,
      selectedImageFolder,
      radiusMeters
    } = useDataState();
  
    const {
      setLocationOptionsGCP,
      setSelectedLocationGCP,
      setPopulationOptionsGCP,
      setSelectedPopulationGCP,
      setSelectedDateGCP,
      setCsvOptions,
      setImageFolderOptions,
      setImageList,
    } = useDataSetters();

  const handleProcessImages = () => {

    const data = {
      location: selectedLocationGCP,
      population: selectedPopulationGCP,
      date: selectedDateGCP,
      radius_meters: radiusMeters,
    };

    console.log('data', data);
  
    fetch('http://127.0.0.1:5001/flask_app/process_images', {
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
      setImageList(data.selected_images);
    })
    .catch((error) => {
      console.error('Error is here:', error);
    });
  }

  useEffect(() => {
    fetch('http://127.0.0.1:5001/flask_app/list_dirs/Processed/')
      .then((response) => {
        if (!response.ok) { throw new Error('Network response was not ok') }
        return response.json();
      })
      .then(data => setLocationOptionsGCP(data))
      .catch((error) => console.error('Error:', error));
  }, []);

  useEffect(() => {
    if (selectedLocationGCP) {
      // fetch the populations based on the selected location
      fetch(`http://127.0.0.1:5001/flask_app/list_dirs/Processed/${selectedLocationGCP}`)
        .then((response) => {
          if (!response.ok) { throw new Error('Network response was not ok') }
          return response.json();
        })
        .then(data => setPopulationOptionsGCP(data))
        .catch((error) => console.error('Error:', error));
    }
  }, [selectedLocationGCP]);

  useEffect(() => {
    if (selectedDateGCP) {
      // fetch the dates based on the selected population
      fetch(`http://127.0.0.1:5001/flask_app/list_dirs/Processed/${selectedLocationGCP}/${selectedPopulationGCP}/${selectedDateGCP}`)
        .then((response) => {
          if (!response.ok) { throw new Error('Network response was not ok') }
          return response.json();
        })
        .catch((error) => console.error('Error:', error));
    }
  }, [selectedLocationGCP, selectedPopulationGCP, selectedDateGCP]);


  useEffect(() => {
    fetch('http://127.0.0.1:5001/flask_app/list_dirs/Raw/Davis/Legumes/2022-07-25/Drone/')
      .then((response) => {
        if (!response.ok) { throw new Error('Network response was not ok') }
        return response.json();
      })
      .then(data => setCsvOptions(data))
      .catch((error) => console.error('Error:', error));
  }, []);

  useEffect(() => {
    fetch('http://127.0.0.1:5001/flask_app/list_dirs/Raw/Davis/Legumes/2022-07-25/Drone/')
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
        options={locationOptionsGCP}
        value={selectedLocationGCP}
        onChange={(event, newValue) => {
          setSelectedLocationGCP(newValue);
          setSelectedPopulationGCP(null);
          setSelectedDateGCP(null);
        }}
        renderInput={(params) => <TextField {...params} label="Location" />}
        sx={{ mb: 2 }}
      />

      {selectedLocationGCP !== null ? (
          <Autocomplete
            id="population-combo-box"
            options={populationOptionsGCP}
            value={selectedPopulationGCP}
            onChange={(event, newValue) => {
              setSelectedPopulationGCP(newValue);
              setSelectedDateGCP(null);
            }}
            renderInput={(params) => <TextField {...params} label="Population" />}
            sx={{ mb: 2 }}
          />
        ) : null}

      {selectedPopulationGCP !== null ? (
        <Autocomplete
          id="date-combo-box"
          options={dateOptionsGCP}
          value={selectedDateGCP}
          onChange={(event, newValue) => {
            setSelectedDateGCP(newValue);
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
