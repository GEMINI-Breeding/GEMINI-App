import React, { useEffect, useState, useRef } from "react";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import TextField from "@mui/material/TextField";
import { useDataState, useDataSetters } from "../../../DataContext";

function Checklist({ onProceed, onDroneGcpProceed }) {
    const {
        prepGcpFilePath,
        prepDroneImagePath,
        prepOrthoImagePath,
        selectedLocationGCP,
        selectedPopulationGCP,
        flaskUrl,
    } = useDataState();

    const { setPrepGcpFilePath, setPrepDroneImagePath, setPrepOrthoImagePath, setSelectedDateGCP } = useDataSetters();

    const [checklistItems, setChecklistItems] = useState([
        { label: "Reference orthophoto", path: "", setter: setPrepOrthoImagePath, isChecked: false },
        { label: "GCP locations file", path: "", setter: setPrepGcpFilePath, isChecked: false },
        { label: "Reference drone images", path: "", setter: setPrepDroneImagePath, isChecked: false },
    ]);

    const fetchData = async (url) => {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error("Network response was not ok");
        }
        return await response.json();
    };

    useEffect(() => {
        const fetchDataAndUpdatePath = async () => {
            if (selectedLocationGCP && selectedPopulationGCP) {
                try {
                    // Fetch and set Ortho image path
                    if (!prepOrthoImagePath) {
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
                    }

                    // Fetch and set GCP file path
                    if (!prepGcpFilePath) {
                        const files = await fetchData(
                            `${flaskUrl}list_files/Raw/${selectedLocationGCP}/${selectedPopulationGCP}`
                        );
                        const gcpLocationsFile = files.find((file) => file === "gcp_locations.csv");
                        if (gcpLocationsFile) {
                            const newPath = `Raw/${selectedLocationGCP}/${selectedPopulationGCP}/${gcpLocationsFile}`;
                            setPrepGcpFilePath(newPath);
                            console.log("GCP path found, setting to ", newPath);
                        } else {
                            console.log("No GCP path found");
                        }
                    }

                    // Fetch and set Drone image path
                    if (!prepDroneImagePath) {
                        const dirs = await fetchData(
                            `${flaskUrl}list_dirs/Raw/${selectedLocationGCP}/${selectedPopulationGCP}`
                        );
                        for (const dir of dirs) {
                            const subDirs = await fetchData(
                                `${flaskUrl}list_dirs/Raw/${selectedLocationGCP}/${selectedPopulationGCP}/${dir}`
                            );
                            if (subDirs.includes("Drone")) {
                                const newPath = `Raw/${selectedLocationGCP}/${selectedPopulationGCP}/${dir}/Drone`;
                                setPrepDroneImagePath(newPath);
                                setSelectedDateGCP(dir);
                                console.log("Drone path found, setting to ", newPath);
                                break;
                            }
                        }
                    }
                } catch (error) {
                    console.error("Error:", error);
                }
            }
        };

        fetchDataAndUpdatePath();
    }, [selectedLocationGCP, selectedPopulationGCP, prepGcpFilePath, prepDroneImagePath, prepOrthoImagePath, flaskUrl]);

    useEffect(() => {
        // This effect updates checklistItems based on the fetched paths
        setChecklistItems((prevItems) =>
            prevItems.map((item) => {
                switch (item.label) {
                    case "Reference orthophoto":
                        return { ...item, path: prepOrthoImagePath };
                    case "GCP locations file":
                        return { ...item, path: prepGcpFilePath };
                    case "Reference drone images":
                        return { ...item, path: prepDroneImagePath };
                    default:
                        return item;
                }
            })
        );
    }, [prepGcpFilePath, prepDroneImagePath, prepOrthoImagePath]);

    const handleCheckboxChange = (index) => {
        // If the index is 0 and no other items are checked...
        if (index === 0 && checklistItems.every((item) => !item.isChecked)) {
            // ...check all items
            setChecklistItems((items) => items.map((item) => ({ ...item, isChecked: true })));
        } else {
            // Otherwise, toggle the checkbox
            setChecklistItems((items) =>
                items.map((item, i) => (i === index ? { ...item, isChecked: !item.isChecked } : item))
            );
        }
    };

    const handlePathChange = (event, index) => {
        const newPath = event.target.value;
        setChecklistItems((items) => items.map((item, i) => (i === index ? { ...item, path: newPath } : item)));
        checklistItems[index].setter(newPath); // update centralized state
    };

    const allChecked = checklistItems.every((item) => item.isChecked);
    const droneGcpChecked = checklistItems[1].isChecked && checklistItems[2].isChecked && !checklistItems[0].isChecked;

    const handleProceed = () => {
        if (allChecked) {
            // Call the original onProceed function
            onProceed();
        } else if (droneGcpChecked) {
            // Call the new variant of onProceed function
            onDroneGcpProceed();
        }
    };

    return (
        <div>
            <List>
                {checklistItems.map((itemState, index) => (
                    <ListItem key={index}>
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                width: "80%",
                            }}
                        >
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={itemState.isChecked}
                                        onChange={() => handleCheckboxChange(index)}
                                        color="primary"
                                    />
                                }
                                label={itemState.label}
                            />
                            {itemState.isChecked && (
                                <TextField
                                    label="File Path"
                                    value={itemState.path}
                                    onChange={(event) => handlePathChange(event, index)}
                                    style={{ marginTop: 10 }}
                                    fullWidth
                                />
                            )}
                        </div>
                    </ListItem>
                ))}
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
