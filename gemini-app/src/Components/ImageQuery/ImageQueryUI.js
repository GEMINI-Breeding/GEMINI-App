import React, { useState } from "react";
import { Grid } from "@mui/material";
import ImageSelection from "./ImageSelection"; // Assuming this is the path to your ImageSelection component
import ImageQueryViewer from "./ImageQueryViewer"; // Assuming this is the path to your ImageViewerComponent
import { useDataState, useDataSetters } from "../../DataContext";
import useTrackComponent from "../../useTrackComponent";

const ImageQueryUI = () => {
    useTrackComponent("ImageQueryUI");

    return (
        <Grid container direction={"row"}>
            <Grid item xs={1} style={{ height: "100vh" }}>
                <div></div>
            </Grid>
            <Grid item xs={3} style={{ height: "100vh", overflow: "auto" }}>
                {/* Pass the handleImageSelection function as a prop to ImageSelection if needed */}
                <ImageSelection />
            </Grid>
            <Grid item xs={8} style={{ height: "100vh", overflow: "auto" }}>
                {/* Pass the selected image paths to ImageViewerComponent */}
                <ImageQueryViewer />
            </Grid>
        </Grid>
    );
};

export default ImageQueryUI;
