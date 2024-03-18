// App.js

import React, { useState, useEffect, useRef } from "react";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import HelpIcon from "@mui/icons-material/Help";
import Grid from "@mui/material/Grid";
import Box from "@mui/material/Box";

import { useDataSetters, useDataState } from "./DataContext";
import CollapsibleSidebar from "./Components/Menu/CollapsibleSidebar";

import TabbedPrepUI from "./Components/GCP/TabbedPrepUI";
import { ActiveComponentsProvider } from "./ActiveComponentsContext";
import MapView from "./Components/Map/MapView";
import HelpPane from "./Components/Help/HelpPane";

import { TrainingProgressBar } from "./Components/GCP/TabComponents/Processing/TrainModel";
import { LocateProgressBar } from "./Components/GCP/TabComponents/Processing/LocatePlants";
import { ExtractProgressBar } from "./Components/GCP/TabComponents/Processing/ExtractTraits";
import { OrthoProgressBar } from "./Components/GCP/OrthoModal";
import FileUploadComponent from "./Components/Menu/FileUpload";
import ImageQueryUI from "./Components/ImageQuery/ImageQueryUI";

function App() {
    const [helpPaneOpen, setHelpPaneOpen] = useState(false);

    const toggleHelpPane = () => {
        setHelpPaneOpen(!helpPaneOpen);
    };

    // App state management; see DataContext.js
    const {
        selectedMetric,
        currentView,
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
        currentOrthoProgress
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
        setCloseMenu,
        setCurrentOrthoProgress,
        setIsOrthoProcessing
    } = useDataSetters();

    const selectedMetricRef = useRef(selectedMetric);

    useEffect(() => {
        selectedMetricRef.current = selectedMetric;
    }, [selectedMetric]);

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

    // Choose what to render based on the `currentView` state
    const contentView = (() => {
        switch (currentView) {
            case 0:
                return <MapView />;
            case 1:
                return <TabbedPrepUI />;
            case 2:
                return (
                    <div
                        style={{
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            transform: "translate(-50%, -50%)",
                            color: "black",
                            backgroundColor: "white",
                            padding: "20px",
                            zIndex: "1000",
                            fontSize: "24px",
                        }}
                    >
                        Placeholder for Stats View
                    </div>
                );
            case 3:
                return <FileUploadComponent />;
            case 4:
                return <ImageQueryUI />;
            default:
                return (
                    <Grid
                        container
                        spacing={2}
                        direction="column"
                        justifyContent="center"
                        alignItems="center"
                        style={{
                            minHeight: "100vh",
                            position: "relative",
                        }}
                    >
                        <Box
                            sx={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                width: "100%",
                                height: "100%",
                                backgroundColor: "rgba(255, 255, 255, 0.75)",
                                zIndex: 1, // Ensures overlay is above the background but below content
                            }}
                        ></Box>

                        {/* Ensure content is above the overlay */}
                        <Box
                            sx={{
                                position: "relative",
                                zIndex: 2,
                                width: "100%",
                            }}
                        >
                            <Grid item xs={12}>
                                <Box
                                    sx={{
                                        textAlign: "center",
                                        p: 2,
                                    }}
                                >
                                    <img src="/gemini-logo.png" alt="GEMINI Logo" style={{ maxWidth: "80%" }} />
                                    <p
                                        style={{
                                            fontFamily: "Arial",
                                            fontSize: "28px",
                                            fontWeight: "regular",
                                            color: "#142a50",
                                        }}
                                    >
                                        G×E×M Innovation in Intelligence for climate adaptation
                                    </p>
                                </Box>
                            </Grid>
                            <Grid container direction="row" justifyContent="center" alignItems="center">
                                <Grid item xs={6}>
                                    {creditsSection("Financial Support", "/financial-support.png")}
                                </Grid>
                                <Grid item xs={6}>
                                    {creditsSection("Partners", "/our-partners.png")}
                                </Grid>
                            </Grid>
                        </Box>

                        <Box
                            sx={{
                                position: "absolute",
                                top: 0,
                                left: 0,
                                width: "100%",
                                height: "100%",
                                backgroundImage: "url('/sorghum-background.jpg')",
                                backgroundPosition: "center",
                                backgroundSize: "cover",
                                backgroundRepeat: "no-repeat",
                                zIndex: 0,
                            }}
                        ></Box>
                    </Grid>
                );
        }
    })();

    // FOR ORTHO START
    useEffect(() => {
        let interval;
        if (isOrthoProcessing) {
            interval = setInterval(async () => {
                try {
                    const response = await fetch(`${flaskUrl}get_ortho_progress`);
                    if (response.ok) {
                        const data = await response.json();
                        console.log(data)
                        setCurrentOrthoProgress(data.ortho)
                    } else {
                        console.error("Failed to fetch ortho progress");
                    }
                } catch (error) {
                    console.error("Error fetching ortho progress", error);
                }
            }, 60000); // Poll every min
        }
        return () => clearInterval(interval);
    }, [isOrthoProcessing, flaskUrl]);

    const handleStopOrtho = async () => {
        try {
            const response = await fetch(`${flaskUrl}stop_odm`, { method: "POST" });
            if (response.ok) {
                // Handle successful stop
                console.log("ODM stopped");
                setIsOrthoProcessing(false);
                setProcessRunning(false);
                setCurrentOrthoProgress(0);
            } else {
                // Handle error response
                const errorData = await response.json();
                console.error("Error stopping ODM", errorData);
            }
        } catch (error) {
            console.error("Error:", error);
        }
    };
    // FOR ORTHO END

    // FOR TRAINING START
    const handleStopTraining = async () => {
        try {
            const response = await fetch(`${flaskUrl}stop_training`, { method: "POST" });
            // Handle successful stop
            console.log("Training stopped");
            setIsTraining(false); // Update isTraining to false
            setCurrentEpoch(0); // Reset epochs
            setTrainingData(null);
            setChartData({ x: [], y: [] }); // Reset chart data
            setProcessRunning(false);
        } catch (error) {
            console.error("Error:", error);
        }
    };
    
    useEffect(() => {
        console.log({
            isTraining: isTraining,
            currentEpoch: currentEpoch,
            trainingData: trainingData,
            chartData: chartData,
            processRunning: processRunning
        });
    }, [isTraining, currentEpoch, trainingData, chartData, processRunning]);
    

    useEffect(() => {
        let interval;
        if (isTraining) {
            interval = setInterval(async () => {
                try {
                    const response = await fetch(`${flaskUrl}get_progress`);
                    if (response.ok) {
                        const data = await response.json();
                        const progressPercentage = epochs > 0 ? (data.epoch / epochs) * 100 : 0;
                        setProgress(isNaN(progressPercentage) ? 0 : progressPercentage);
                        setCurrentEpoch(data.epoch); // Update current epoch
                        setTrainingData(data);
                    } else {
                        console.error("Failed to fetch training progress");
                    }
                } catch (error) {
                    console.error("Error fetching training progress", error);
                }
            }, 5000); // Poll every 5 seconds
        }
        return () => clearInterval(interval);
    }, [isTraining]);
    // FOR TRAINING END

    // FOR LOCATE START
    const handleStopLocating = async () => {
        try {
            const response = await fetch(`${flaskUrl}stop_locate`, { method: "POST" });
            if (response.ok) {
                // Handle successful stop
                console.log("Locating stopped");
                setIsLocating(false);
                setProcessRunning(false);
                setCurrentLocateProgress(0)
            } else {
                // Handle error response
                const errorData = await response.json();
                console.error("Error stopping locating", errorData);
            }
        } catch (error) {
            console.error("Error:", error);
        }
    };

    useEffect(() => {
        let interval;
        if (isLocating) {
            interval = setInterval(async () => {
                try {
                    const response = await fetch(`${flaskUrl}get_locate_progress`);
                    if (response.ok) {
                        const data = await response.json();
                        console.log(data)
                        setCurrentLocateProgress(data.locate)
                    } else {
                        console.error("Failed to fetch locate progress");
                    }
                } catch (error) {
                    console.error("Error fetching locate progress", error);
                }
            }, 60000); // Poll every min
        }
        return () => clearInterval(interval);
    }, [isLocating, flaskUrl]);
    // FOR LOCATE END

    // FOR EXTRACT START
    const handleStopExtracting = async () => {
        try {
            const response = await fetch(`${flaskUrl}stop_extract`, { method: "POST" });
            if (response.ok) {
                // Handle successful stop
                console.log("Extracting stopped");
                setIsExtracting(false);
                setProcessRunning(false);
                setCurrentExtractProgress(0);
            } else {
                // Handle error response
                const errorData = await response.json();
                console.error("Error stopping extracting", errorData);
            }
        } catch (error) {
            console.error("Error:", error);
        }
    };
    const handleDoneExtracting = async () => {
        try {
            const response = await fetch(`${flaskUrl}done_extract`, { method: "POST" });
            if (response.ok) {
                // Handle successful stop
                console.log("Extracting finished");
                setIsExtracting(false);
                setProcessRunning(false);
                setCurrentExtractProgress(0);
                setCloseMenu(false);
            } else {
                // Handle error response
                const errorData = await response.json();
                console.error("Error finishing extraction", errorData);
            }
        } catch (error) {
            console.error("Error:", error);
        }
    };

    useEffect(() => {
        let interval;
        if (isExtracting) {
            interval = setInterval(async () => {
                try {
                    const response = await fetch(`${flaskUrl}get_extract_progress`);
                    if (response.ok) {
                        const data = await response.json();
                        console.log(data)
                        setCurrentExtractProgress(data.extract)
                    } else {
                        console.error("Failed to fetch locate progress");
                    }
                } catch (error) {
                    console.error("Error fetching locate progress", error);
                }
            }, 60000); // Poll every min
        }
        return () => clearInterval(interval);
    }, [isExtracting, flaskUrl]);
    // FOR EXTRACT END

    return (
        <ActiveComponentsProvider>
            <div className="App">
                <div className="sidebar">{sidebar}</div>

                <div className="content">{contentView}</div>

                <div
                    className="help-button"
                    style={{ position: "fixed", bottom: "10px", right: helpPaneOpen ? "300px" : "10px", zIndex: 1000 }}
                >
                    <IconButton onClick={toggleHelpPane}>
                        <HelpIcon fontSize="large" />
                    </IconButton>
                </div>

                <Drawer
                    anchor="right"
                    variant="persistent"
                    open={helpPaneOpen}
                    sx={{ "& .MuiDrawer-paper": { height: "100vh", overflow: "auto" } }}
                >
                    <HelpPane />
                </Drawer>

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
            </div>
        </ActiveComponentsProvider>
    );
}

export default App;
