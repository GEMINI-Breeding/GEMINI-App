import React, { useState, useEffect } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import { useDataState, useDataSetters, fetchData } from "../../DataContext";
import ImageIcon from "@mui/icons-material/Image";
import VisibilityIcon from "@mui/icons-material/Visibility";
import Button from "@mui/material/Button";

export const MapOrthoSwitcher = () => {
    const { flaskUrl, selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP } =
        useDataState();
    const { setPrepOrthoImagePath } = useDataSetters();

    const [mapOrthoDateOptions, setMapOrthoDateOptions] = useState([]);
    // State to track if the component is minimized
    const [isMinimized, setIsMinimized] = useState(false);

    // Toggle function
    const toggleMinimize = () => setIsMinimized(!isMinimized);

    useEffect(() => {
        // Fetch dates and process them
        console.log("Fetching dates...");
        console.log("selectedLocation", selectedLocationGCP);
        console.log("selectedPopulation", selectedPopulationGCP);

        fetchData(
            `${flaskUrl}list_dirs/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`
        )
            .then((dates) => {
                console.log("fetched dates", dates);
                return Promise.all(
                    dates.map((date) =>
                        checkDroneFolder(date).then((hasDronePyramid) => (hasDronePyramid ? date : null))
                    )
                );
                console.log("dates", dates);
            })
            .then((filteredDates) => {
                // Filter out null values and update date options
                console.log("filteredDates", filteredDates);
                setMapOrthoDateOptions(filteredDates.filter((date) => date !== null));
            })
            .catch((error) => console.error("Error fetching dates:", error));
    }, []);

    // const checkDroneFolder = (date) => {
    //     return fetchData(
    //         `${flaskUrl}list_dirs/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}`
    //     ) // Adjust for actual location and population
    //         .then((data) => {
    //             console.log("data in dates to fetch in folder", data);
    //             if (data.includes("Drone")) {
    //                 return fetchData(
    //                     `${flaskUrl}list_files/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/Drone/RGB`
    //                 )
    //                     .then((droneData) => droneData.some((item) => item.endsWith("Pyramid.tif")))
    //                     .catch(() => false);
    //             } else {
    //                 return false;
    //             }
    //         })
    //         .catch(() => false);
    // };

    const checkDroneFolder = (date) => {
        return fetchData(
            `${flaskUrl}list_dirs/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}`
        ) // Adjust for actual location and population
            .then((platforms) => {
                if (platforms.length === 0) return false;
    
                // Iterate over each platform directory
                const platformChecks = platforms.map((platform) =>
                    fetchData(
                        `${flaskUrl}list_dirs/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}`
                    )
                        .then((sensors) => {
                            if (sensors.length === 0) return false;
    
                            // Iterate over each sensor directory and check for "Pyramid.tif" files
                            const sensorChecks = sensors.map((sensor) =>
                                fetchData(
                                    `${flaskUrl}list_files/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}`
                                )
                                    .then((sensorData) =>
                                        sensorData.some((item) => item.endsWith("Pyramid.tif"))
                                    )
                                    .catch(() => false)
                            );
    
                            // Return true if any sensor contains a "Pyramid.tif" file
                            return Promise.all(sensorChecks).then((results) => results.some((res) => res));
                        })
                        .catch(() => false)
                );
    
                // Return true if any platform contains a valid sensor with "Pyramid.tif" files
                return Promise.all(platformChecks).then((results) => results.some((res) => res));
            })
            .catch(() => false);
    };
    

    // const handleDateSelection = (selectedDate) => {
    //     console.log("Selected date:", selectedDate);
    //     if (selectedDate) {
    //         setPrepOrthoImagePath(
    //             `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${selectedDate}/Drone/RGB/${selectedDate}-RGB-Pyramid.tif`
    //         );
    //     }
    // };

    const handleDateSelection = (selectedDate) => {
        console.log("Selected date:", selectedDate);
        if (selectedDate) {
            fetchData(
                `${flaskUrl}list_dirs/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${selectedDate}`
            )
                .then((platforms) => {
                    if (platforms.length === 0) return;
    
                    // Assume we are interested in the first platform directory
                    const platform = platforms[0];
    
                    fetchData(
                        `${flaskUrl}list_dirs/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${selectedDate}/${platform}`
                    )
                        .then((sensors) => {
                            if (sensors.length === 0) return;
    
                            // Assume we are interested in the first sensor directory
                            const sensor = sensors[0];
    
                            setPrepOrthoImagePath(
                                `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${selectedDate}/${platform}/${sensor}/${selectedDate}-RGB-Pyramid.tif`
                            );
                        })
                        .catch((error) => console.error("Error fetching sensors:", error));
                })
                .catch((error) => console.error("Error fetching platforms:", error));
        }
    };
    

    return (
        <div
            style={
                isMinimized
                    ? {
                          position: "absolute",
                          top: 10,
                          left: 10,
                          zIndex: 1,
                          backgroundColor: "rgba(255, 255, 255, 0.2)",
                          borderRadius: "8px",
                          padding: "10px",
                          width: "40px",
                          height: "40px",
                          display: "flex",
                          justifyContent: "center",
                          alignItems: "center",
                      }
                    : {
                          position: "absolute",
                          top: 10,
                          left: 10,
                          zIndex: 1,
                          backgroundColor: "rgba(255, 255, 255, 0.7)",
                          borderRadius: "8px",
                          padding: "20px",
                          display: "flex",
                          flexDirection: "column",
                          width: "220px",
                      }
            }
        >
            {isMinimized ? (
                <Button onClick={() => toggleMinimize()} style={{ marginBottom: "5px" }}>
                    <ImageIcon name="maximize" fontSize="large" />
                </Button>
            ) : (
                <>
                    <Autocomplete
                        options={mapOrthoDateOptions}
                        onChange={(event, newValue) => {
                            handleDateSelection(newValue);
                        }}
                        renderInput={(params) => (
                            <TextField {...params} label="Select an orthomosaic" variant="outlined" />
                        )}
                    />
                    <Button
                        onClick={toggleMinimize}
                        style={{
                            position: "absolute", // Absolute position for the button
                            top: -8, // Top right corner
                            left: -10,
                            zIndex: 1000, // High z-index to float above other elements
                            backgroundColor: "transparent", // Set default background
                            "&:hover": {
                                backgroundColor: "transparent", // Keep background transparent on hover
                            },
                        }}
                    >
                        <VisibilityIcon name="minimize" />
                    </Button>
                </>
            )}
        </div>
    );
};
