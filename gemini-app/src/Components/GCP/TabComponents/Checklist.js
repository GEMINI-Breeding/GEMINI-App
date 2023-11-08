import React, { useEffect, useState } from "react";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import TextField from "@mui/material/TextField";
import { useDataState, useDataSetters, fetchData } from "../../../DataContext";

function ChecklistItem({ label, path, isChecked, onCheckboxChange, onPathChange }) {
    return (
        <ListItem>
            <div style={{ display: "flex", flexDirection: "column", width: "80%" }}>
                <FormControlLabel
                    control={<Checkbox checked={isChecked} onChange={onCheckboxChange} color="primary" />}
                    label={label}
                />
                {isChecked && (
                    <TextField
                        label="File Path"
                        value={path}
                        onChange={onPathChange}
                        style={{ marginTop: 10 }}
                        fullWidth
                    />
                )}
            </div>
        </ListItem>
    );
}

function Checklist({ onProceed, onDroneGcpProceed }) {
    const {
        prepGcpFilePath,
        prepDroneImagePath,
        prepOrthoImagePath,
        selectedLocationGCP,
        selectedPopulationGCP,
        flaskUrl,
        selectedDateGCP,
    } = useDataState();

    const { setPrepGcpFilePath, setPrepDroneImagePath, setPrepOrthoImagePath, setSelectedDateGCP } = useDataSetters();

    const [isOrthoChecked, setIsOrthoChecked] = useState(false);
    const [isGcpChecked, setIsGcpChecked] = useState(false);
    const [isDroneChecked, setIsDroneChecked] = useState(false);

    useEffect(() => {
        // Function to fetch and set the ortho image path
        const fetchAndSetOrthoImagePath = async () => {
            const dirs = await fetchData(
                `${flaskUrl}list_dirs/Processed/${selectedLocationGCP}/${selectedPopulationGCP}`
            );
            for (const dir of dirs) {
                const subDirs = await fetchData(
                    `${flaskUrl}list_dirs/Processed/${selectedLocationGCP}/${selectedPopulationGCP}/${dir}`
                );
                if (subDirs.includes("Drone")) {
                    const newPath = `Processed/${selectedLocationGCP}/${selectedPopulationGCP}/${dir}/Drone/`;
                    const files = await fetchData(`${flaskUrl}list_files/${newPath}`);
                    const orthoImageFile = files.find((file) => file.includes("-Pyramid.tif"));
                    if (orthoImageFile) {
                        setPrepOrthoImagePath(newPath + orthoImageFile);
                        console.log("Ortho path found, setting to ", newPath + orthoImageFile);
                    } else {
                        console.log("No ortho path found");
                    }
                    break;
                }
            }
        };

        // Function to fetch and set the GCP file path
        const fetchAndSetGcpFilePath = async () => {
            const files = await fetchData(`${flaskUrl}list_files/Raw/${selectedLocationGCP}/${selectedPopulationGCP}`);
            const gcpLocationsFile = files.find((file) => file === "gcp_locations.csv");
            if (gcpLocationsFile) {
                const newPath = `Raw/${selectedLocationGCP}/${selectedPopulationGCP}/${gcpLocationsFile}`;
                setPrepGcpFilePath(newPath);
                console.log("GCP path found, setting to ", newPath);
            } else {
                console.log("No GCP path found");
            }
        };

        // Function to fetch and set the drone image path
        const fetchAndSetDroneImagePath = async () => {
            const dirs = await fetchData(`${flaskUrl}list_dirs/Raw/${selectedLocationGCP}/${selectedPopulationGCP}`);
            for (const dir of dirs) {
                const subDirs = await fetchData(
                    `${flaskUrl}list_dirs/Raw/${selectedLocationGCP}/${selectedPopulationGCP}/${dir}`
                );
                if (subDirs.includes("Drone")) {
                    const newPath = `Raw/${selectedLocationGCP}/${selectedPopulationGCP}/${dir}`;
                    setPrepDroneImagePath(newPath);
                    console.log("Drone path found, setting to ", newPath);
                    break;
                }
            }
        };

        const fetchDataAndUpdatePath = async () => {
            if (selectedLocationGCP && selectedPopulationGCP) {
                try {
                    // Fetch and set Ortho image path
                    if (!prepOrthoImagePath) {
                        await fetchAndSetOrthoImagePath();
                    }

                    // Fetch and set GCP file path
                    if (!prepGcpFilePath) {
                        await fetchAndSetGcpFilePath();
                    }

                    // Fetch and set Drone image path
                    if (!prepDroneImagePath) {
                        await fetchAndSetDroneImagePath();
                    }
                } catch (error) {
                    console.error("Error:", error);
                }
            }
        };

        fetchDataAndUpdatePath();
    }, [selectedLocationGCP, selectedPopulationGCP]);

    // Define handlers for checkbox and path change
    const handleCheckboxChange = (setter) => {
        setter((prev) => !prev);
    };

    const handlePathChange = (setter, newPath) => {
        setter(newPath);
    };

    const allChecked = isOrthoChecked && isGcpChecked && isDroneChecked;
    const droneGcpChecked = isGcpChecked && isDroneChecked && !isOrthoChecked;

    const [isReadyToProceed, setIsReadyToProceed] = useState(false);

    // Effect to run `onDroneGcpProceed` once `selectedDateGCP` is set
    useEffect(() => {
        if (isReadyToProceed) {
            console.log("Selected date set to ", selectedDateGCP);
            onDroneGcpProceed();
            setIsReadyToProceed(false); // Reset the trigger
        }
    }, [isReadyToProceed]);

    const handleProceed = async () => {
        if (allChecked) {
            onProceed();
        } else if (droneGcpChecked) {
            const prepDroneImagePathParts = prepDroneImagePath.split("/");
            const newPathPart =
                prepDroneImagePath[prepDroneImagePath.length - 1] === "/"
                    ? prepDroneImagePathParts[prepDroneImagePathParts.length - 2]
                    : prepDroneImagePathParts[prepDroneImagePathParts.length - 1];
            setSelectedDateGCP(newPathPart);

            setIsReadyToProceed(true);
        }
    };

    return (
        <div>
            <List>
                <ChecklistItem
                    label="Reference orthophoto"
                    path={prepOrthoImagePath}
                    isChecked={isOrthoChecked}
                    onCheckboxChange={() => handleCheckboxChange(setIsOrthoChecked)}
                    onPathChange={(e) => handlePathChange(setPrepOrthoImagePath, e.target.value)}
                />
                <ChecklistItem
                    label="GCP locations file"
                    path={prepGcpFilePath}
                    isChecked={isGcpChecked}
                    onCheckboxChange={() => handleCheckboxChange(setIsGcpChecked)}
                    onPathChange={(e) => handlePathChange(setPrepGcpFilePath, e.target.value)}
                />
                <ChecklistItem
                    label="Reference drone images"
                    path={prepDroneImagePath}
                    isChecked={isDroneChecked}
                    onCheckboxChange={() => handleCheckboxChange(setIsDroneChecked)}
                    onPathChange={(e) => handlePathChange(setPrepDroneImagePath, e.target.value)}
                />
            </List>
            <Button
                variant="contained"
                disabled={!allChecked && !droneGcpChecked}
                color="primary"
                style={{
                    marginTop: "20px",
                    backgroundColor: allChecked || droneGcpChecked ? "" : "grey",
                }}
                onClick={handleProceed}
            >
                {droneGcpChecked ? "Drone GCP Proceed" : "Proceed"}
            </Button>
        </div>
    );
}

export default Checklist;
