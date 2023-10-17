import React, { useState, useEffect, useRef } from 'react';
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
      radiusMeters,
      flaskUrl,
      gcpPath,
      isSidebarCollapsed,
    } = useDataState();
  
    const {
      setLocationOptionsGCP,
      setSelectedLocationGCP,
      setPopulationOptionsGCP,
      setSelectedPopulationGCP,
      setDateOptionsGCP,
      setSelectedDateGCP,
      setImageList,
      setGcpPath,
      setSidebarCollapsed,
    } = useDataSetters();

    function mergeLists(imageList, existingData) {
      // Create a lookup object for faster search using image name
      const dataLookup = existingData.reduce((acc, image) => {
          acc[image.image_path.split("/").pop()] = image;
          return acc;
      }, {});
  
      // Merge the lists
      return imageList.map(image => {
          const imageName = image.image_path.split("/").pop();
          if (dataLookup[imageName]) {
              // If the image name exists in the previous data, append pointX and pointY
              return {
                  ...image,
                  pointX: dataLookup[imageName].pointX,
                  pointY: dataLookup[imageName].pointY
              };
          }
          return image; // Return the image as it is if no match found
      });
  }  

  const handleProcessImages = () => {

    const data = {
      location: selectedLocationGCP,
      population: selectedPopulationGCP,
      date: selectedDateGCP,
      radius_meters: radiusMeters,
    };

    console.log('data', data);
    console.log('flaskUrl', flaskUrl);
    console.log(`${flaskUrl}process_images`)
  
    fetch(`${flaskUrl}process_images`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    })
    .then(response => response.json())
    .then(data => {
      // Before setting the image list, initialize (or fetch existing) file content
      fetch(`${flaskUrl}initialize_file`, {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json'
          },
          body: JSON.stringify({ basePath: data.selected_images[0].image_path })
      })
      .then(fileResponse => fileResponse.json())
      .then(fileData => {
        console.log('fileData', fileData);

        if (fileData.existing_data && fileData.existing_data.length > 0) {
            // Logic to merge existing data with current imageList
            const mergedList = mergeLists(data.selected_images, fileData.existing_data);
            setImageList(mergedList);
        } else {
            setImageList(data.selected_images);
        }

        if (fileData.file_path) {
            setGcpPath(fileData.file_path);
        } else {
            console.log('No GCP path found again');
        }
      });
  })

  // If the sidebar is not collapsed, collapse it
  if (!isSidebarCollapsed) {
    setSidebarCollapsed(true);
  }
  }

  const fetchData = async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    return await response.json();
  };

  const prevLocationGCPRef = useRef(null);
  const prevPopulationGCPRef = useRef(null);
  const prevDateGCPRef = useRef(null);
  
  useEffect(() => {

    // Check if location has changed
    if (selectedLocationGCP !== prevLocationGCPRef.current) {
      setSelectedPopulationGCP(null);
      setSelectedDateGCP(null);
    }
  
    // Check if population has changed
    if (selectedPopulationGCP !== prevPopulationGCPRef.current) {
      setSelectedDateGCP(null);
    }
  
    // Fetch date options if no date is selected but other criteria are
    if (selectedLocationGCP && selectedPopulationGCP && !selectedDateGCP) {
      fetchData(`${flaskUrl}list_dirs/Processed/${selectedLocationGCP}/${selectedPopulationGCP}`)
        .then(setDateOptionsGCP)
        .catch((error) => console.error('Error:', error));
    }
  
    // Fetch populations if no population is selected but location is
    if (selectedLocationGCP && !selectedPopulationGCP) {
      fetchData(`${flaskUrl}list_dirs/Processed/${selectedLocationGCP}`)
        .then(setPopulationOptionsGCP)
        .catch((error) => console.error('Error:', error));
    }
  
    // Fetch location options if no location is selected
    if (!selectedLocationGCP) {
      fetchData(`${flaskUrl}list_dirs/Processed/`)
        .then(data => {
          setLocationOptionsGCP(data);
        })
        .catch((error) => console.error('Error:', error));
    }
  
    // Update ref values at the end
    prevLocationGCPRef.current = selectedLocationGCP;
    prevPopulationGCPRef.current = selectedPopulationGCP;
    prevDateGCPRef.current = selectedDateGCP;
  
  }, [selectedLocationGCP, selectedPopulationGCP, selectedDateGCP]);

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
