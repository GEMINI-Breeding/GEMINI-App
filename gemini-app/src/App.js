// App.js

import React, { useState, useEffect, useRef } from "react";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
//import HelpIcon from "@mui/icons-material/Help";
import Grid from "@mui/material/Grid";
import Box from "@mui/material/Box";
import Snackbar from "@mui/material/Snackbar";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Tooltip from "@mui/material/Tooltip";
import SettingsIcon from "@mui/icons-material/Settings";
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

import { globalTheme } from './theme'; // Import the global theme
import { useDataSetters, useDataState } from "./DataContext";
import CollapsibleSidebar from "./Components/Menu/CollapsibleSidebar";

import TabbedPrepUI from "./Components/GCP/TabbedPrepUI";
import { ActiveComponentsProvider } from "./ActiveComponentsContext";
import MapView from "./Components/Map/MapView";
//import HelpPane from "./Components/Help/HelpPane";

import { TrainingProgressBar } from "./Components/GCP/TabComponents/Processing/TrainModel";
import { LocateProgressBar } from "./Components/GCP/TabComponents/Processing/LocatePlants";
import { ExtractProgressBar } from "./Components/GCP/TabComponents/Processing/ExtractTraits";
import { OrthoProgressBar } from "./Components/GCP/OrthoModal";
import { DroneExtractProgressBar } from "./Components/GCP/TabComponents/Processing/AskDroneAnalyzeModal";
import FileUploadComponent from "./Components/Menu/FileUpload";
import StatsMenuMain from "./Components/StatsMenu/StatsMenuMain";
import ImageQueryUI from "./Components/ImageQuery/ImageQueryUI";
import DocsFrame from "./Components/DocsFrame";
import { BACKEND_MODE } from "./api/config";
import { connectJobProgress, cancelJob } from "./api/jobs";

function App() {
    //const [helpPaneOpen, setHelpPaneOpen] = useState(false);
    const [submitError, setSubmitError] = useState("");
    const [dataDirMissing, setDataDirMissing] = useState(false);
    const [dataDirPath, setDataDirPath] = useState("");
    const [dataDirCreating, setDataDirCreating] = useState(false);
    const [dataDirBrowsing, setDataDirBrowsing] = useState(false);
    const [dataDirError, setDataDirError] = useState("");
    const [settingsOpen, setSettingsOpen] = useState(false);

    // App state management; see DataContext.js
    const {
        selectedMetric,
        currentView,
        selectedYearGCP,
        selectedExperimentGCP,
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedDateGCP,
        selectedPlatformGCP,
        selectedSensorGCP,
        orthoSetting,
        orthoCustomValue,
        flaskUrl,
        isTraining,
        progress,
        epochs,
        currentEpoch,
        trainingData,
        chartData,
        isLocating,
        currentLocateProgress,
        processRunning,
        isExtracting,
        currentExtractProgress,
        isOrthoProcessing,
        currentOrthoProgress,
        isDroneExtracting,
        currentDroneExtractProgress,
        isGCPReady,
        currentJobId
    } = useDataState();

    const {
        setSelectedTilePath,
        setSelectedTraitsGeoJsonPath,
        setSelectedMetric,
        setCurrentView,
        setSelectedCsv,
        setSelectedImageFolder,
        setRadiusMeters,
        setIsTraining,
        setProgress,
        setCurrentEpoch,
        setTrainingData,
        setChartData,
        setCurrentLocateProgress,
        setIsLocating,
        setProcessRunning,
        setIsExtracting,
        setCurrentExtractProgress,
        setCurrentDroneExtractProgress,
        setCloseMenu,
        setCurrentOrthoProgress,
        setIsOrthoProcessing,
        setIsDroneExtracting,
        setSidebarCollapsed,
        setCurrentJobId
    } = useDataSetters();

    const selectedMetricRef = useRef(selectedMetric);

    useEffect(() => {
        selectedMetricRef.current = selectedMetric;
    }, [selectedMetric]);

    // Check if the data directory exists on startup, retrying until the backend is reachable
    // (Flask mode only — framework mode uses MinIO, not a local data directory)
    useEffect(() => {
        if (BACKEND_MODE !== 'flask') return;
        let cancelled = false;
        const check = () => {
            fetch(`${flaskUrl}check_data_dir`)
                .then(res => res.json())
                .then(data => {
                    if (cancelled) return;
                    if (!data.exists) {
                        setDataDirPath(data.path);
                        setDataDirMissing(true);
                    }
                })
                .catch(() => {
                    if (!cancelled) setTimeout(check, 3000);
                });
        };
        check();
        return () => { cancelled = true; };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleBrowseDataDir = () => {
        setDataDirError("");
        setDataDirBrowsing(true);
        fetch(`${flaskUrl}browse_data_dir`, { method: 'POST' })
            .then(res => res.json())
            .then(data => {
                setDataDirBrowsing(false);
                if (data.selected) {
                    setDataDirPath(data.path);
                } else if (data.error) {
                    setDataDirError(data.error);
                }
            })
            .catch(err => {
                setDataDirBrowsing(false);
                setDataDirError(err.message);
            });
    };

    const handleCreateDataDir = () => {
        setDataDirCreating(true);
        setDataDirError("");
        fetch(`${flaskUrl}create_data_dir`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: dataDirPath })
        })
            .then(res => res.json())
            .then(data => {
                setDataDirCreating(false);
                if (data.success) {
                    setDataDirMissing(false);
                } else {
                    setDataDirError(data.error || "Failed to create directory.");
                }
            })
            .catch(err => {
                setDataDirCreating(false);
                setDataDirError(err.message);
            });
    };

    const handleOpenSettings = () => {
        setDataDirError("");
        fetch(`${flaskUrl}check_data_dir`)
            .then(res => res.json())
            .then(data => {
                setDataDirPath(data.path);
                setSettingsOpen(true);
            })
            .catch(() => setSettingsOpen(true));
    };

    const handleSettingsSave = () => {
        setDataDirCreating(true);
        setDataDirError("");
        fetch(`${flaskUrl}create_data_dir`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: dataDirPath })
        })
            .then(res => res.json())
            .then(data => {
                setDataDirCreating(false);
                if (data.success) {
                    setSettingsOpen(false);
                } else {
                    setDataDirError(data.error || "Failed to update directory.");
                }
            })
            .catch(err => {
                setDataDirCreating(false);
                setDataDirError(err.message);
            });
    };

    const sidebar = (
        <CollapsibleSidebar
            onTilePathChange={setSelectedTilePath}
            onGeoJsonPathChange={setSelectedTraitsGeoJsonPath}
            selectedMetric={selectedMetric}
            setSelectedMetric={setSelectedMetric}
            currentView={currentView}
            setCurrentView={setCurrentView}
            onCsvChange={setSelectedCsv}
            onImageFolderChange={setSelectedImageFolder}
            onRadiusChange={setRadiusMeters}
        />
    );

    const creditsSection = (title, imgLink) => (
        <Box
            sx={{
                textAlign: "center",
                p: 2, // padding
            }}
        >
            <h2 style={{ color: "#142a50" }}>{title}</h2>
            <img src={imgLink} alt={title} style={{ maxWidth: "70%" }} />
        </Box>
    );

    // Sync sidebar collapsed state when view changes
    useEffect(() => {
        switch (currentView) {
            case 1:
            case 5:
            case 6:
            case 7:
                if (!isGCPReady) setSidebarCollapsed(false);
                break;
            case 8:
                setSidebarCollapsed(true);
                break;
            default:
                break;
        }
    }, [currentView, isGCPReady, setSidebarCollapsed]);

    // Choose what to render based on the `currentView` state
    const contentView = (() => {
        switch (currentView) {
            case 0:
                return <MapView />;
            case 1:
                return <TabbedPrepUI />;
            case 2:
                return <StatsMenuMain />;
            case 3:
                return <FileUploadComponent />;
            case 4:
                return <ImageQueryUI />;
            case 5:
                return <TabbedPrepUI selectedTab={0} />;
            case 6:
                return <TabbedPrepUI selectedTab={1} />;
            case 7:
                return <TabbedPrepUI selectedTab={2} />;
            case 8:
                return <DocsFrame />;
            case 9:
                return <FileUploadComponent actionType="upload" />;
            case 10:
                return <FileUploadComponent actionType="manage" />;
            default:
                return <DocsFrame />;
        }
    })();

    // FOR ORTHO START
    useEffect(() => {
        if (!isOrthoProcessing) return;
        if (BACKEND_MODE !== 'flask' && currentJobId) {
            const ws = connectJobProgress(currentJobId, {
                onProgress: (data) => setCurrentOrthoProgress(data.progress || 0),
                onComplete: () => { setIsOrthoProcessing(false); setProcessRunning(false); setCurrentOrthoProgress(100); },
                onError: () => { setIsOrthoProcessing(false); setProcessRunning(false); setSubmitError("Ortho processing failed."); },
            });
            return () => ws.close();
        }
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`${flaskUrl}get_ortho_progress`);
                if (response.ok) {
                    const data = await response.json();
                    setCurrentOrthoProgress(data.ortho);
                }
            } catch (error) {
                console.error("Error fetching ortho progress", error);
                setSubmitError("Error getting ortho progress.");
            }
        }, 5000);
        return () => clearInterval(interval);
    }, [isOrthoProcessing, flaskUrl, currentJobId]);

    const handleStopOrtho = async () => {
        if (BACKEND_MODE !== 'flask' && currentJobId) {
            try {
                await cancelJob(currentJobId);
                setIsOrthoProcessing(false);
                setProcessRunning(false);
                setCurrentOrthoProgress(0);
                setCurrentJobId(null);
            } catch (error) {
                console.error("Error:", error);
            }
            return;
        }
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
        try {
            const response = await fetch(`${flaskUrl}stop_odm`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data)
            });
            if (response.ok) {
                console.log("ODM stopped");
                setIsOrthoProcessing(false);
                setProcessRunning(false);
                setCurrentOrthoProgress(0);
            } else {
                const errorData = await response.json();
                console.error("Error stopping ODM", errorData);
                setSubmitError("Error stopping ODM.");
            }
        } catch (error) {
            console.error("Error:", error);
        }
    };
    // FOR ORTHO END

    // FOR TRAINING START
    const handleStopTraining = async () => {
        if (BACKEND_MODE !== 'flask' && currentJobId) {
            try {
                await cancelJob(currentJobId);
                setIsTraining(false);
                setCurrentEpoch(0);
                setTrainingData(null);
                setChartData({ x: [], y: [] });
                setProcessRunning(false);
                setCurrentJobId(null);
            } catch (error) {
                console.error("Error:", error);
                setSubmitError("Error stopping training.");
            }
            return;
        }
        try {
            await fetch(`${flaskUrl}stop_training`, { method: "POST" });
            console.log("Training stopped");
            setIsTraining(false);
            setCurrentEpoch(0);
            setTrainingData(null);
            setChartData({ x: [], y: [] });
            setProcessRunning(false);
        } catch (error) {
            console.error("Error:", error);
            setSubmitError("Error stopping training.");
        }
    };

    useEffect(() => {
        if (!isTraining) return;
        if (BACKEND_MODE !== 'flask' && currentJobId) {
            const ws = connectJobProgress(currentJobId, {
                onProgress: (data) => {
                    const detail = data.progress_detail || {};
                    setProgress(data.progress || 0);
                    if (detail.epoch !== undefined) setCurrentEpoch(detail.epoch);
                    setTrainingData(detail);
                },
                onComplete: () => { setIsTraining(false); setProcessRunning(false); setProgress(100); },
                onError: (data) => { setIsTraining(false); setProcessRunning(false); setSubmitError(data.error_message || "Training failed."); },
            });
            return () => ws.close();
        }
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`${flaskUrl}get_progress`);
                if (response.ok) {
                    const data = await response.json();
                    const progressPercentage = epochs > 0 ? (data.epoch / epochs) * 100 : 0;
                    setProgress(isNaN(progressPercentage) ? 0 : progressPercentage);
                    setCurrentEpoch(data.epoch);
                    setTrainingData(data);
                } else {
                    setSubmitError("Error getting training progress.");
                }
            } catch (error) {
                console.error("Error fetching training progress", error);
            }
        }, 5000);
        return () => clearInterval(interval);
    }, [isTraining, currentJobId]);
    // FOR TRAINING END

    // FOR LOCATE START
    const handleStopLocating = async () => {
        if (BACKEND_MODE !== 'flask' && currentJobId) {
            try {
                await cancelJob(currentJobId);
                setIsLocating(false);
                setProcessRunning(false);
                setCurrentLocateProgress(0);
                setCurrentJobId(null);
            } catch (error) {
                console.error("Error:", error);
            }
            return;
        }
        try {
            const response = await fetch(`${flaskUrl}stop_locate`, { method: "POST" });
            if (response.ok) {
                console.log("Locating stopped");
                setIsLocating(false);
                setProcessRunning(false);
                setCurrentLocateProgress(0);
            } else {
                const errorData = await response.json();
                console.error("Error stopping locating", errorData);
                setSubmitError("Error stopping locating.");
            }
        } catch (error) {
            console.error("Error:", error);
        }
    };

    useEffect(() => {
        if (!isLocating) return;
        if (BACKEND_MODE !== 'flask' && currentJobId) {
            const ws = connectJobProgress(currentJobId, {
                onProgress: (data) => setCurrentLocateProgress(data.progress || 0),
                onComplete: () => { setIsLocating(false); setProcessRunning(false); setCurrentLocateProgress(100); setCloseMenu(true); },
                onError: () => { setIsLocating(false); setProcessRunning(false); setSubmitError("Locating failed."); },
            });
            return () => ws.close();
        }
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`${flaskUrl}get_locate_progress`);
                if (response.ok) {
                    const data = await response.json();
                    setCurrentLocateProgress(data.locate);
                } else {
                    setSubmitError("Error fetching locate progress.");
                }
            } catch (error) {
                console.error("Error fetching locate progress", error);
            }
        }, 60000);
        return () => clearInterval(interval);
    }, [isLocating, flaskUrl, currentJobId]);
    // FOR LOCATE END

    // FOR EXTRACT START
    const handleStopExtracting = async () => {
        if (BACKEND_MODE !== 'flask' && currentJobId) {
            try {
                await cancelJob(currentJobId);
                setIsExtracting(false);
                setProcessRunning(false);
                setCurrentJobId(null);
            } catch (error) {
                console.error("Error:", error);
            }
            return;
        }
        try {
            const response = await fetch(`${flaskUrl}stop_extract`, { method: "POST" });
            if (response.ok) {
                console.log("Extracting stopped");
                setIsExtracting(false);
                setProcessRunning(false);
            } else {
                const errorData = await response.json();
                console.error("Error stopping extracting", errorData);
                setSubmitError("Error stopping extraction.");
            }
        } catch (error) {
            console.error("Error:", error);
        }
    };
    const handleDoneExtracting = async () => {
        if (BACKEND_MODE !== 'flask') {
            setIsExtracting(false);
            setProcessRunning(false);
            setCurrentExtractProgress(0);
            setCloseMenu(false);
            setCurrentJobId(null);
            return;
        }
        try {
            const response = await fetch(`${flaskUrl}done_extract`, { method: "POST" });
            if (response.ok) {
                console.log("Extracting finished");
                setIsExtracting(false);
                setProcessRunning(false);
                setCurrentExtractProgress(0);
                setCloseMenu(false);
            } else {
                const errorData = await response.json();
                console.error("Error finishing extraction", errorData);
                setSubmitError("Error finishing extraction.");
            }
        } catch (error) {
            console.error("Error:", error);
        }
    };

    useEffect(() => {
        if (!isExtracting) return;
        if (BACKEND_MODE !== 'flask' && currentJobId) {
            const ws = connectJobProgress(currentJobId, {
                onProgress: (data) => setCurrentExtractProgress(data.progress || 0),
                onComplete: () => { setIsExtracting(false); setProcessRunning(false); setCurrentExtractProgress(100); setCloseMenu(true); },
                onError: () => { setIsExtracting(false); setProcessRunning(false); setSubmitError("Extraction failed."); },
            });
            return () => ws.close();
        }
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`${flaskUrl}get_extract_progress`);
                if (response.ok) {
                    const data = await response.json();
                    setCurrentExtractProgress(data.extract);
                } else {
                    setSubmitError("Error fetching extract progress.");
                }
            } catch (error) {
                console.error("Error fetching extract progress", error);
            }
        }, 60000);
        return () => clearInterval(interval);
    }, [isExtracting, flaskUrl, currentJobId]);
    // FOR EXTRACT END

    // FOR DRONE EXTRACT START
    const handleStopDroneExtracting = async () => {
        if (BACKEND_MODE !== 'flask' && currentJobId) {
            try {
                await cancelJob(currentJobId);
                setIsDroneExtracting(false);
                setProcessRunning(false);
                setCurrentDroneExtractProgress(0);
                setCurrentJobId(null);
            } catch (error) {
                console.error("Error:", error);
            }
            return;
        }
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
        try {
            const response = await fetch(`${flaskUrl}stop_drone_extract`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });
            if (response.ok) {
                console.log("Extracting stopped");
                setIsDroneExtracting(false);
                setProcessRunning(false);
                setCurrentDroneExtractProgress(0);
            } else {
                const errorData = await response.json();
                console.error("Error stopping drone extracting", errorData);
                setSubmitError("Error stopping drone extraction.");
            }
        } catch (error) {
            console.error("Error:", error);
        }
    };

    useEffect(() => {
        if (!isDroneExtracting) return;
        if (BACKEND_MODE !== 'flask' && currentJobId) {
            const ws = connectJobProgress(currentJobId, {
                onProgress: (data) => setCurrentDroneExtractProgress(data.progress || 0),
                onComplete: () => { setIsDroneExtracting(false); setProcessRunning(false); setCurrentDroneExtractProgress(100); },
                onError: () => { setIsDroneExtracting(false); setProcessRunning(false); setSubmitError("Drone extraction failed."); },
            });
            return () => ws.close();
        }
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`${flaskUrl}get_drone_extract_progress`);
                if (response.ok) {
                    const data = await response.json();
                    setCurrentDroneExtractProgress(data.drone_extract);
                } else {
                    setSubmitError("Error fetching drone extract progress.");
                }
            } catch (error) {
                console.error("Error fetching drone extract progress", error);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [isDroneExtracting, flaskUrl, currentJobId]);
    // FOR DRONE EXTRACT DONE

    return (
        <ThemeProvider theme={globalTheme}>
            <CssBaseline />
            <ActiveComponentsProvider>
                <div className="App">
                    <div className="sidebar">{sidebar}</div>

                    <div className="content">{contentView}</div>

                    {/* training */}
                    {isTraining && (
                        <Box
                            sx={{
                                position: "fixed",
                                left: 0,
                                right: 0,
                                bottom: 0,
                                pointerEvents: "none", // allows clicks to pass through to the underlying content
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                zIndex: 1200, // ensures the overlay is on top
                            }}
                        >
                            <Box sx={{ pointerEvents: "auto", width: "90%" }}>
                                <TrainingProgressBar
                                    progress={progress}
                                    onStopTraining={handleStopTraining}
                                    trainingData={trainingData}
                                    epochs={epochs}
                                    chartData={chartData}
                                    currentEpoch={currentEpoch}
                                />
                            </Box>
                        </Box>
                    )}

                    {/* locating */}
                    {isLocating && (
                        <Box
                            sx={{
                                position: "fixed",
                                left: 0,
                                right: 0,
                                bottom: 0,
                                pointerEvents: "none", // allows clicks to pass through to the underlying content
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                zIndex: 1200, // ensures the overlay is on top
                            }}
                        >
                            <Box sx={{ pointerEvents: "auto", width: "90%" }}>
                                <LocateProgressBar
                                    currentLocateProgress={currentLocateProgress}
                                    onStopLocating={handleStopLocating}
                                />
                            </Box>
                        </Box>
                    )}

                    {/* extracting */}
                    {isExtracting && (
                        <Box
                            sx={{
                                position: "fixed",
                                left: 0,
                                right: 0,
                                bottom: 0,
                                pointerEvents: "none", // allows clicks to pass through to the underlying content
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                zIndex: 1200, // ensures the overlay is on top
                            }}
                        >
                            <Box sx={{ pointerEvents: "auto", width: "90%" }}>
                                <ExtractProgressBar
                                    currentExtractProgress={currentExtractProgress}
                                    onStopExtracting={handleStopExtracting}
                                    onDoneExtracting={handleDoneExtracting}
                                />
                            </Box>
                        </Box>
                    )}

                    {/* ortho */}
                    {isOrthoProcessing &&
                        <Box
                            sx={{
                                position: "fixed",
                                left: 0,
                                right: 0,
                                bottom: 0,
                                pointerEvents: "none", // allows clicks to pass through to the underlying content
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                zIndex: 1200, // ensures the overlay is on top
                            }}
                        >
                            <Box sx={{ pointerEvents: "auto", width: "90%" }}>
                                <OrthoProgressBar
                                    currentOrthoProgress={currentOrthoProgress}
                                    onStopOrtho={handleStopOrtho}
                                />
                            </Box>
                        </Box>
                    }

                    {/* drone extract */}
                    {isDroneExtracting && (
                        <Box
                            sx={{
                                position: "fixed",
                                left: 0,
                                right: 0,
                                bottom: 0,
                                pointerEvents: "none", // allows clicks to pass through to the underlying content
                                display: "flex",
                                justifyContent: "center",
                                alignItems: "center",
                                zIndex: 1200, // ensures the overlay is on top
                            }}
                        >
                            <Box sx={{ pointerEvents: "auto", width: "90%" }}>
                                <DroneExtractProgressBar
                                    currentDroneExtractProgress={currentDroneExtractProgress}
                                    onDroneStopExtracting={handleStopDroneExtracting}
                                />
                            </Box>
                        </Box>
                    )}

                </div>
                <Snackbar
                    open={submitError !== ""}
                    autoHideDuration={6000}
                    onClose={() => setSubmitError("")}
                    message={submitError}
                />
            </ActiveComponentsProvider>

            <Dialog open={dataDirMissing} disableEscapeKeyDown maxWidth="sm" fullWidth>
                <DialogTitle>Set Up Data Directory</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                        A data directory is required to store uploaded files, processed data, and models.
                        Choose an existing folder or create a new one.
                    </DialogContentText>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Box sx={{
                            fontFamily: 'monospace',
                            fontSize: '0.875rem',
                            p: 1.5,
                            bgcolor: 'grey.100',
                            borderRadius: 1,
                            flex: 1,
                            wordBreak: 'break-all'
                        }}>
                            {dataDirPath || 'No directory selected'}
                        </Box>
                        <Button variant="outlined" onClick={handleBrowseDataDir} disabled={dataDirBrowsing}>
                            {dataDirBrowsing ? "Waiting..." : "Browse"}
                        </Button>
                    </Box>
                    {dataDirError && (
                        <DialogContentText color="error" sx={{ mt: 1 }}>
                            Error: {dataDirError}
                        </DialogContentText>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={handleCreateDataDir}
                        variant="contained"
                        disabled={dataDirCreating || !dataDirPath}
                    >
                        {dataDirCreating ? <CircularProgress size={20} /> : "Use This Directory"}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Settings dialog */}
            <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Settings</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                        Data Directory
                    </DialogContentText>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Box sx={{
                            fontFamily: 'monospace',
                            fontSize: '0.875rem',
                            p: 1.5,
                            bgcolor: 'grey.100',
                            borderRadius: 1,
                            flex: 1,
                            wordBreak: 'break-all'
                        }}>
                            {dataDirPath || 'No directory selected'}
                        </Box>
                        <Button variant="outlined" onClick={handleBrowseDataDir} disabled={dataDirBrowsing}>
                            {dataDirBrowsing ? "Waiting..." : "Browse"}
                        </Button>
                    </Box>
                    {dataDirError && (
                        <DialogContentText color="error" sx={{ mt: 1 }}>
                            Error: {dataDirError}
                        </DialogContentText>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setSettingsOpen(false)}>Cancel</Button>
                    <Button
                        onClick={handleSettingsSave}
                        variant="contained"
                        disabled={dataDirCreating || !dataDirPath}
                    >
                        {dataDirCreating ? <CircularProgress size={20} /> : "Save"}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Floating Settings icon */}
            <Tooltip title="Settings" placement="left">
                <IconButton
                    aria-label="settings"
                    onClick={handleOpenSettings}
                    sx={{
                        position: 'fixed',
                        bottom: 24,
                        left: 24,
                        backgroundColor: 'grey.700',
                        color: 'white',
                        width: 40,
                        height: 40,
                        boxShadow: 3,
                        zIndex: (theme) => theme.zIndex.fab,
                        '&:hover': {
                            backgroundColor: 'grey.600',
                            boxShadow: 6,
                        },
                    }}
                >
                    <SettingsIcon />
                </IconButton>
            </Tooltip>
        </ThemeProvider>
    );
}

export default App;
