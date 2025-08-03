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
                        Label Data
                    </Typography>
                    <Typography variant="body1" align="center" color="textSecondary" gutterBottom>
                        This step will handle data labeling functionality for training machine learning models.
                    </Typography>
                    
                    <Alert severity="info" style={{ marginTop: "20px" }}>
                        <Typography variant="body2">
                            <strong>Future Implementation:</strong>
                            <br />
                            • Upload and manage image datasets
                            <br />
                            • Annotate images with bounding boxes
                            <br />
                            • Quality control and validation of annotations
                            <br />
                            • Integration with labeling tools like CVAT
                        </Typography>
                    </Alert>
                </Paper>
            </Grid>
        </Grid>
    );
}

export default LabelStep;
