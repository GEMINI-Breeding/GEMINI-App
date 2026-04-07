// App.js

import React, { useState, useEffect, useRef } from "react";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
//import HelpIcon from "@mui/icons-material/Help";
import Grid from "@mui/material/Grid";
import Box from "@mui/material/Box";

import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
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
import { connectJobProgress, cancelJob } from "./api/jobs";
import { checkDataDir, browseDataDir, createDataDir } from "./api/files";

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

    // Data directory check not needed — framework mode uses MinIO, not a local data directory

    const handleBrowseDataDir = () => {
        setDataDirError("");
        setDataDirBrowsing(true);
        browseDataDir()
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
        createDataDir(dataDirPath)
            .then(data => {
                setDataDirCreating(false);
                if (data.success || data.status === 'ok') {
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
        checkDataDir()
            .then(data => {
                setDataDirPath(data.path || '');
                setSettingsOpen(true);
            })
            .catch(() => setSettingsOpen(true));
    };

    const handleSettingsSave = () => {
        setDataDirCreating(true);
        setDataDirError("");
        createDataDir(dataDirPath)
            .then(data => {
                setDataDirCreating(false);
                if (data.success || data.status === 'ok') {
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
        if (currentJobId) {
            const ws = connectJobProgress(currentJobId, {
                onProgress: (data) => setCurrentOrthoProgress(data.progress || 0),
                onComplete: () => { setCurrentOrthoProgress(100); },
                onError: (data) => {
                    setIsOrthoProcessing(false);
                    setProcessRunning(false);
                    const msg = (data && data.error_message) || "Ortho processing failed.";
                    setSubmitError(`Orthophoto generation failed: ${msg}`);
                },
            });
            return () => ws.close();
        }
    }, [isOrthoProcessing, currentJobId]);

    const handleStopOrtho = async () => {
        if (currentJobId) {
            try {
                await cancelJob(currentJobId);
                setIsOrthoProcessing(false);
                setProcessRunning(false);
                setCurrentOrthoProgress(0);
                setCurrentJobId(null);
            } catch (error) {
                console.error("Error:", error);
            }
        }
    };
    // FOR ORTHO END

    // FOR TRAINING START
    const handleStopTraining = async () => {
        if (currentJobId) {
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
        }
    };

    useEffect(() => {
        if (!isTraining) return;
        if (currentJobId) {
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
    }, [isTraining, currentJobId]);
    // FOR TRAINING END

    // FOR LOCATE START
    const handleStopLocating = async () => {
        if (currentJobId) {
            try {
                await cancelJob(currentJobId);
                setIsLocating(false);
                setProcessRunning(false);
                setCurrentLocateProgress(0);
                setCurrentJobId(null);
            } catch (error) {
                console.error("Error:", error);
            }
        }
    };

    useEffect(() => {
        if (!isLocating) return;
        if (currentJobId) {
            const ws = connectJobProgress(currentJobId, {
                onProgress: (data) => setCurrentLocateProgress(data.progress || 0),
                onComplete: () => { setIsLocating(false); setProcessRunning(false); setCurrentLocateProgress(100); setCloseMenu(true); },
                onError: () => { setIsLocating(false); setProcessRunning(false); setSubmitError("Locating failed."); },
            });
            return () => ws.close();
        }
    }, [isLocating, currentJobId]);
    // FOR LOCATE END

    // FOR EXTRACT START
    const handleStopExtracting = async () => {
        if (currentJobId) {
            try {
                await cancelJob(currentJobId);
                setIsExtracting(false);
                setProcessRunning(false);
                setCurrentJobId(null);
            } catch (error) {
                console.error("Error:", error);
            }
        }
    };
    const handleDoneExtracting = async () => {
        setIsExtracting(false);
        setProcessRunning(false);
        setCurrentExtractProgress(0);
        setCloseMenu(false);
        setCurrentJobId(null);
    };

    useEffect(() => {
        if (!isExtracting) return;
        if (currentJobId) {
            const ws = connectJobProgress(currentJobId, {
                onProgress: (data) => setCurrentExtractProgress(data.progress || 0),
                onComplete: () => { setIsExtracting(false); setProcessRunning(false); setCurrentExtractProgress(100); setCloseMenu(true); },
                onError: () => { setIsExtracting(false); setProcessRunning(false); setSubmitError("Extraction failed."); },
            });
            return () => ws.close();
        }
    }, [isExtracting, currentJobId]);
    // FOR EXTRACT END

    // FOR DRONE EXTRACT START
    const handleStopDroneExtracting = async () => {
        if (currentJobId) {
            try {
                await cancelJob(currentJobId);
                setIsDroneExtracting(false);
                setProcessRunning(false);
                setCurrentDroneExtractProgress(0);
                setCurrentJobId(null);
            } catch (error) {
                console.error("Error:", error);
            }
        }
    };

    useEffect(() => {
        if (!isDroneExtracting) return;
        if (currentJobId) {
            const ws = connectJobProgress(currentJobId, {
                onProgress: (data) => setCurrentDroneExtractProgress(data.progress || 0),
                onComplete: () => { setIsDroneExtracting(false); setProcessRunning(false); setCurrentDroneExtractProgress(100); },
                onError: () => { setIsDroneExtracting(false); setProcessRunning(false); setSubmitError("Drone extraction failed."); },
            });
            return () => ws.close();
        }
    }, [isDroneExtracting, currentJobId]);
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
                <Dialog open={submitError !== ""} onClose={() => setSubmitError("")}>
                    <DialogTitle>Processing Error</DialogTitle>
                    <DialogContent>
                        <Typography>{submitError}</Typography>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setSubmitError("")} autoFocus>OK</Button>
                    </DialogActions>
                </Dialog>
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
