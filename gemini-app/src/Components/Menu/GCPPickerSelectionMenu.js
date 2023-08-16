import React, { useState, useEffect } from 'react';
import { Autocomplete, TextField, Button } from '@mui/material';

import { DataProvider, useDataSetters, useDataState } from '../../DataContext';

const GCPPickerSelectionMenu = ({ onCsvChange, onImageFolderChange, onRadiusChange }) => {

    // GCPPickerSelectionMenu state management; see DataContext.js
    const {
      csvOptions,
      selectedCsv,
      imageFolderOptions,
      selectedImageFolder,
      radiusMeters
    } = useDataState();
  
    const {
      setCsvOptions,
      setSelectedCsv,
      setImageFolderOptions,
      setSelectedImageFolder,
      setRadiusMeters
    } = useDataSetters();

  const handleProcessImages = () => {
    const data = {
      image_folder: selectedImageFolder,
      predefined_locations_csv: selectedCsv,
      radius_meters: radiusMeters
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
      console.log(data);
    })
    .catch((error) => {
      console.error('Error:', error);
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
        id="csv-combo-box"
        options={csvOptions}
        value={selectedCsv}
        onChange={(event, newValue) => setSelectedCsv(newValue)}
        renderInput={(params) => <TextField {...params} label="CSV File" />}
        sx={{ mb: 2 }}
      />

      <Autocomplete
        id="image-folder-combo-box"
        options={imageFolderOptions}
        value={selectedImageFolder}
        onChange={(event, newValue) => setSelectedImageFolder(newValue)}
        renderInput={(params) => <TextField {...params} label="Image Folder" />}
        sx={{ mb: 2 }}
      />

      <TextField 
        id="radius-meters-input"
        label="Radius Meters"
        type="number"
        value={radiusMeters}
        onChange={(event) => setRadiusMeters(event.target.value)}
        sx={{ mb: 2 }}
      />

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
