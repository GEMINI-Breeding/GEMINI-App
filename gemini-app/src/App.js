// App.js

import React, { useState, useEffect, useRef } from "react";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import HelpIcon from "@mui/icons-material/Help";

import { useDataSetters, useDataState } from "./DataContext";
import CollapsibleSidebar from "./Components/Menu/CollapsibleSidebar";

import TabbedPrepUI from "./Components/GCP/TabbedPrepUI";
import { ActiveComponentsProvider } from "./ActiveComponentsContext";
import MapView from "./Components/Map/MapView";
import HelpPane from "./Components/Help/HelpPane";

// For training
import { TrainingProgressBar } from './Components/GCP/TabComponents/RoverPrep/TrainModel'; 
import { Box }  from '@mui/material';

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
      currentEpoch
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
      setCurrentEpoch
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
            default:
                return null;
        }
    })();

    // For training
    const handleStopTraining = async () => {
        try {
            const response = await fetch(`${flaskUrl}stop_training`, { method: 'POST' });
            if (response.ok) {
                // Handle successful stop
                console.log("Training stopped");
                setIsTraining(false);  // Update isTraining to false
            } else {
                // Handle error response
                const errorData = await response.json();
                console.error("Error stopping training", errorData);
            }
        } catch (error) {
            console.error("Error:", error);
        }
    };
    
    useEffect(() => {
    let interval;
      if (isTraining) {
          interval = setInterval(async () => {
              try {
                  const response = await fetch(`${flaskUrl}get_training_progress`);
                  if (response.ok) {
                      const data = await response.json();
                      // console.log('Epoch: ', data.epoch, 'Epochs: ', epochs); // Logging for debugging
                      const progressPercentage = epochs > 0 ? (data.epoch / epochs) * 100 : 0;
                      setProgress(isNaN(progressPercentage) ? 0 : progressPercentage);
                      setCurrentEpoch(data.epoch); // Update current epoch
                  } else {
                      console.error("Failed to fetch training progress");
                  }
              } catch (error) {
                  console.error("Error fetching training progress", error);
              }
          }, 5000); // Poll every 5 seconds
      }
      return () => clearInterval(interval);
    }, [isTraining, flaskUrl, epochs]);

    useEffect(() => {
        if (currentEpoch >= epochs) {
            setIsTraining(false);
            // setShowResults(true);
        }
    }, [currentEpoch, epochs]);
    // For training end

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
                    <Box sx={{
                        position: 'fixed',
                        left: 0,
                        right: 0,
                        bottom: 0,
                        pointerEvents: 'none', // allows clicks to pass through to the underlying content
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        zIndex: 1200 // ensures the overlay is on top
                    }}>
                        <Box sx={{ pointerEvents: 'auto', width: '90%' }}>
                            <TrainingProgressBar progress={progress} onStopTraining={handleStopTraining} />
                        </Box>
                    </Box>
                )}
            </div>
        </ActiveComponentsProvider>
    );
}

export default App;
