import React, { useState } from "react";
import { Grid } from "@mui/material";
import ImageSelection from "./ImageSelection"; // Assuming this is the path to your ImageSelection component
import ImageQueryViewer from "./ImageQueryViewer"; // Assuming this is the path to your ImageViewerComponent

const ImageQueryUI = () => {
    const [imagePaths, setImagePaths] = useState([]);

    // Function to update image paths based on selection (mock implementation)
    // In practice, this function would be triggered by the ImageSelection component after fetching image paths
    const handleImageSelection = (selectedImagePaths) => {
        setImagePaths(selectedImagePaths);
    };

    return (
        <Grid container>
            <Grid item xs={3} style={{ height: "100vh", overflow: "auto" }}>
                {/* Pass the handleImageSelection function as a prop to ImageSelection if needed */}
                <ImageSelection onImageSelection={handleImageSelection} />
            </Grid>
            <Grid item xs={9} style={{ height: "100vh", overflow: "auto" }}>
                {/* Pass the selected image paths to ImageViewerComponent */}
                <ImageQueryViewer imagePaths={imagePaths} />
            </Grid>
        </Grid>
    );
};

export default ImageQueryUI;
