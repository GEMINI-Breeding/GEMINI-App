import React, { useState, useMemo } from "react";
import Gallery from "react-photo-gallery";
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import { Button } from "@mui/material";
import { useDataState, useDataSetters } from "../../DataContext";
import { SelectedImage } from "../Util/ImageViewerUtil";

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
        currentImageIndex,
        isLightboxOpen,
    } = useDataState();

    const { setCurrentImageIndex, setIsLightboxOpen } = useDataSetters();
    console.log("imageQueryData", imageDataQuery);

    const API_ENDPOINT = `${flaskUrl}files`;

    // Memoize the slides and photos preparation to avoid recalculating on every render
    const slides = useMemo(
        () =>
            imageDataQuery.map((image) => ({
                src: API_ENDPOINT + "/" + image.imageName,
                // Add other properties like 'alt' if available
            })),
        [imageDataQuery]
    );

    const photos = useMemo(
        () =>
            imageDataQuery.map((image) => ({
                src: API_ENDPOINT + "/" + image.imageName,
                // width: image.width,
                // height: image.height,
                label: image.label,
                imageName: image.imageName,
                plot: image.plot,
            })),
        [imageDataQuery]
    );

    const imageRenderer = ({ index, left, top, key, photo }) => (
        <SelectedImage selected={false} key={key} margin={"2px"} index={index} photo={photo} left={left} top={top} />
    );

    return (
        <div style={{ paddingTop: "25px" }}> 
            {imageDataQuery.length > 0 ? (
                <>
                    <Gallery
                        photos={photos}
                        // onClick={(event, { index }) => openLightbox(index)}
                        renderImage={imageRenderer}
                    />
                    {isLightboxOpen && (
                        <Lightbox
                            open={isLightboxOpen}
                            close={() => setIsLightboxOpen(false)}
                            index={currentImageIndex}
                            slides={slides}
                        />
                    )}
                </>
            ) : (
                <div>No images to display</div>
            )}
        </div>
    );
};

export default ImageQueryViewer;
