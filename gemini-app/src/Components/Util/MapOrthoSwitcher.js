import React, { useState, useEffect } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import { useDataState, useDataSetters, fetchData } from "../../DataContext";
import ImageIcon from "@mui/icons-material/Image";
import VisibilityIcon from "@mui/icons-material/Visibility";
import Button from "@mui/material/Button";
import { Select, MenuItem, FormControl, InputLabel, Typography } from "@mui/material";

export const MapOrthoSwitcher = () => {
    const { flaskUrl, selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP } =
        useDataState();
    const { setPrepOrthoImagePath, setPrepAgRowStitchPlotPaths } = useDataSetters();

    const [mapOrthoDateOptions, setMapOrthoDateOptions] = useState([]);
    // State to track if the component is minimized
    const [isMinimized, setIsMinimized] = useState(false);
    // Additional state for orthomosaic selection
    const [selectedDate, setSelectedDate] = useState(null);
    const [availableOrthoTypes, setAvailableOrthoTypes] = useState([]);
    const [selectedOrthoType, setSelectedOrthoType] = useState('');

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
                    dates.map(async (date) => {
                        const hasDronePyramid = await checkDroneFolder(date);
                        const hasAgRowStitch = await checkAgRowStitchFolder(date);
                        return (hasDronePyramid || hasAgRowStitch) ? date : null;
                    })
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
        const basePath = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}`;

        return fetchData(`${flaskUrl}list_dirs/${basePath}`)
            .then((platforms) => {
                // Check if platforms exist
                const platformChecks = platforms.map((platform) =>
                    fetchData(`${flaskUrl}list_dirs/${basePath}/${platform}`)
                        .then((sensors) => {
                            // Check each sensor for a "Pyramid.tif" file
                            const sensorChecks = sensors.map((sensor) =>
                                fetchData(`${flaskUrl}list_files/${basePath}/${platform}/${sensor}`)
                                    .then((files) => files.some((file) => file.includes("Pyramid.tif")))
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

    const checkAgRowStitchFolder = (date) => {
        const basePath = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}`;

        return fetchData(`${flaskUrl}list_dirs/${basePath}`)
            .then((platforms) => {
                // Check if platforms exist
                const platformChecks = platforms.map((platform) =>
                    fetchData(`${flaskUrl}list_dirs/${basePath}/${platform}`)
                        .then((sensors) => {
                            // Check each sensor for AgRowStitch directories
                            const sensorChecks = sensors.map((sensor) =>
                                fetchData(`${flaskUrl}list_dirs/${basePath}/${platform}/${sensor}`)
                                    .then((subDirs) => {
                                        // Look for AgRowStitch_vX directories
                                        const agrowstitchDirs = subDirs.filter(dir => dir.startsWith('AgRowStitch_v'));
                                        if (agrowstitchDirs.length === 0) return false;

                                        // Check if any AgRowStitch version has UTM TIF files
                                        const versionChecks = agrowstitchDirs.map((agrowstitchDir) =>
                                            fetchData(`${flaskUrl}list_files/${basePath}/${platform}/${sensor}/${agrowstitchDir}`)
                                                .then((files) => files.some((file) => file.includes("_utm.tif")))
                                                .catch(() => false)
                                        );

                                        return Promise.all(versionChecks).then((results) => results.some((res) => res));
                                    })
                                    .catch(() => false)
                            );

                            // Return true if any sensor contains AgRowStitch UTM TIF files
                            return Promise.all(sensorChecks).then((results) => results.some((res) => res));
                        })
                        .catch(() => false)
                );

                // Return true if any platform contains valid AgRowStitch UTM TIF files
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

    const handleDateSelection = async (selectedDate) => {
        console.log("Selected date:", selectedDate);
        setSelectedDate(selectedDate);
        setSelectedOrthoType('');
        setAvailableOrthoTypes([]);
        
        // Clear previous orthomosaic selections
        setPrepOrthoImagePath('');
        setPrepAgRowStitchPlotPaths([]);
        
        if (!selectedDate) return;

        const basePath = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${selectedDate}`;
        
        try {
            const platforms = await fetchData(`${flaskUrl}list_dirs/${basePath}`);
            if (platforms.length === 0) return;

            const orthoTypes = [];
            
            // Check for drone orthomosaics and AgRowStitch plots
            for (const platform of platforms) {
                const sensors = await fetchData(`${flaskUrl}list_dirs/${basePath}/${platform}`);
                
                for (const sensor of sensors) {
                    // Check for drone Pyramid.tif
                    try {
                        const files = await fetchData(`${flaskUrl}list_files/${basePath}/${platform}/${sensor}`);
                        if (files.some(file => file.includes("Pyramid.tif"))) {
                            orthoTypes.push({
                                type: 'drone',
                                label: `Drone Orthomosaic (${platform}/${sensor})`,
                                path: `${basePath}/${platform}/${sensor}/${selectedDate}-RGB-Pyramid.tif`,
                                platform,
                                sensor
                            });
                        }
                    } catch (error) {
                        console.error("Error checking drone files:", error);
                    }

                    // Check for AgRowStitch directories
                    try {
                        const subDirs = await fetchData(`${flaskUrl}list_dirs/${basePath}/${platform}/${sensor}`);
                        const agrowstitchDirs = subDirs.filter(dir => dir.startsWith('AgRowStitch_v'));
                        
                        for (const agrowstitchDir of agrowstitchDirs) {
                            const agrowstitchFiles = await fetchData(`${flaskUrl}list_files/${basePath}/${platform}/${sensor}/${agrowstitchDir}`);
                            const utmFiles = agrowstitchFiles.filter(file => file.includes("_utm.tif"));
                            
                            if (utmFiles.length > 0) {
                                orthoTypes.push({
                                    type: 'agrowstitch',
                                    label: `${agrowstitchDir} (${platform}/${sensor})`,
                                    path: `${basePath}/${platform}/${sensor}/${agrowstitchDir}`,
                                    platform,
                                    sensor,
                                    version: agrowstitchDir,
                                    plots: utmFiles.map(file => {
                                        const match = file.match(/georeferenced_plot_(\d+)_utm\.tif/);
                                        return {
                                            plotNumber: match ? match[1] : 'unknown',
                                            filename: file,
                                            fullPath: `${basePath}/${platform}/${sensor}/${agrowstitchDir}/${file}`
                                        };
                                    })
                                });
                            }
                        }
                    } catch (error) {
                        console.error("Error checking AgRowStitch directories:", error);
                    }
                }
            }
            
            setAvailableOrthoTypes(orthoTypes);
            console.log("Available orthomosaic types:", orthoTypes);
            
        } catch (error) {
            console.error("Error in handleDateSelection:", error);
        }
    };

    const handleOrthoTypeSelection = (orthoType) => {
        setSelectedOrthoType(orthoType);
        
        if (orthoType.type === 'drone') {
            // For drone orthomosaics, set the path directly and clear AgRowStitch paths
            setPrepOrthoImagePath(orthoType.path);
            setPrepAgRowStitchPlotPaths([]);
        } else if (orthoType.type === 'agrowstitch') {
            // For AgRowStitch, set all plot paths and clear single orthomosaic
            setPrepOrthoImagePath('');
            setPrepAgRowStitchPlotPaths(orthoType.plots || []);
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
                          width: "280px",
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
                        value={selectedDate}
                        onChange={(event, newValue) => {
                            handleDateSelection(newValue);
                        }}
                        renderInput={(params) => (
                            <TextField {...params} label="Select a date" variant="outlined" size="small" />
                        )}
                        style={{ marginBottom: "10px" }}
                    />
                    
                    {availableOrthoTypes.length > 0 && (
                        <FormControl variant="outlined" size="small" style={{ marginBottom: "10px" }}>
                            <InputLabel>Orthomosaic Type</InputLabel>
                            <Select
                                value={selectedOrthoType}
                                onChange={(event) => handleOrthoTypeSelection(event.target.value)}
                                label="Orthomosaic Type"
                            >
                                {availableOrthoTypes.map((orthoType, index) => (
                                    <MenuItem key={index} value={orthoType}>
                                        {orthoType.label}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    )}
                    
                    {selectedOrthoType && (
                        <Typography variant="caption" style={{ marginTop: "5px", fontSize: "0.7rem" }}>
                            {selectedOrthoType.type === 'drone' ? 
                                'Using drone orthomosaic' : 
                                `Using ${selectedOrthoType.version} - All ${selectedOrthoType.plots?.length || 0} plots displayed`
                            }
                        </Typography>
                    )}
                    
                    <Button
                        onClick={toggleMinimize}
                        style={{
                            position: "absolute",
                            top: -8,
                            left: -10,
                            zIndex: 1000,
                            backgroundColor: "transparent",
                            "&:hover": {
                                backgroundColor: "transparent",
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
