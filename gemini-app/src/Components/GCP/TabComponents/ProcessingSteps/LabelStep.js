// LabelStep.js
import React from "react";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Alert from "@mui/material/Alert";
import { useDataState } from "../../../../DataContext";

import useTrackComponent from "../../../../useTrackComponent";

function LabelStep() {
    useTrackComponent("LabelStep");

    return (
        <Grid container justifyContent="center" spacing={2}>
            <Grid item xs={12}>
                <Paper elevation={3} style={{ padding: "20px", margin: "10px 0" }}>
                    <Typography variant="h5" gutterBottom align="center">
                        Select Model
                    </Typography>
                    <Typography variant="body1" align="center" color="textSecondary" gutterBottom>
                        Prepare for trait extraction by labeling images and training a model using Roboflow or selecting a pre-trained model from Roboflow Universe.
                    </Typography>
                    
                    <Alert severity="info" style={{ marginTop: "20px" }}>
                        <Typography variant="body2">
                            <strong>Prepare for Trait Extraction</strong>
                            <br /> 
                            • Create a Roboflow account: <a href="https://app.roboflow.com" target="_blank" rel="noopener noreferrer">app.roboflow.com</a>.
                            <br />
                            • Create a new workspace. 
                            <br />
                            • If you are training a new model, create a new project and name it as desired based on the trait(s) you are labelling.
                            <br />
                            <br />
                            <strong><i>Method 1: Label and Train Custom Model</i></strong>
                            <br />
                            • Download plot images from the manage files tab. Upload them to your Roboflow project.
                            <br />
                            • Use the Roboflow labeling tool to annotate your images.
                            <br />
                            • Train your model in Roboflow.
                            <br />
                            • Note your model ID, version, and API key.
                            <br />
                            • Proceed to the <strong>Predict</strong> step to extract traits using your model.
                            <br />
                            <br />
                            <strong><i>Method 2: Use Pretrained Model</i></strong>
                            <br />
                            • Select a pretrained model from Roboflow Universe that is close to your use case: <a href="https://universe.roboflow.com" target="_blank" rel="noopener noreferrer">universe.roboflow.com</a>.
                            <br />
                            • Use the <strong>Fork Project</strong> button to create a copy of the model in your workspace.
                            <br />
                            • Note the model ID, version, and API key.
                            <br />
                        </Typography>
                    </Alert>
                </Paper>
            </Grid>
        </Grid>
    );
}

export default LabelStep;
