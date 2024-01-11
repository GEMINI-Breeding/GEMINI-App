import React, { useState, useEffect } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import { useDataState, useDataSetters, fetchData } from "../../DataContext";
import ImageIcon from "@mui/icons-material/Image";
import VisibilityIcon from "@mui/icons-material/Visibility";
import Button from "@mui/material/Button";

export const MapOrthoSwitcher = () => {
    const { flaskUrl, selectedLocationGCP, selectedPopulationGCP } = useDataState();
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

        fetchData(`${flaskUrl}list_dirs/Processed/${selectedLocationGCP}/${selectedPopulationGCP}`)
            .then((dates) => {
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

    const checkDroneFolder = (date) => {
        return fetchData(`${flaskUrl}list_dirs/Processed/${selectedLocationGCP}/${selectedPopulationGCP}/${date}`) // Adjust for actual location and population
            .then((data) => {
                if (data.includes("Drone")) {
                    return fetchData(
                        `${flaskUrl}list_files/Processed/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/Drone`
                    )
                        .then((droneData) => droneData.some((item) => item.endsWith("Pyramid.tif")))
                        .catch(() => false);
                } else {
                    return false;
                }
            })
            .catch(() => false);
    };

    const handleDateSelection = (selectedDate) => {
        console.log("Selected date:", selectedDate);
        if (selectedDate) {
            setPrepOrthoImagePath(
                `Processed/${selectedLocationGCP}/${selectedPopulationGCP}/${selectedDate}/Drone/${selectedDate}-P4-RGB-Pyramid.tif`
            );
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
