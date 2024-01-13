// App.js

import React, { useState } from "react";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import HelpIcon from "@mui/icons-material/Help";

import { useDataSetters, useDataState } from "./DataContext";
import CollapsibleSidebar from "./Components/Menu/CollapsibleSidebar";

import TabbedPrepUI from "./Components/GCP/TabbedPrepUI";

import { ActiveComponentsProvider } from "./ActiveComponentsContext";
import MapView from "./Components/Map/MapView";
import HelpPane from "./Components/Help/HelpPane";

function App() {
    const [helpPaneOpen, setHelpPaneOpen] = useState(false);

    const toggleHelpPane = () => {
        setHelpPaneOpen(!helpPaneOpen);
    };

    // App state management; see DataContext.js
    const { selectedMetric, currentView } = useDataState();

    const {
        setSelectedTilePath,
        setSelectedTraitsGeoJsonPath,
        setSelectedMetric,
        setCurrentView,
        setSelectedCsv,
        setSelectedImageFolder,
        setRadiusMeters,
    } = useDataSetters();

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
            </div>
        </ActiveComponentsProvider>
    );
}

export default App;
