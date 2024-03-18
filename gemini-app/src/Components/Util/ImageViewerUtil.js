import { useDataState, useDataSetters } from "../../DataContext";
import { useEffect, useMemo, useState } from "react";

export function useHandleProcessImages() {
    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedDateGCP,
        flaskUrl,
        radiusMeters,
        isSidebarCollapsed,
        selectedYearGCP,
        selectedExperimentGCP,
        selectedSensorGCP,
        selectedPlatformGCP,
    } = useDataState();

    const { 
        setImageList, 
        setGcpPath, 
        setSidebarCollapsed, 
        setTotalImages 
    } = useDataSetters();

    const mergeLists = function (imageList, existingData) {
        // Create a lookup object for faster search using image name
        const dataLookup = existingData.reduce((acc, image) => {
            acc[image.image_path.split("/").pop()] = image;
            return acc;
        }, {});

        // Merge the lists
        return imageList.map((image) => {
            const imageName = image.image_path.split("/").pop();
            if (dataLookup[imageName]) {
                // If the image name exists in the previous data, append pointX and pointY
                return {
                    ...image,
                    pointX: dataLookup[imageName].pointX,
                    pointY: dataLookup[imageName].pointY,
                };
            }
            return image; // Return the image as it is if no match found
        });
    };

    const handleProcessImages = () => {
        const data = {
            location: selectedLocationGCP,
            population: selectedPopulationGCP,
            date: selectedDateGCP,
            radius_meters: radiusMeters,
            year: selectedYearGCP,
            experiment: selectedExperimentGCP,
            sensor: selectedSensorGCP,
            platform: selectedPlatformGCP,
        };

        fetch(`${flaskUrl}process_images`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
        })
            .then((response) => response.json())
            .then((data) => {
                if (data.num_total) {
                    setTotalImages(data.num_total);
                }
                // Before setting the image list, initialize (or fetch existing) file content
                fetch(`${flaskUrl}initialize_file`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ 
                        basePath: data.selected_images[0].image_path,
                        platform: selectedPlatformGCP,
                        sensor: selectedSensorGCP,
                     }),
                })
                    .then((fileResponse) => fileResponse.json())
                    .then((fileData) => {
                        console.log("fileData", fileData);

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
                            console.log("No GCP path found again");
                        }
                    });
            });

        // If the sidebar is not collapsed, collapse it
        if (!isSidebarCollapsed) {
            setSidebarCollapsed(true);
        }
    };

    return handleProcessImages;
}

const Checkmark = ({ selected }) => (
    <div style={selected ? { left: "4px", top: "4px", position: "absolute", zIndex: "1" } : { display: "none" }}>
        <svg style={{ fill: "white", position: "absolute" }} width="24px" height="24px">
            <circle cx="12.5" cy="12.2" r="8.292" />
        </svg>
        <svg style={{ fill: "#06befa", position: "absolute" }} width="24px" height="24px">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
        </svg>
    </div>
);

const imgStyle = {
    transition: "transform .135s cubic-bezier(0.0,0.0,0.2,1),opacity linear .15s",
};
const cont = {
    backgroundColor: "#eee",
    cursor: "pointer",
    overflow: "hidden",
    position: "relative",
};

export const SelectedImage = ({ index, photo, margin, direction, top, left, selected, onClick }) => {
    const { isLightboxOpen, currentImageIndex } = useDataState();

    const { setIsLightboxOpen, setCurrentImageIndex } = useDataSetters();

    //calculate x,y scale
    const sx = (100 - (30 / photo.width) * 100) / 100;
    const sy = (100 - (30 / photo.height) * 100) / 100;

    if (direction === "column") {
        cont.position = "absolute";
        cont.left = left;
        cont.top = top;
    }

    const handleOnClick = () => {
        setIsLightboxOpen(true);
        setCurrentImageIndex(index);
    };

    const toggleTitleBar = (opacity) => {
        const titleBar = document.getElementById(`title-bar-${index}`);
        if (titleBar) {
            titleBar.style.opacity = opacity;
        }
    };

    return (
        <div
            style={{ margin, height: photo.height, width: photo.width, ...cont }}
            className={"thumbnail"}
            onMouseOver={() => toggleTitleBar(1)}
            onMouseOut={() => toggleTitleBar(0)}
        >
            <img style={{ ...imgStyle }} {...photo} onClick={handleOnClick} />
            {/* <style>{`.thumbnail:hover{outline:2px solid #06befa}`}</style> */}
            <div
                id={`title-bar-${index}`}
                style={{
                    position: "absolute",
                    bottom: 0,
                    width: "100%",
                    textAlign: "center",
                    color: "white",
                    backgroundColor: "rgba(0, 0, 0, 0.5)",
                    padding: "10px",
                    opacity: 0, // initially invisible
                    transition: "opacity 0.5s ease", // smooth transition
                }}
            >
                Accession: {photo.label} Plot: {photo.plot}
            </div>
        </div>
    );
};
