import { useDataState, useDataSetters } from "../../DataContext";
import { useEffect, useMemo, useState } from "react";
import { mergeLists } from "../../utils/imageUtils";
import { getGcpSelectedImages, refreshGcpSelectedImages, initializeGcpFile } from '../../api/gcp';

export function useHandleProcessImages() {
    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedDateGCP,
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
        setTotalImages,
        setImageViewerLoading,
        setImageViewerReady
    } = useDataSetters();

    const handleProcessImages = async () => {
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

        setImageViewerLoading(true);
        setImageList([]);

        try {
            const gcpData = await getGcpSelectedImages(data);
            const images = gcpData.images || [];

            if (images.length > 0) {
                setTotalImages(images.length);
            }

            // Build GCP annotation file path from the image directory
            const gcpFilePath = images.length > 0
                ? `${data.year}/${data.experiment}/${data.location}/${data.population}/${data.date}/${data.platform}/${data.sensor}/gcp_annotations.json`
                : null;

            if (gcpFilePath) {
                const fileData = await initializeGcpFile({
                    filePath: gcpFilePath,
                });

                if (fileData && Array.isArray(fileData) && fileData.length > 0) {
                    const mergedList = mergeLists(images, fileData);
                    setImageList(mergedList);
                } else {
                    setImageList(images);
                }

                setGcpPath(gcpFilePath);
            } else {
                setImageList(images);
            }

            setImageViewerLoading(false);
        } catch (error) {
            console.log("Error with data selection, " + error);
            setImageViewerLoading(false);
        }

    };

    return handleProcessImages;
}

export function useHandleGcpRefreshImages() {
    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedDateGCP,
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
        setTotalImages,
        setImageViewerLoading,
    } = useDataSetters();

    const handleGcpRefreshImages = async () => {
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

        setImageViewerLoading(true);
        setImageList([]);

        try {
            const gcpData = await refreshGcpSelectedImages(data);
            const images = gcpData.images || [];

            if (images.length > 0) {
                setTotalImages(images.length);
            }

            const gcpFilePath = images.length > 0
                ? `${data.year}/${data.experiment}/${data.location}/${data.population}/${data.date}/${data.platform}/${data.sensor}/gcp_annotations.json`
                : null;

            if (gcpFilePath) {
                const fileData = await initializeGcpFile({
                    filePath: gcpFilePath,
                });

                if (fileData && Array.isArray(fileData) && fileData.length > 0) {
                    const mergedList = mergeLists(images, fileData);
                    setImageList(mergedList);
                } else {
                    setImageList(images);
                }

                setGcpPath(gcpFilePath);
            } else {
                setImageList(images);
            }

            setImageViewerLoading(false);
        } catch (error) {
            console.log("Error with data selection, " + error);
            setImageViewerLoading(false);
        }

        if (!isSidebarCollapsed) {
            setSidebarCollapsed(true);
        }
    };

    return handleGcpRefreshImages;
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
