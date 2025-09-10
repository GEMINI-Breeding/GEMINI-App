// TrainStep.js
import React from "react";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Alert from "@mui/material/Alert";
import { useDataState } from "../../../../DataContext";

import useTrackComponent from "../../../../useTrackComponent";

function TrainStep() {
    useTrackComponent("TrainStep");

    return (
        <Grid container justifyContent="center" spacing={2}>
            <Grid item xs={12}>
                <Paper elevation={3} style={{ padding: "20px", margin: "10px 0" }}>
                    <Typography variant="h5" gutterBottom align="center">
                        Tune Extraction
                    </Typography>
                    <Typography variant="body1" align="center" color="textSecondary" gutterBottom>
                        Augment collected data to better align with a pretrained model's training data or retrain model based on image color space differences.
                    </Typography>
                    
                    <Alert severity="info" style={{ marginTop: "20px" }}>
                        <Typography variant="body2">
                            <strong>Future Implementation:</strong>
                            <br />
                            • Options to normalize input data before inference based on model training data LAB color space.
                            <br />
                            • Options to run AGILE to domain translate input data to match model training data.
                            <br />
                            • Options to retrain model based on image color space differences.
                            <br />
                        </Typography>
                    </Alert>
                </Paper>
            </Grid>
        </Grid>
    );
}

export default TrainStep;
