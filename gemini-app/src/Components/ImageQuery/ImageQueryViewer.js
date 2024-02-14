import React, { useState } from "react";
import Gallery from "react-photo-gallery";
import Lightbox from "yet-another-react-lightbox"; // Import Lightbox from yet-another-react-lightbox
import "yet-another-react-lightbox/styles.css"; // Import default styles
import { Button } from "@mui/material";

const ImageQueryViewer = ({ imagePaths }) => {
    const [currentImage, setCurrentImage] = useState(0);
    const [lightboxIsOpen, setLightboxIsOpen] = useState(false);

    // Prepare images for the lightbox
    const slides = imagePaths.map((image) => ({
        src: image.src,
        // Add other properties like 'alt' if available
    }));

    const openLightbox = (index) => {
        setCurrentImage(index);
        setLightboxIsOpen(true);
    };

    const downloadImages = () => {
        console.log("Download images functionality to be implemented");
    };

    return (
        <div>
            {/* <Gallery
                photos={imagePaths.map((image) => ({ src: image.src, width: 4, height: 3 }))}
                onClick={(event, { index }) => openLightbox(index)}
            />
            {lightboxIsOpen && (
                <Lightbox
                    open={lightboxIsOpen}
                    close={() => setLightboxIsOpen(false)}
                    index={currentImage}
                    slides={slides}
                />
            )}
            <Button variant="contained" color="primary" onClick={downloadImages} style={{ marginTop: "10px" }}>
                Download Images
            </Button> */}
        </div>
    );
};

export default ImageQueryViewer;
