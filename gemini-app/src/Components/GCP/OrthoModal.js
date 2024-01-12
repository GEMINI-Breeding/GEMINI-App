import React from "react";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Autocomplete from "@mui/material/Autocomplete";
import Grid from "@mui/material/Grid";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";

import { useDataState, useDataSetters } from "../../DataContext";

const OrthoModal = () => {
    const {
        orthoSetting,
        orthoCustomValue,
        isOrthoModalOpen,
        totalImages,
        sliderMarks,
        isOrthoProcessing,
        orthoServerStatus,
        flaskUrl,
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedDateGCP,
    } = useDataState();

    const { setOrthoSetting, setOrthoCustomValue, setOrthoModalOpen, setIsOrthoProcessing, setOrthoServerStatus } =
        useDataSetters();

    // Process sliderMarks to check the label value for pointX and pointY
    const labeledGcpImages = sliderMarks.filter((mark) => mark.label.props.color !== "rgba(255,255,255,0)");
    const labeledGcpImagesCount = labeledGcpImages.length;

    /*
    Python args for ODM:
    data = request.json
    location = data.get('location')
    population = data.get('population')
    date = data.get('date')
    sensor = data.get('sensor')
    temp_dir = data.get('temp_dir')
    reconstruction_quality = data.get('reconstruction_quality')
    custom_options = data.get('custom_options')
    */

    const handleGenerateOrtho = () => {
        setIsOrthoProcessing(true);
        setOrthoServerStatus("Processing...");
        const data = {
            location: selectedLocationGCP,
            population: selectedPopulationGCP,
            date: selectedDateGCP,
            sensor: "Drone",
            reconstruction_quality: orthoSetting,
            custom_options: orthoCustomValue ? orthoCustomValue : [],
        };
        fetch(`${flaskUrl}run_odm`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(data),
        })
            .then((response) => {
                if (!response.ok) {
                    throw new Error("Error generating ortho");
                }
                return response.json();
            })
            .then((data) => {
                console.log("Success:", data);
                setOrthoServerStatus("Success!");
            })
            .catch((error) => {
                console.error("Error:", error);
                setOrthoServerStatus("Error generating ortho");
            })
            .finally(() => {
                setIsOrthoProcessing(false);
            });
    };

    return (
        <Dialog open={isOrthoModalOpen} onClose={() => setOrthoModalOpen(false)} maxWidth="md" fullWidth={true}>
            <DialogTitle style={{ textAlign: "center", fontWeight: "bold", fontSize: "x-large" }}>
                Generate Orthophoto
            </DialogTitle>
            <DialogContent>
                <Grid container direction="column" spacing={3}>
                    {" "}
                    {/* Spacing between items */}
                    <Grid item>
                        <Typography variant="body1">Total Images: {totalImages}</Typography>
                    </Grid>
                    <Grid item>
                        <Typography variant="body1">Labeled GCP Images: {labeledGcpImagesCount}</Typography>
                    </Grid>
                    <Grid item>
                        <Autocomplete
                            value={orthoSetting}
                            onChange={(event, newValue) => setOrthoSetting(newValue)}
                            options={["High", "Low", "Custom"]}
                            renderInput={(params) => (
                                <TextField {...params} label="Settings" variant="outlined" fullWidth />
                            )}
                        />
                    </Grid>
                    {orthoSetting === "Custom" && (
                        <Grid item>
                            <TextField
                                label="Custom Settings"
                                value={orthoCustomValue}
                                onChange={(e) => setOrthoCustomValue(e.target.value)}
                                fullWidth // Using full width for consistent layout
                            />
                            <Typography align="center" color="error" style={{ marginTop: 8 }}>
                                OpenDroneMap args. Only use if you know what you're doing!
                            </Typography>
                        </Grid>
                    )}
                </Grid>
                <br />
                <Grid container justifyContent="center" style={{ marginTop: "20px" }}>
                    <Button
                        variant="contained"
                        color="primary"
                        disabled={isOrthoProcessing}
                        onClick={() => handleGenerateOrtho()}
                    >
                        {isOrthoProcessing ? "Processing" : "Process Images"}
                        {isOrthoProcessing && <CircularProgress size={24} style={{ marginLeft: "14px" }} />}
                    </Button>
                </Grid>
                {orthoServerStatus && (
                    <Typography variant="body2" style={{ marginTop: "10px", color: "black" }}>
                        {orthoServerStatus}
                    </Typography>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default OrthoModal;
