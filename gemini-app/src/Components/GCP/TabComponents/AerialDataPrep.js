import React, { useEffect, useRef } from "react";
import Grid from "@mui/material/Grid";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

import { useDataState, useDataSetters } from "../../../DataContext";
import ImageViewer from "../ImageViewer";
import { useHandleProcessImages } from "../../Util/ImageViewerUtil";

function AerialDataPrep() {
    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedDateGCP,
        dateOptionsGCP,
        flaskUrl,
        radiusMeters,
        isSidebarCollapsed,
        imageList,
        isImageViewerOpen,
    } = useDataState();

    const {
        setSelectedLocationGCP,
        setSelectedPopulationGCP,
        setSelectedDateGCP,
        setDateOptionsGCP,
        setImageList,
        setGcpPath,
        setSidebarCollapsed,
        setTotalImages,
        setIsImageViewerOpen,
    } = useDataSetters();

    const handleProcessImages = useHandleProcessImages();

    // Create a ref for the selected date
    const selectedDateRef = useRef(selectedDateGCP);

    const fetchData = async (url) => {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error("Network response was not ok");
        }
        return await response.json();
    };

    // function mergeLists(imageList, existingData) {
    //     // Create a lookup object for faster search using image name
    //     const dataLookup = existingData.reduce((acc, image) => {
    //         acc[image.image_path.split("/").pop()] = image;
    //         return acc;
    //     }, {});

    //     // Merge the lists
    //     return imageList.map(image => {
    //         const imageName = image.image_path.split("/").pop();
    //         if (dataLookup[imageName]) {
    //             // If the image name exists in the previous data, append pointX and pointY
    //             return {
    //                 ...image,
    //                 pointX: dataLookup[imageName].pointX,
    //                 pointY: dataLookup[imageName].pointY
    //             };
    //         }
    //         return image; // Return the image as it is if no match found
    //     });
    // }

    // const handleProcessImages = () => {

    //     const data = {
    //         location: selectedLocationGCP,
    //         population: selectedPopulationGCP,
    //         date: selectedDateGCP,
    //         radius_meters: radiusMeters,
    //     };

    //     console.log('data', data);
    //     console.log('flaskUrl', flaskUrl);
    //     console.log(`${flaskUrl}process_images`)

    //     fetch(`${flaskUrl}process_images`, {
    //         method: 'POST',
    //         headers: {
    //             'Content-Type': 'application/json'
    //         },
    //         body: JSON.stringify(data)
    //     })
    //         .then(response => response.json())
    //         .then(data => {
    //             if (data.num_total) {
    //                 setTotalImages(data.num_total);
    //             }
    //             // Before setting the image list, initialize (or fetch existing) file content
    //             fetch(`${flaskUrl}initialize_file`, {
    //                 method: 'POST',
    //                 headers: {
    //                     'Content-Type': 'application/json'
    //                 },
    //                 body: JSON.stringify({ basePath: data.selected_images[0].image_path })
    //             })
    //                 .then(fileResponse => fileResponse.json())
    //                 .then(fileData => {
    //                     console.log('fileData', fileData);

    //                     if (fileData.existing_data && fileData.existing_data.length > 0) {
    //                         // Logic to merge existing data with current imageList
    //                         const mergedList = mergeLists(data.selected_images, fileData.existing_data);
    //                         setImageList(mergedList);
    //                     } else {
    //                         setImageList(data.selected_images);
    //                     }

    //                     if (fileData.file_path) {
    //                         setGcpPath(fileData.file_path);
    //                     } else {
    //                         console.log('No GCP path found again');
    //                     }
    //                 });
    //         });

    //     // If the sidebar is not collapsed, collapse it
    //     if (!isSidebarCollapsed) {
    //         setSidebarCollapsed(true);
    //     }
    // };

    useEffect(() => {
        const fetchDataAndUpdate = async () => {
            if (selectedLocationGCP && selectedPopulationGCP) {
                try {
                    const dates = await fetchData(
                        `${flaskUrl}list_dirs/Raw/${selectedLocationGCP}/${selectedPopulationGCP}`
                    );

                    const orthoCheckPromises = dates.map(async (date) => {
                        const files = await fetchData(
                            `${flaskUrl}list_files/Processed/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/Drone`
                        );
                        return files.some((file) => file.endsWith("Pyramid.tif"));
                    });

                    const isOrthoGenerated = await Promise.all(orthoCheckPromises);

                    const updatedDates = dates.map((date, index) => ({
                        label: date,
                        completed: isOrthoGenerated[index],
                    }));

                    setDateOptionsGCP(updatedDates);
                } catch (error) {
                    console.error("Error:", error);
                }
            }
        };

        fetchDataAndUpdate();
    }, [selectedLocationGCP, selectedPopulationGCP]);

    const handleOptionClick = (option) => {
        // Set date to option.label
        setSelectedDateGCP(option.label);
        setIsImageViewerOpen(true);
        console.log("Selected date", selectedDateGCP);
    };

    // Check to see if the selected date has changed from the ref
    // and if it has, then run the handleProcessImages function
    useEffect(() => {
        if (selectedDateRef.current !== selectedDateGCP) {
            handleProcessImages();
            selectedDateRef.current = selectedDateGCP;
        }
    }, [selectedDateGCP]);

    if (imageList.length > 0 && isImageViewerOpen) {
        console.log("imageList", imageList);
        console.log("imageList[0].image_path", imageList[0].image_path);
        console.log(selectedDateGCP, selectedLocationGCP, selectedPopulationGCP);

        return (
            <Grid container direction="column" alignItems="center" style={{ width: "80%", margin: "0 auto" }}>
                <ImageViewer />
            </Grid>
        );
    }

    return (
        <Grid container direction="column" alignItems="center" style={{ width: "50%", margin: "0 auto" }}>
            <Typography variant="h4" component="h2" align="center">
                Aerial Datasets
            </Typography>

            {/* RGB Section */}
            <Typography variant="h6" component="h3" align="center" style={{ marginTop: "20px" }}>
                RGB
            </Typography>
            <List style={{ width: "100%" }}>
                {dateOptionsGCP.map((option, index) => (
                    <div key={"rgb-" + index}>
                        <ListItemButton onClick={() => handleOptionClick(option)}>
                            <Grid container alignItems="center">
                                <Grid item xs={10}>
                                    <ListItemText
                                        primary={option.label}
                                        primaryTypographyProps={{ fontSize: "1.25rem" }}
                                    />
                                </Grid>
                                <Grid item xs={2}>
                                    {option.completed && <CheckCircleIcon style={{ color: "green" }} />}
                                </Grid>
                            </Grid>
                        </ListItemButton>
                        {index !== dateOptionsGCP.length - 1 && <Divider />}
                    </div>
                ))}
            </List>
        </Grid>
    );
}

export default AerialDataPrep;
