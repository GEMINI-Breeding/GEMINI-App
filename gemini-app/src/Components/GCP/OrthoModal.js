import React, { useState, useEffect } from "react";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Autocomplete from "@mui/material/Autocomplete";
import Grid from "@mui/material/Grid";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
    Box,
    LinearProgress,
    IconButton
} from "@mui/material";
import dedent from "dedent";
import Snackbar from "@mui/material/Snackbar";
import { useDataState, useDataSetters } from "../../DataContext";

const OrthoModal = ( {selectedOrthoMethod} ) => {
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
        selectedYearGCP,
        selectedExperimentGCP,
        selectedPlatformGCP,
        selectedSensorGCP
    } = useDataState();

    const { 
        setOrthoSetting, 
        setOrthoCustomValue, 
        setOrthoModalOpen, 
        setIsOrthoProcessing, 
        setOrthoServerStatus,
        setIsImageViewerOpen,
        setProcessRunning,
        setImageViewerLoading
    } = useDataSetters();

    const [submitError, setSubmitError] = useState("");
    // Process sliderMarks to check the label value for pointX and pointY
    const labeledGcpImages = sliderMarks.filter((mark) => mark.label.props.color !== "rgba(255,255,255,0)");
    const labeledGcpImagesCount = labeledGcpImages.length;

    useEffect(() => {
        if (selectedOrthoMethod === "STITCH") {
            // Check if all required parameters are available
            if (!selectedYearGCP || !selectedExperimentGCP || !selectedLocationGCP || !selectedPopulationGCP) {
                console.log("Not all required parameters available for mask check, using default mask");
                setOrthoCustomValue(
                    dedent(`
                        mask: [0, 0, 0, 0]
                        forward_limit: 8
                        max_reprojection_error: 3.0
                        save_full_resolution: True
                        save_resized_resolution: False
                    `)
                );
                return;
            }

            fetch(`${flaskUrl}check_mask`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP
                })
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                let maskValue = [0, 0, 0, 0]; // default mask
                
                if (data.mask && Array.isArray(data.mask) && data.mask.length === 4) {
                    maskValue = data.mask;
                    console.log("Using existing mask from backend:", maskValue);
                } else {
                    console.log("No existing mask found, using default:", maskValue);
                }
                
                setOrthoCustomValue(
                    dedent(`
                        mask: [${maskValue.join(', ')}]
                        forward_limit: 8
                        max_reprojection_error: 3.0
                        save_full_resolution: True
                        save_resized_resolution: False
                    `)
                );
            })
            .catch(error => {
                console.warn("Failed to fetch mask from backend, using default:", error);
                setOrthoCustomValue(
                    dedent(`
                        mask: [0, 0, 0, 0]
                        forward_limit: 8
                        max_reprojection_error: 3.0
                        save_full_resolution: True
                        save_resized_resolution: False
                    `)
                );
            });
        }
    }, [orthoSetting, selectedOrthoMethod, flaskUrl, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP]);

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
        setOrthoModalOpen(false);
        setIsImageViewerOpen(false);
        setProcessRunning(true);
        setOrthoServerStatus("Processing...");
        const data = {
            year: selectedYearGCP,
            experiment: selectedExperimentGCP,
            location: selectedLocationGCP,
            population: selectedPopulationGCP,
            date: selectedDateGCP,
            platform: selectedPlatformGCP,
            sensor: selectedSensorGCP,
            reconstruction_quality: orthoSetting,
            custom_options: orthoCustomValue ? orthoCustomValue : [],
        };
        const endpoint = selectedOrthoMethod === "STITCH" ? "run_stitch" : "run_odm";

        // global variable to find ortho method and data
        window.selectedOrthoMethod = selectedOrthoMethod;
        window.orthoData = data;

        fetch(`${flaskUrl}${endpoint}`, {
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
                setImageViewerLoading(false);
            })
            .catch((error) => {
                console.error("Error:", error);
                setOrthoServerStatus("Error generating ortho");
                setSubmitError("Error starting ortho generation.")
                setImageViewerLoading(false);

                alert("Error starting ortho generation. Please try again.");
            });
    };

    return (
        <Dialog open={isOrthoModalOpen && !isOrthoProcessing} onClose={() => setOrthoModalOpen(false)} maxWidth="md" fullWidth={true}>
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
                            options={["Default", "Custom"]}
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
                            fullWidth
                            multiline
                            minRows={4} // or however many lines you want by default
                            />
                            <Typography align="center" color="error" style={{ marginTop: 8 }}>
                            Only use if you know what you're doing!
                            </Typography>
                        </Grid>
                    )}
                    {/* display if orthoSetting is Low */}
                    {orthoSetting === "Default" && (
                        <Grid item>
                            <Typography variant="body1" style={{ color: 'orange' }}>
                                Warning: Ortho Generation may take up to 2 hours to complete.
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
            <Snackbar
                open={submitError !== ""}
                autoHideDuration={6000}
                onClose={() => setSubmitError("")}
                message={submitError}
            />
        </Dialog>
    );
};

function OrthoProgressBar({ currentOrthoProgress, onStopOrtho }) {
    const { flaskUrl } = useDataState();
    const { setCurrentOrthoProgress, setIsOrthoProcessing, setProcessRunning, setCloseMenu } = useDataSetters();
    const [expanded, setExpanded] = useState(false);
    const validProgress = Number.isFinite(currentOrthoProgress) ? currentOrthoProgress : 0;

    // For log text contents
    const [logContent, setLogContent] = useState("");
    const [loadingLogs, setLoadingLogs] = useState(false);

    useEffect(() => {
        let pollingInterval = null;

        if (expanded) {
            // Fetch logs immediately when expanding
            const fetchLogs = async () => {
                setLoadingLogs(true);
                try {
                    const response = await fetch(`${flaskUrl}get_odm_logs`,{
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({method: window.selectedOrthoMethod, orthoData: window.orthoData}),
                    });
                    const data = await response.json();
                    if (response.ok) {
                        console.log("Logs:", data);
                        //setLogContent(prevContent => prevContent + "\n" + data.log_content); // => Why?
                        setLogContent(data.log_content);
                    } else {
                        console.log("Error fetching logs:", data.error);
                        setLogContent("Error: " + data.error);
                    }
                } catch (error) {
                    setLogContent("Error fetching logs");
                } finally {
                    setLoadingLogs(false);
                }
            };

            fetchLogs();  // Fetch logs immediately
            // Start polling every 30 seconds for new logs
            pollingInterval = setInterval(fetchLogs, 30*1000);
        } else {
            // Clear polling when the panel is collapsed
            clearInterval(pollingInterval);
        }

        return () => {
            if (pollingInterval) {
                clearInterval(pollingInterval);
            }
        };
    }, [expanded]);

    const handleExpandClick = () => {
        setExpanded(!expanded);
    };

    const handleDone = () => {
        setIsOrthoProcessing(false);
        setCurrentOrthoProgress(0); // Reset progress
        setProcessRunning(false);
        setCloseMenu(false);
    };

    const isOrthoComplete = currentOrthoProgress >= 100;

    return (
        <Box sx={{ backgroundColor: "white", padding: "10px", border: "1px solid #e0e0e0", boxSizing: "border-box" }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "start" }}>
                <Typography variant="body2" sx={{ marginRight: "10px" }}>
                    Ortho Generation in Progress...
                </Typography>
                <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center" }}>
                    <Box sx={{ width: "100%", mr: 1 }}>
                        <LinearProgress variant="determinate" value={validProgress} />
                    </Box>
                    <Box sx={{ minWidth: 35, mr: 1 }}>
                        <Typography variant="body2" color="text.secondary">{`${Math.round(validProgress)}%`}</Typography>
                    </Box>
                </Box>
                <Button
                    onClick={() => {
                        onStopOrtho();
                        handleDone();
                    }}
                    style={{
                        backgroundColor: isOrthoComplete ? "green" : "red",
                        color: "white",
                        alignSelf: "center",
                    }}
                >
                    {isOrthoComplete ? "DONE" : "STOP"}
                </Button>
                <IconButton
                    onClick={handleExpandClick}
                    sx={{ transform: expanded ? "rotate(0deg)" : "rotate(180deg)" }}
                >
                    <ExpandMoreIcon />
                </IconButton>
            </Box>
            {expanded && (
                <Box sx={{ marginTop: "10px", maxHeight: "200px", overflowY: "scroll", border: "1px solid #e0e0e0", padding: "10px", borderRadius: "5px" }}>
                    {loadingLogs && !logContent ? (
                        <Typography variant="body2">Loading logs...</Typography>
                    ) : (
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                            {logContent || "Logs are being generated..."}
                        </Typography>
                    )}
                </Box>
            )}
        </Box>
    );
}


export { OrthoModal, OrthoProgressBar };
