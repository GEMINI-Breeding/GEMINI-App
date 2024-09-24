import React from "react";
import {
    AppBar,
    IconButton,
    Drawer,
    Box,
    Divider,
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    Toolbar,
    useTheme,
    ThemeProvider,
    createTheme,
    Typography,
    Button,
} from "@mui/material";
import DataSelectionMenu from "./DataSelectionMenu";
import GCPPickerSelectionMenu from "../GCP/GCPPickerSelectionMenu";
import TableSelectionMenu from "../StatsMenu/TableSelectionMenu";
import Menu from "@mui/icons-material/Menu";
import TableViewIcon from "@mui/icons-material/TableView";
import MapIcon from "@mui/icons-material/Map";
import InsightsIcon from "@mui/icons-material/Insights";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import FilterIcon from "@mui/icons-material/Filter";
import DescriptionIcon from "@mui/icons-material/Description";

import { DataProvider, useDataSetters, useDataState } from "../../DataContext";
import FileUploadComponent from "./FileUpload";

export default function CollapsibleSidebar({
    onTilePathChange,
    onGeoJsonPathChange,
    selectedMetric,
    setSelectedMetric,
    currentView,
    setCurrentView,
    onCsvChange,
    onImageFolderChange,
    onRadiusChange,
}) {
    // ColorMap state management; see DataContext.js
    const { isSidebarCollapsed } = useDataState();

    const { setSidebarCollapsed } = useDataSetters();

    const drawerWidth = 350;
    const smallDrawerWidth = 65;

    const darkTheme = createTheme({
        palette: {
            mode: "dark",
            primary: {
                main: "#282c34",
            },
            secondary: {
                main: "#2caed8", // This is a shade of green but you can adjust this
            },
        },
    });

    const handleDrawerToggle = (index) => {
        if (currentView !== index) {
            setCurrentView(index);
        }
    };

    const handleMenuToggle = () => {
        setSidebarCollapsed(!isSidebarCollapsed);
    };

    const renderMenu = () => {
        switch (currentView) {
            case 0:
                return (
                    <DataSelectionMenu
                        onTilePathChange={onTilePathChange}
                        onGeoJsonPathChange={onGeoJsonPathChange}
                        selectedMetric={selectedMetric}
                        setSelectedMetric={setSelectedMetric}
                    />
                );
            case 1:
                return <GCPPickerSelectionMenu />;
            case 2:
                return <TableSelectionMenu />; // Items shown when the 'Stats' selected and menu is expanded
            case 3:
                // return <FileUploadComponent />;
                return null;
            case 4:
                return <GCPPickerSelectionMenu />;

            // Add more cases as needed for more views
            default:
                return null;
        }
    };

    return (
        <ThemeProvider theme={darkTheme}>
            <Box sx={{ display: "flex", flexDirection: "row" }}>
                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        position: "fixed",
                        height: "100vh",
                        backgroundColor: "#272726",
                        width: `${smallDrawerWidth}px`,
                        zIndex: (theme) => theme.zIndex.drawer + 1,
                    }}
                >
                    <Box
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            paddingTop: 2,
                            paddingLeft: 0,
                            paddingBottom: 2,
                        }}
                    >
                        <IconButton color="white" aria-label="collapse-menu" onClick={() => handleMenuToggle()}>
                            <Menu color="white" fontSize="large" />
                        </IconButton>
                    </Box>

                    <Box
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            mb: 2,
                        }}
                    >
                        <IconButton
                            color="white"
                            aria-label="docs"
                            onClick={() => handleDrawerToggle(5)}
                            sx={{ backgroundColor: currentView === 5 || currentView == null ? "rgba(255, 255, 255, 0.1)" : "transparent" }}
                        >
                            <DescriptionIcon color={currentView === 5 || currentView == null ? "secondary" : "white"} fontSize="medium" />
                        </IconButton>
                        <Typography
                            variant="body"
                            color={currentView === 5 || currentView == null ? "secondary" : "white"}
                            align="center"
                            sx={{ fontSize: "14px" }}
                        >
                            Docs
                        </Typography>
                    </Box>

                    <Box
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            paddingRight: 0,
                            paddingLeft: 0,
                            paddingBottom: 1,
                        }}
                    >
                        <IconButton
                            color="white"
                            aria-label="upload"
                            onClick={() => handleDrawerToggle(3)} // Assuming '3' is the index for the upload section
                            sx={{ backgroundColor: currentView === 3 ? "rgba(255, 255, 255, 0.1)" : "transparent" }}
                        >
                            <CloudUploadIcon color={currentView === 3 ? "secondary" : "white"} fontSize="medium" />
                        </IconButton>
                        <Typography
                            variant="body"
                            color={currentView === 3 ? "secondary" : "white"}
                            align="center"
                            sx={{ fontSize: "14px" }}
                        >
                            Upload
                        </Typography>
                    </Box>

                    <Box
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            paddingTop: 2,
                            paddingLeft: 0,
                            paddingBottom: 1,
                        }}
                    >
                        <IconButton
                            color="white"
                            aria-label="process"
                            onClick={() => handleDrawerToggle(1)}
                            sx={{ backgroundColor: currentView === 1 ? "rgba(255, 255, 255, 0.1)" : "transparent" }}
                        >
                            <InsightsIcon color={currentView === 1 ? "secondary" : "white"} fontSize="medium" />
                        </IconButton>
                        <Typography
                            variant="body"
                            color={currentView === 1 ? "secondary" : "white"}
                            align="center"
                            sx={{ fontSize: "14px" }}
                        >
                            Process
                        </Typography>
                    </Box>

                    <Box
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            paddingRight: 0,
                            paddingLeft: 0,
                            paddingBottom: 1,
                        }}
                    >
                        <IconButton
                            color="white"
                            aria-label="stats"
                            onClick={() => handleDrawerToggle(2)}
                            sx={{ backgroundColor: currentView === 2 ? "rgba(255, 255, 255, 0.1)" : "transparent" }}
                        >
                            <TableViewIcon color={currentView === 2 ? "secondary" : "white"} fontSize="medium" />
                        </IconButton>
                        <Typography
                            variant="body"
                            color={currentView === 2 ? "secondary" : "white"}
                            align="center"
                            sx={{ fontSize: "14px" }}
                        >
                            Stats
                        </Typography>
                    </Box>

                    <Box
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            mb: 0.75,
                            paddingRight: 0,
                            paddingLeft: 0,
                            paddingBottom: 1,
                        }}
                    >
                        <IconButton
                            color="white"
                            aria-label="map"
                            onClick={() => handleDrawerToggle(0)}
                            sx={{ backgroundColor: currentView === 0 ? "rgba(255, 255, 255, 0.1)" : "transparent" }}
                        >
                            <MapIcon color={currentView === 0 ? "secondary" : "white"} fontSize="medium" />
                        </IconButton>
                        <Typography
                            variant="body"
                            color={currentView === 0 ? "secondary" : "white"}
                            align="center"
                            sx={{ fontSize: "14px" }}
                        >
                            Map
                        </Typography>
                    </Box>
                    <Box
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            mb: 0.75,
                            paddingRight: 0,
                            paddingLeft: 0,
                            paddingBottom: 1,
                        }}
                    >
                        <IconButton
                            color="white"
                            aria-label="query"
                            onClick={() => handleDrawerToggle(4)}
                            sx={{ backgroundColor: currentView === 4 ? "rgba(255, 255, 255, 0.1)" : "transparent" }}
                        >
                            <FilterIcon color={currentView === 4 ? "secondary" : "white"} fontSize="medium" />
                        </IconButton>
                        <Typography
                            variant="body"
                            color={currentView === 4 ? "secondary" : "white"}
                            align="center"
                            sx={{ fontSize: "14px" }}
                        >
                            Query
                        </Typography>
                    </Box>
                </Box>

                <Drawer
                    variant="persistent"
                    anchor="left"
                    open={currentView !== null && currentView !== 3}
                    sx={{
                        width: !isSidebarCollapsed ? `${drawerWidth}px` : 0,
                        flexShrink: 0,
                        marginLeft: `${smallDrawerWidth}px`,
                        "& .MuiDrawer-paper": {
                            marginLeft: `${smallDrawerWidth}px`,
                            width: !isSidebarCollapsed ? `${drawerWidth}px` : 0,
                            transition: (theme) =>
                                theme.transitions.create("width", {
                                    easing: theme.transitions.easing.sharp,
                                    duration:
                                        currentView !== null
                                            ? theme.transitions.duration.enteringScreen
                                            : theme.transitions.duration.leavingScreen,
                                }),
                            boxSizing: "border-box",
                            backgroundColor: "#4a4848",
                        },
                    }}
                >
                    <Divider />
                    <List>
                        <ListItem key="data-selection-menu">
                            <ListItemText sx={{ px: 2, py: 1 }}>{renderMenu()}</ListItemText>
                        </ListItem>
                    </List>
                </Drawer>
            </Box>
        </ThemeProvider>
    );
}
