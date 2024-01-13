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
import Menu from "@mui/icons-material/Menu";
import TableViewIcon from "@mui/icons-material/TableView";
import MapIcon from "@mui/icons-material/Map";
import InsightsIcon from "@mui/icons-material/Insights";

import { DataProvider, useDataSetters, useDataState } from "../../DataContext";

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
                return (
                    <GCPPickerSelectionMenu
                        onCsvChange={onCsvChange}
                        onImageFolderChange={onImageFolderChange}
                        onRadiusChange={onRadiusChange}
                        selectedMetric={selectedMetric}
                        setSelectedMetric={setSelectedMetric}
                    />
                );

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
                            Table
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
                </Box>

                <Drawer
                    variant="persistent"
                    anchor="left"
                    open={currentView !== null}
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
