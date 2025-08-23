// PredictStep.js
import React, { useState, useEffect } from "react";
import Grid from "@mui/material/Grid";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import InputAdornment from "@mui/material/InputAdornment";
import IconButton from "@mui/material/IconButton";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { useDataState } from "../../../../DataContext";
import InferenceTable from "../../../StatsMenu/InferenceTable";

import useTrackComponent from "../../../../useTrackComponent";

function PredictStep() {
    useTrackComponent("PredictStep");

    const { 
        flaskUrl,
        selectedYearGCP,
        selectedExperimentGCP,
        selectedLocationGCP,
        selectedPopulationGCP
    } = useDataState();

    // Roboflow API configuration
    const [inferenceMode, setInferenceMode] = useState("cloud"); // 'cloud' or 'local'
    const [apiUrl, setApiUrl] = useState("https://detect.roboflow.com");
    const [apiKey, setApiKey] = useState("");
    const [modelId, setModelId] = useState("");
    const [showApiKey, setShowApiKey] = useState(false);

    // Data selection (using existing GCP selections for first 4, then additional dropdowns)
    const [dateOptions, setDateOptions] = useState([]);
    const [selectedDate, setSelectedDate] = useState("");
    const [platformOptions, setPlatformOptions] = useState([]);
    const [selectedPlatform, setSelectedPlatform] = useState("");
    const [sensorOptions, setSensorOptions] = useState([]);
    const [selectedSensor, setSelectedSensor] = useState("");
    const [agrowstitchOptions, setAgrowstitchOptions] = useState([]);
    const [selectedAgrowstitch, setSelectedAgrowstitch] = useState("");

    // Processing state
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [results, setResults] = useState(null);
    const [inferenceRefreshTrigger, setInferenceRefreshTrigger] = useState(0);

    // Load dates when GCP selections are available
    useEffect(() => {
        if (selectedYearGCP && selectedExperimentGCP && selectedLocationGCP && selectedPopulationGCP) {
            loadDates();
        }
    }, [selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP]);

    useEffect(() => {
        if (selectedYearGCP && selectedExperimentGCP && selectedLocationGCP && selectedPopulationGCP && selectedDate) {
            loadPlatforms();
        }
    }, [selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP, selectedDate]);

    useEffect(() => {
        if (selectedYearGCP && selectedExperimentGCP && selectedLocationGCP && selectedPopulationGCP && selectedDate && selectedPlatform) {
            loadSensors();
        }
    }, [selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP, selectedDate, selectedPlatform]);

    useEffect(() => {
        if (selectedYearGCP && selectedExperimentGCP && selectedLocationGCP && selectedPopulationGCP && selectedDate && selectedPlatform && selectedSensor) {
            loadAgrowstitchVersions();
        }
    }, [selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP, selectedDate, selectedPlatform, selectedSensor]);

    const loadDates = async () => {
        try {
            const response = await fetch(`${flaskUrl}get_dates`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    year: selectedYearGCP, 
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP
                })
            });
            if (response.ok) {
                const data = await response.json();
                setDateOptions(data.dates || []);
            }
        } catch (error) {
            console.error("Error loading dates:", error);
        }
    };

    const loadPlatforms = async () => {
        try {
            const response = await fetch(`${flaskUrl}get_platforms`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    year: selectedYearGCP, 
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date: selectedDate
                })
            });
            if (response.ok) {
                const data = await response.json();
                setPlatformOptions(data.platforms || []);
            }
        } catch (error) {
            console.error("Error loading platforms:", error);
        }
    };

    const loadSensors = async () => {
        try {
            const response = await fetch(`${flaskUrl}get_sensors`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    year: selectedYearGCP, 
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date: selectedDate,
                    platform: selectedPlatform
                })
            });
            if (response.ok) {
                const data = await response.json();
                setSensorOptions(data.sensors || []);
            }
        } catch (error) {
            console.error("Error loading sensors:", error);
        }
    };

    const loadAgrowstitchVersions = async () => {
        try {
            const response = await fetch(`${flaskUrl}get_agrowstitch_versions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    year: selectedYearGCP, 
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date: selectedDate,
                    platform: selectedPlatform,
                    sensor: selectedSensor
                })
            });
            if (response.ok) {
                const data = await response.json();
                setAgrowstitchOptions(data.versions || []);
            }
        } catch (error) {
            console.error("Error loading AgRowStitch versions:", error);
        }
    };

    const handleRunInference = async () => {
        if (!apiKey || !modelId || !selectedYearGCP || !selectedExperimentGCP || !selectedLocationGCP || 
            !selectedPopulationGCP || !selectedDate || !selectedPlatform || !selectedSensor || !selectedAgrowstitch) {
            setError("Please fill in all required fields");
            return;
        }

        setIsProcessing(true);
        setError("");
        setProgress(0);
        setMessage("Starting inference...");
        setResults(null);

        // Set API URL based on inference mode
        let selectedApiUrl = inferenceMode === "local" ? "http://localhost:9001" : "https://detect.roboflow.com";

        try {
            const response = await fetch(`${flaskUrl}run_roboflow_inference`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    apiUrl: selectedApiUrl,
                    inferenceMode,
                    apiKey,
                    modelId,
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date: selectedDate,
                    platform: selectedPlatform,
                    sensor: selectedSensor,
                    agrowstitchDir: selectedAgrowstitch
                })
            });

            if (response.ok) {
                const data = await response.json();
                setMessage(data.message || "Inference started successfully");
                
                // Poll for progress
                pollProgress();
            } else {
                const errorData = await response.json();
                setError(errorData.error || "Failed to start inference");
                setIsProcessing(false);
            }
        } catch (error) {
            console.error("Error starting inference:", error);
            setError("Network error occurred");
            setIsProcessing(false);
        }
    };

    const pollProgress = () => {
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`${flaskUrl}get_inference_progress`);
                if (response.ok) {
                    const data = await response.json();
                    setProgress(data.progress || 0);
                    setMessage(data.message || "Processing...");
                    
                    if (data.completed) {
                        setIsProcessing(false);
                        setResults(data.results);
                        setMessage("Inference completed successfully!");
                        setInferenceRefreshTrigger(prev => prev + 1); // Trigger refresh of inference table
                        clearInterval(interval);
                    } else if (data.error) {
                        setError(data.error);
                        setIsProcessing(false);
                        clearInterval(interval);
                    }
                }
            } catch (error) {
                console.error("Error polling progress:", error);
            }
        }, 2000);

        // Clean up interval after 30 minutes
        setTimeout(() => clearInterval(interval), 30 * 60 * 1000);
    };

    const isFormValid = apiKey && modelId && selectedYearGCP && selectedExperimentGCP && 
                      selectedLocationGCP && selectedPopulationGCP && selectedDate && 
                      selectedPlatform && selectedSensor && selectedAgrowstitch;

    // Check if GCP selections are available
    const hasGCPSelections = selectedYearGCP && selectedExperimentGCP && selectedLocationGCP && selectedPopulationGCP;

    if (!hasGCPSelections) {
        return (
            <Grid container justifyContent="center" spacing={2}>
                <Grid item xs={12}>
                    <Paper elevation={3} style={{ padding: "20px", margin: "10px 0" }}>
                        <Typography variant="h5" gutterBottom align="center">
                            Roboflow Inference
                        </Typography>
                        <Alert severity="warning" style={{ marginTop: "20px" }}>
                            <Typography variant="body2">
                                Please select Year, Experiment, Location, and Population from the GCP Picker menu first, 
                                then click "Begin Data Preparation" to access the inference functionality.
                            </Typography>
                        </Alert>
                    </Paper>
                </Grid>
            </Grid>
        );
    }

    return (
        <Grid container justifyContent="center" spacing={2}>
            <Grid item xs={12}>
                <Paper elevation={3} style={{ padding: "20px", margin: "10px 0" }}>
                    <Typography variant="h5" gutterBottom align="center">
                        Roboflow Inference
                    </Typography>
                    <Typography variant="body2" align="center" color="textSecondary" gutterBottom>
                        Run inference on plots using your Roboflow trained models
                    </Typography>

                    <Grid container spacing={3} style={{ marginTop: "20px" }}>
                        {/* Current Dataset Info */}
                        {/* <Grid item xs={12}>
                            <Alert severity="info" style={{ marginBottom: "20px" }}>
                                <Typography variant="body2">
                                    <strong>Selected Dataset:</strong> {selectedYearGCP} → {selectedExperimentGCP} → {selectedLocationGCP} → {selectedPopulationGCP}
                                </Typography>
                            </Alert>
                        </Grid> */}

                        {/* Roboflow Configuration */}
                        <Grid item xs={12}>
                            <Typography variant="h6" gutterBottom>
                                Roboflow Configuration
                            </Typography>
                        </Grid>
                        
                        <Grid item xs={12} md={4}>
                            <FormControl fullWidth>
                                <InputLabel id="inference-mode-label">Inference Mode</InputLabel>
                                <Select
                                    labelId="inference-mode-label"
                                    label="Inference Mode"
                                    value={inferenceMode}
                                    onChange={(e) => setInferenceMode(e.target.value)}
                                >
                                    <MenuItem value="cloud">Remote (Cloud)</MenuItem>
                                    <MenuItem value="local">Local</MenuItem>
                                </Select>
                                <Typography variant="caption" color="textSecondary">
                                    {inferenceMode === "cloud"
                                        ? "https://detect.roboflow.com"
                                        : "http://localhost:9001 (requires local inference server)"}
                                </Typography>
                            </FormControl>
                        </Grid>
                        
        <Grid item xs={12} md={4}>
            <TextField
                fullWidth
                label="API Key *"
                type={showApiKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                helperText="Your Roboflow API key"
                InputProps={{
                    endAdornment: (
                        <InputAdornment position="end">
                            <IconButton
                                aria-label="toggle password visibility"
                                onClick={() => setShowApiKey(!showApiKey)}
                                edge="end"
                            >
                                {showApiKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                            </IconButton>
                        </InputAdornment>
                    ),
                }}
            />
        </Grid>                        <Grid item xs={12} md={4}>
                            <TextField
                                fullWidth
                                label="Model ID *"
                                value={modelId}
                                onChange={(e) => setModelId(e.target.value)}
                                helperText="Format: project_id/version_id"
                                placeholder="e.g., my-project/1"
                            />
                        </Grid>

                        {/* Additional Data Selection */}
                        <Grid item xs={12}>
                            <Typography variant="h6" gutterBottom style={{ marginTop: "20px" }}>
                                Additional Selection
                            </Typography>
                        </Grid>

                        <Grid item xs={12} md={3}>
                            <FormControl fullWidth>
                                <InputLabel id="date-label">Date *</InputLabel>
                                <Select
                                    labelId="date-label"
                                    label="Date *"
                                    value={selectedDate}
                                    onChange={(e) => setSelectedDate(e.target.value)}
                                >
                                    {dateOptions.map((date) => (
                                        <MenuItem key={date} value={date}>{date}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>

                        <Grid item xs={12} md={3}>
                            <FormControl fullWidth disabled={!selectedDate}>
                                <InputLabel id="platform-label">Platform *</InputLabel>
                                <Select
                                    labelId="platform-label"
                                    label="Platform *"
                                    value={selectedPlatform}
                                    onChange={(e) => setSelectedPlatform(e.target.value)}
                                >
                                    {platformOptions.map((platform) => (
                                        <MenuItem key={platform} value={platform}>{platform}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>

                        <Grid item xs={12} md={3}>
                            <FormControl fullWidth disabled={!selectedPlatform}>
                                <InputLabel id="sensor-label">Sensor *</InputLabel>
                                <Select
                                    labelId="sensor-label"
                                    label="Sensor *"
                                    value={selectedSensor}
                                    onChange={(e) => setSelectedSensor(e.target.value)}
                                >
                                    {sensorOptions.map((sensor) => (
                                        <MenuItem key={sensor} value={sensor}>{sensor}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>

                        <Grid item xs={12} md={3}>
                            <FormControl fullWidth disabled={!selectedSensor}>
                                <InputLabel id="orthomosaic-label">Orthomosaic</InputLabel>
                                <Select
                                    labelId="orthomosaic-label"
                                    label="Orthomosaic"
                                    value={selectedAgrowstitch}
                                    onChange={(e) => setSelectedAgrowstitch(e.target.value)}
                                >
                                    {agrowstitchOptions.map((version) => (
                                        <MenuItem key={version} value={version}>{version}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Grid>

                        {/* Action Buttons */}
                        <Grid item xs={12} style={{ textAlign: "center", marginTop: "20px" }}>
                            <Button
                                variant="contained"
                                color="primary"
                                size="large"
                                onClick={handleRunInference}
                                disabled={!isFormValid || isProcessing}
                                startIcon={isProcessing ? <CircularProgress size={20} /> : null}
                            >
                                {isProcessing ? "Running Inference..." : "Run Inference"}
                            </Button>
                        </Grid>

                        {/* Progress and Status */}
                        {isProcessing && (
                            <Grid item xs={12}>
                                <Box style={{ textAlign: "center", marginTop: "20px" }}>
                                    <CircularProgress variant="determinate" value={progress} size={60} />
                                    <Typography variant="body2" style={{ marginTop: "10px" }}>
                                        {progress}% - {message}
                                    </Typography>
                                </Box>
                            </Grid>
                        )}

                        {/* Error Display */}
                        {error && (
                            <Grid item xs={12}>
                                <Alert severity="error">{error}</Alert>
                            </Grid>
                        )}

                        {/* Results Display */}
                        {results && (
                            <Grid item xs={12}>
                                <Paper elevation={2} style={{ padding: "15px", marginTop: "20px" }}>
                                    <Typography variant="h6" gutterBottom>
                                        Inference Results
                                    </Typography>
                                    {/* <Typography variant="body2" gutterBottom>
                                        CSV file saved to: {results.csvPath}
                                    </Typography> */}
                                    <Typography variant="body2" gutterBottom>
                                        Total plots processed: {results.totalPlots}
                                    </Typography>
                                    <Typography variant="body2" gutterBottom>
                                        Total predictions: {results.totalPredictions}
                                    </Typography>
                                    {results.labels && results.labels.length > 0 && (
                                        <Box style={{ marginTop: "10px" }}>
                                            <Typography variant="body2" gutterBottom>
                                                Detected labels:
                                            </Typography>
                                            {results.labels.map((label, index) => (
                                                <Chip
                                                    key={index}
                                                    label={`${label.name} (${label.count})`}
                                                    style={{ margin: "2px" }}
                                                    size="small"
                                                />
                                            ))}
                                        </Box>
                                    )}
                                </Paper>
                            </Grid>
                        )}
                    </Grid>
                </Paper>
            </Grid>
            
            {/* Inference Results Table */}
            <Grid item xs={12}>
                <Paper elevation={3} style={{ padding: "20px", margin: "10px 0" }}>
                    <InferenceTable refreshTrigger={inferenceRefreshTrigger} />
                </Paper>
            </Grid>
        </Grid>
    );
}

export default PredictStep;
