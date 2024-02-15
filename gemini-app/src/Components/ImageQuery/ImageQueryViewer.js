import React, { useState, useMemo } from "react";
import Gallery from "react-photo-gallery";
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import { Button } from "@mui/material";
import { useDataState } from "../../DataContext";

const ImageQueryViewer = () => {
    const {
        imageDataQuery,
        flaskUrl,
        selectedYearGCP,
        selectedExperimentGCP,
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedDateQuery,
        selectedPlatformQuery,
        selectedSensorQuery,
    } = useDataState();
    console.log("imageQueryData", imageDataQuery);

    const [currentImage, setCurrentImage] = useState(0);
    const [lightboxIsOpen, setLightboxIsOpen] = useState(false);

    const API_ENDPOINT = `${flaskUrl}files`;
    const imagePrefix = `Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${selectedDateQuery}/${selectedPlatformQuery}/${selectedSensorQuery}/`;

    // Memoize the slides and photos preparation to avoid recalculating on every render
    const slides = useMemo(
        () =>
            imageDataQuery.map((image) => ({
                src: API_ENDPOINT + "/" + imagePrefix + image,
                // Add other properties like 'alt' if available
            })),
        [imageDataQuery]
    );

    const photos = useMemo(
        () =>
            imageDataQuery.map((image) => ({
                src: API_ENDPOINT + "/" + imagePrefix + image,
                width: 4,
                height: 3,
            })),
        [imageDataQuery]
    );

    const openLightbox = (index) => {
        setCurrentImage(index);
        setLightboxIsOpen(true);
    };

    const downloadImages = () => {
        console.log("Download images functionality to be implemented");
    };

    return (
        <div>
            {imageDataQuery.length > 0 ? (
                <>
                    <Gallery photos={photos} onClick={(event, { index }) => openLightbox(index)} />
                    {lightboxIsOpen && (
                        <Lightbox
                            open={lightboxIsOpen}
                            close={() => setLightboxIsOpen(false)}
                            index={currentImage}
                            slides={slides}
                        />
                    )}
                </>
            ) : (
                <div>No images to display</div>
            )}
            <Button variant="contained" color="primary" onClick={downloadImages} style={{ marginTop: "10px" }}>
                Download Images
            </Button>
        </div>
    );
};

export default ImageQueryViewer;
