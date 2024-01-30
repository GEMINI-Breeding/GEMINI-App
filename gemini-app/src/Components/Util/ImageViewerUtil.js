import { useDataState, useDataSetters } from "../../DataContext";

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
    } = useDataState();

    const { setImageList, setGcpPath, setSidebarCollapsed, setTotalImages } = useDataSetters();

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
                    body: JSON.stringify({ basePath: data.selected_images[0].image_path }),
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
