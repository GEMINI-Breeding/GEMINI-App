import React, { useEffect, useState } from "react";
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
    Tooltip,
} from "@mui/material";
import DataSelectionMenu from "./DataSelectionMenu";
import GCPPickerSelectionMenu from "../GCP/GCPPickerSelectionMenu";
import TableSelectionMenu from "../StatsMenu/TableSelectionMenu";
import Menu from "@mui/icons-material/Menu";
import TableViewIcon from "@mui/icons-material/TableView";
import MapIcon from "@mui/icons-material/Map";
import InsightsIcon from "@mui/icons-material/Insights";
import FilterIcon from "@mui/icons-material/Filter";
import FindInPageIcon from '@mui/icons-material/FindInPage';
import DescriptionIcon from "@mui/icons-material/Description";
import HelpIcon from '@mui/icons-material/Help';
import BugReportIcon from '@mui/icons-material/BugReport';
import FolderIcon from '@mui/icons-material/Folder';
import gitHubIcon from '../../github.png';
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import DynamicFeedIcon from '@mui/icons-material/DynamicFeed';
import EditRoadIcon from '@mui/icons-material/EditRoad';
import QueryStatsIcon from '@mui/icons-material/QueryStats';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import BuildIcon from '@mui/icons-material/Build';

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

    // New state for controlling tab selection sidebar visibility
    const [isTabSidebarCollapsed, setIsTabSidebarCollapsed] = useState(false);
    
    // New state for controlling View Data section visibility
    const [isViewDataExpanded, setIsViewDataExpanded] = useState(false);
    
    // New state for controlling Process section visibility
    const [isProcessExpanded, setIsProcessExpanded] = useState(false);
    
    // New state for controlling Prepare section visibility
    const [isPrepareExpanded, setIsPrepareExpanded] = useState(false);
    
    // New state for controlling expanded sidebar width
    const [isSubtabsExpanded, setIsSubtabsExpanded] = useState(false);

    const drawerWidth = 350;
    const smallDrawerWidth = 65;
    const expandedSidebarWidth = 200; // Width when showing subtabs

    const darkTheme = createTheme({
        palette: {
            mode: "dark",
            primary: {
                main: "#142a50",
            },
            secondary: {
                main: "#b3d99a",
            },
        },
    });

    const handleDrawerToggle = (index) => {
        setCurrentView(index);
        // Auto-expand View Data section when navigating to Stats, Map, or Query
        if (index === 0 || index === 2 || index === 4) {
            setIsViewDataExpanded(true);
            setIsSubtabsExpanded(false); // Close expanded view when subtab selected
        }
        // Auto-expand Process section when navigating to Process subtabs
        if (index === 1 || index === 5 || index === 6 || index === 7) {
            setIsProcessExpanded(true);
            setIsSubtabsExpanded(false); // Close expanded view when subtab selected
        }
        // Auto-expand Prepare section when navigating to Prepare subtabs
        if (index === 3 || index === 9 || index === 10) {
            setIsPrepareExpanded(true);
            setIsSubtabsExpanded(false); // Close expanded view when subtab selected
        }
    };

    const handleMenuToggle = () => {
        // Only toggle the selection sidebar for tabs that have menus
        if (currentView !== null && currentView !== 3 && currentView !== 8 && currentView !== 9 && currentView !== 10) {
            setSidebarCollapsed(!isSidebarCollapsed);
        }
    };

    const handleTabSidebarToggle = () => {
        setIsTabSidebarCollapsed(!isTabSidebarCollapsed);
        if(!isTabSidebarCollapsed && !isSidebarCollapsed) {
            setSidebarCollapsed(true);
        }
    };

    const handleViewDataToggle = () => {
        const wasExpanded = isViewDataExpanded;
        setIsViewDataExpanded(!isViewDataExpanded);
        
        // If expanding the section, show the expanded sidebar
        if (!wasExpanded) {
            setIsSubtabsExpanded(true);
            setIsProcessExpanded(false); // Close other sections
            setIsPrepareExpanded(false);
        } else {
            setIsSubtabsExpanded(false);
        }
    };

    const handleProcessToggle = () => {
        const wasExpanded = isProcessExpanded;
        setIsProcessExpanded(!isProcessExpanded);
        
        // If expanding the section, show the expanded sidebar
        if (!wasExpanded) {
            setIsSubtabsExpanded(true);
            setIsViewDataExpanded(false); // Close other sections
            setIsPrepareExpanded(false);
        } else {
            setIsSubtabsExpanded(false);
        }
    };

    const handlePrepareToggle = () => {
        const wasExpanded = isPrepareExpanded;
        setIsPrepareExpanded(!isPrepareExpanded);
        
        // If expanding the section, show the expanded sidebar
        if (!wasExpanded) {
            setIsSubtabsExpanded(true);
            setIsViewDataExpanded(false); // Close other sections
            setIsProcessExpanded(false);
        } else {
            setIsSubtabsExpanded(false);
        }
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
                return <TableSelectionMenu />;
            case 3:
                return null; // Prepare main tab
            case 4:
                return <GCPPickerSelectionMenu />;
            case 5:
                return <GCPPickerSelectionMenu />; // Mosaic Generation
            case 6:
                return <GCPPickerSelectionMenu />; // Plot Association
            case 7:
                return <GCPPickerSelectionMenu />; // Processing
            case 8:
                return null; // Docs tab
            case 9:
                return null; // Upload Files
            case 10:
                return null; // Manage Files
            default:
                return null;
        }
    };

    // Determine if the selection drawer should be open
    const shouldDrawerBeOpen = () => {
        // Never open for prepare (3), docs (8), upload files (9), or manage files (10) tabs
        if (currentView === 3 || currentView === 8 || currentView === 9 || currentView === 10 || currentView === null) {
            return false;
        }
        // For other tabs, respect the isSidebarCollapsed state
        return !isSidebarCollapsed;
    };
    
    const handleOpenWebsite = () => {
        window.open('https://projectgemini.ucdavis.edu/', '_blank');
    };
    
    const handleReportBug = () => {
        window.open('https://github.com/GEMINI-Breeding/GEMINI-App/issues/new', '_blank');
    };
    
    return (
        <ThemeProvider theme={darkTheme}>
            <Box sx={{ display: "flex", flexDirection: "row" }}>
                {/* Backdrop blur overlay when sidebar is expanded or drawer is open */}
                {(isSubtabsExpanded || shouldDrawerBeOpen()) && (
                    <Box
                        sx={{
                            position: "fixed",
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: "rgba(0, 0, 0, 0.1)",
                            backdropFilter: "blur(7px)",
                            zIndex: (theme) => theme.zIndex.drawer - 1,
                            pointerEvents: "none", // Allow clicks to pass through
                        }}
                    />
                )}

                {/* Main tab selection sidebar - shows/hides based on isTabSidebarCollapsed */}
                <Box
                    sx={{
                        display: !isTabSidebarCollapsed ? "flex" : "none",
                        flexDirection: "column",
                        alignItems: isSubtabsExpanded ? "flex-start" : "center",
                        position: "fixed",
                        height: "100vh",
                        backgroundColor: "#546d78",
                        opacity: 1,
                        width: isSubtabsExpanded ? `${expandedSidebarWidth}px` : `${smallDrawerWidth}px`,
                        zIndex: (theme) => theme.zIndex.drawer + 1,
                        transition: "width 0.3s ease",
                        paddingLeft: isSubtabsExpanded ? 1 : 0,
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
                        <IconButton 
                            color="white" 
                            aria-label="collapse-menu" 
                            onClick={() => handleMenuToggle()}
                            disabled={currentView === 3 || currentView === 8 || currentView === 9 || currentView === 10 || currentView === null}
                            sx={{ 
                                opacity: (currentView === 3 || currentView === 8 || currentView === 9 || currentView === 10 || currentView === null) ? 0.5 : 1 
                            }}
                        >
                            <Menu color="white" fontSize="large" />
                        </IconButton>
                    </Box>

                    {/* GEMINI Logo */}
                    <Box
                        sx={{
                            display: "flex",
                            flexDirection: isSubtabsExpanded ? "row" : "column",
                            alignItems: "center",
                            paddingBottom: 2,
                            width: "100%",
                            justifyContent: "center",
                        }}
                    >
                        <Tooltip title="Visit GEMINI Project Website" placement={isSubtabsExpanded ? "right" : "bottom"}>
                            <Button
                                color="primary"
                                aria-label="project-gemini-website"
                                onClick={handleOpenWebsite}
                                sx={{
                                    backgroundColor: 'transparent',
                                    padding: 0,
                                    minWidth: 'auto',
                                    borderRadius: 2,
                                    transition: 'all 0.3s ease',
                                    '&:hover': {
                                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                        transform: 'scale(1.05)',
                                    },
                                }}
                            >
                                {isSubtabsExpanded ? (
                                    <img 
                                        src="/gemini-logo.png" 
                                        alt="GEMINI Project Logo" 
                                        style={{ 
                                            height: '30px',
                                            width: 'auto',
                                            borderRadius: '6px'
                                        }} 
                                    />
                                ) : (
                                    <img 
                                        src="/logo512.png" 
                                        alt="GEMINI Project Logo" 
                                        style={{ 
                                            width: '40px',
                                            height: '40px',
                                            borderRadius: '6px'
                                        }} 
                                    />
                                )}
                            </Button>
                        </Tooltip>
                    </Box>

                    <Box
                        sx={{
                            display: "flex",
                            flexDirection: isSubtabsExpanded ? "row" : "column",
                            alignItems: isSubtabsExpanded ? "center" : "center",
                            paddingRight: 0,
                            paddingLeft: 0,
                            paddingBottom: 1,
                            width: "100%",
                        }}
                    >
                        <IconButton
                            color="white"
                            aria-label="prepare"
                            onClick={handlePrepareToggle}
                            sx={{ 
                                backgroundColor: (currentView === 3 || currentView === 9 || currentView === 10) ? "rgba(255, 255, 255, 0.1)" : "transparent",
                                marginRight: isSubtabsExpanded ? 1 : 0,
                            }}
                        >
                            <FolderIcon color={(currentView === 3 || currentView === 9 || currentView === 10) ? "secondary" : "white"} fontSize="medium" />
                        </IconButton>
                        <Typography
                            variant="body"
                            color={(currentView === 3 || currentView === 9 || currentView === 10) ? "secondary" : "white"}
                            align={isSubtabsExpanded ? "left" : "center"}
                            sx={{ 
                                fontSize: "14px",
                                alignSelf: isSubtabsExpanded ? "center" : "auto",
                            }}
                        >
                            Prepare
                        </Typography>
                    </Box>

                    {/* Expandable Prepare Section */}
                    {isPrepareExpanded && (
                        <>
                            <Box
                                sx={{
                                    display: "flex",
                                    flexDirection: isSubtabsExpanded ? "row" : "column",
                                    alignItems: "center",
                                    paddingRight: 0,
                                    paddingLeft: isSubtabsExpanded ? 2 : 0,
                                    paddingBottom: 1,
                                    width: "100%",
                                    justifyContent: isSubtabsExpanded ? "flex-start" : "center",
                                }}
                            >
                                <IconButton
                                    color="white"
                                    aria-label="upload-files"
                                    onClick={() => handleDrawerToggle(9)}
                                    sx={{ 
                                        backgroundColor: currentView === 9 ? "rgba(255, 255, 255, 0.1)" : "transparent",
                                        width: 40,
                                        height: 40,
                                        marginRight: isSubtabsExpanded ? 1 : 0,
                                    }}
                                >
                                    <FileUploadIcon color={currentView === 9 ? "primary" : "white"} fontSize="small" />
                                </IconButton>
                                <Typography
                                    variant="body"
                                    color={currentView === 9 ? "secondary" : "white"}
                                    align={isSubtabsExpanded ? "left" : "center"}
                                    sx={{ 
                                        fontSize: isSubtabsExpanded ? "14px" : "12px",
                                        alignSelf: "center",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {isSubtabsExpanded ? "Upload Data" : "Upload"}
                                </Typography>
                            </Box>

                            <Box
                                sx={{
                                    display: "flex",
                                    flexDirection: isSubtabsExpanded ? "row" : "column",
                                    alignItems: "center",
                                    mb: 0.75,
                                    paddingRight: 0,
                                    paddingLeft: isSubtabsExpanded ? 2 : 0,
                                    paddingBottom: 1,
                                    width: "100%",
                                    justifyContent: isSubtabsExpanded ? "flex-start" : "center",
                                }}
                            >
                                <IconButton
                                    color="white"
                                    aria-label="manage-files"
                                    onClick={() => handleDrawerToggle(10)}
                                    sx={{ 
                                        backgroundColor: currentView === 10 ? "rgba(255, 255, 255, 0.1)" : "transparent",
                                        width: 40,
                                        height: 40,
                                        marginRight: isSubtabsExpanded ? 1 : 0,
                                    }}
                                >
                                    <BuildIcon color={currentView === 10 ? "primary" : "white"} fontSize="small" />
                                </IconButton>
                                <Typography
                                    variant="body"
                                    color={currentView === 10 ? "secondary" : "white"}
                                    align={isSubtabsExpanded ? "left" : "center"}
                                    sx={{ 
                                        fontSize: isSubtabsExpanded ? "14px" : "12px",
                                        alignSelf: "center",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {isSubtabsExpanded ? "Manage Data" : "Manage"}
                                </Typography>
                            </Box>
                        </>
                    )}

                    <Box
                        sx={{
                            display: "flex",
                            flexDirection: isSubtabsExpanded ? "row" : "column",
                            alignItems: isSubtabsExpanded ? "center" : "center",
                            paddingLeft: 0,
                            paddingBottom: 1,
                            width: "100%",
                        }}
                    >
                        <IconButton
                            color="white"
                            aria-label="process"
                            onClick={handleProcessToggle}
                            sx={{ 
                                backgroundColor: (currentView === 1 || currentView === 5 || currentView === 6 || currentView === 7) ? "rgba(255, 255, 255, 0.1)" : "transparent",
                                marginRight: isSubtabsExpanded ? 1 : 0,
                            }}
                        >
                            <InsightsIcon color={(currentView === 1 || currentView === 5 || currentView === 6 || currentView === 7) ? "secondary" : "white"} fontSize="medium" />
                        </IconButton>
                        <Typography
                            variant="body"
                            color={(currentView === 1 || currentView === 5 || currentView === 6 || currentView === 7) ? "secondary" : "white"}
                            align={isSubtabsExpanded ? "left" : "center"}
                            sx={{ 
                                fontSize: "14px",
                                alignSelf: isSubtabsExpanded ? "center" : "auto",
                            }}
                        >
                            Process
                        </Typography>
                    </Box>

                    {/* Expandable Process Section */}
                    {isProcessExpanded && (
                        <>
                            <Box
                                sx={{
                                    display: "flex",
                                    flexDirection: isSubtabsExpanded ? "row" : "column",
                                    alignItems: "center",
                                    paddingRight: 0,
                                    paddingLeft: isSubtabsExpanded ? 2 : 0,
                                    paddingBottom: 1,
                                    width: "100%",
                                    justifyContent: isSubtabsExpanded ? "flex-start" : "center",
                                }}
                            >
                                <IconButton
                                    color="white"
                                    aria-label="mosaic-generation"
                                    onClick={() => handleDrawerToggle(5)}
                                    sx={{ 
                                        backgroundColor: currentView === 5 ? "rgba(255, 255, 255, 0.1)" : "transparent",
                                        width: 40,
                                        height: 40,
                                        marginRight: isSubtabsExpanded ? 1 : 0,
                                    }}
                                >
                                    <DynamicFeedIcon color={currentView === 5 ? "primary" : "white"} fontSize="small" />
                                </IconButton>
                                <Typography
                                    variant="body"
                                    color={currentView === 5 ? "secondary" : "white"}
                                    align={isSubtabsExpanded ? "left" : "center"}
                                    sx={{ 
                                        fontSize: isSubtabsExpanded ? "14px" : "12px",
                                        alignSelf: "center",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {isSubtabsExpanded ? "Generate Mosaic" : "Mosaic"}
                                </Typography>
                            </Box>

                            <Box
                                sx={{
                                    display: "flex",
                                    flexDirection: isSubtabsExpanded ? "row" : "column",
                                    alignItems: "center",
                                    mb: 0.75,
                                    paddingRight: 0,
                                    paddingLeft: isSubtabsExpanded ? 2 : 0,
                                    paddingBottom: 1,
                                    width: "100%",
                                    justifyContent: isSubtabsExpanded ? "flex-start" : "center",
                                }}
                            >
                                <IconButton
                                    color="white"
                                    aria-label="plot-association"
                                    onClick={() => handleDrawerToggle(6)}
                                    sx={{ 
                                        backgroundColor: currentView === 6 ? "rgba(255, 255, 255, 0.1)" : "transparent",
                                        width: 40,
                                        height: 40,
                                        marginRight: isSubtabsExpanded ? 1 : 0,
                                    }}
                                >
                                    <EditRoadIcon color={currentView === 6 ? "primary" : "white"} fontSize="small" />
                                </IconButton>
                                <Typography
                                    variant="body"
                                    color={currentView === 6 ? "secondary" : "white"}
                                    align={isSubtabsExpanded ? "left" : "center"}
                                    sx={{ 
                                        fontSize: isSubtabsExpanded ? "14px" : "12px",
                                        alignSelf: "center",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {isSubtabsExpanded ? "Associate Plots" : "Plots"}
                                </Typography>
                            </Box>

                            <Box
                                sx={{
                                    display: "flex",
                                    flexDirection: isSubtabsExpanded ? "row" : "column",
                                    alignItems: "center",
                                    mb: 0.75,
                                    paddingRight: 0,
                                    paddingLeft: isSubtabsExpanded ? 2 : 0,
                                    paddingBottom: 1,
                                    width: "100%",
                                    justifyContent: isSubtabsExpanded ? "flex-start" : "center",
                                }}
                            >
                                <IconButton
                                    color="white"
                                    aria-label="processing"
                                    onClick={() => handleDrawerToggle(7)}
                                    sx={{ 
                                        backgroundColor: currentView === 7 ? "rgba(255, 255, 255, 0.1)" : "transparent",
                                        width: 40,
                                        height: 40,
                                        marginRight: isSubtabsExpanded ? 1 : 0,
                                    }}
                                >
                                    <QueryStatsIcon color={currentView === 7 ? "primary" : "white"} fontSize="small" />
                                </IconButton>
                                <Typography
                                    variant="body"
                                    color={currentView === 7 ? "secondary" : "white"}
                                    align={isSubtabsExpanded ? "left" : "center"}
                                    sx={{ 
                                        fontSize: isSubtabsExpanded ? "14px" : "12px",
                                        alignSelf: "center",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {isSubtabsExpanded ? "Extract Traits" : "Traits"}
                                </Typography>
                            </Box>
                        </>
                    )}

                    <Box
                        sx={{
                            display: "flex",
                            flexDirection: isSubtabsExpanded ? "row" : "column",
                            alignItems: isSubtabsExpanded ? "center" : "center",
                            paddingRight: 0,
                            paddingLeft: 0,
                            paddingBottom: 1,
                            width: "100%",
                        }}
                    >
                        <IconButton
                            color="white"
                            aria-label="view-data"
                            onClick={handleViewDataToggle}
                            sx={{ 
                                backgroundColor: (currentView === 0 || currentView === 2 || currentView === 4) ? "rgba(255, 255, 255, 0.1)" : "transparent",
                                marginRight: isSubtabsExpanded ? 1 : 0,
                            }}
                        >
                            <FindInPageIcon color={(currentView === 0 || currentView === 2 || currentView === 4) ? "secondary" : "white"} fontSize="medium" />
                        </IconButton>
                        <Typography
                            variant="body"
                            color={(currentView === 0 || currentView === 2 || currentView === 4) ? "secondary" : "white"}
                            align={isSubtabsExpanded ? "left" : "center"}
                            sx={{ 
                                fontSize: "14px",
                                alignSelf: isSubtabsExpanded ? "center" : "auto",
                            }}
                        >
                            Analyze
                        </Typography>
                    </Box>

                    {/* Expandable View Data Section */}
                    {isViewDataExpanded && (
                        <>
                            <Box
                                sx={{
                                    display: "flex",
                                    flexDirection: isSubtabsExpanded ? "row" : "column",
                                    alignItems: "center",
                                    paddingRight: 0,
                                    paddingLeft: isSubtabsExpanded ? 2 : 0,
                                    paddingBottom: 1,
                                    width: "100%",
                                    justifyContent: isSubtabsExpanded ? "flex-start" : "center",
                                }}
                            >
                                <IconButton
                                    color="white"
                                    aria-label="stats"
                                    onClick={() => handleDrawerToggle(2)}
                                    sx={{ 
                                        backgroundColor: currentView === 2 ? "rgba(255, 255, 255, 0.1)" : "transparent",
                                        width: 40,
                                        height: 40,
                                        marginRight: isSubtabsExpanded ? 1 : 0,
                                    }}
                                >
                                    <TableViewIcon color={currentView === 2 ? "primary" : "white"} fontSize="small" />
                                </IconButton>
                                <Typography
                                    variant="body"
                                    color={currentView === 2 ? "secondary" : "white"}
                                    align={isSubtabsExpanded ? "left" : "center"}
                                    sx={{ 
                                        fontSize: isSubtabsExpanded ? "14px" : "12px",
                                        alignSelf: "center",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {isSubtabsExpanded ? "Statistics" : "Stats"}
                                </Typography>
                            </Box>

                            <Box
                                sx={{
                                    display: "flex",
                                    flexDirection: isSubtabsExpanded ? "row" : "column",
                                    alignItems: "center",
                                    mb: 0.75,
                                    paddingRight: 0,
                                    paddingLeft: isSubtabsExpanded ? 2 : 0,
                                    paddingBottom: 1,
                                    width: "100%",
                                    justifyContent: isSubtabsExpanded ? "flex-start" : "center",
                                }}
                            >
                                <IconButton
                                    color="white"
                                    aria-label="map"
                                    onClick={() => handleDrawerToggle(0)}
                                    sx={{ 
                                        backgroundColor: currentView === 0 ? "rgba(255, 255, 255, 0.1)" : "transparent",
                                        width: 40,
                                        height: 40,
                                        marginRight: isSubtabsExpanded ? 1 : 0,
                                    }}
                                >
                                    <MapIcon color={currentView === 0 ? "primary" : "white"} fontSize="small" />
                                </IconButton>
                                <Typography
                                    variant="body"
                                    color={currentView === 0 ? "secondary" : "white"}
                                    align={isSubtabsExpanded ? "left" : "center"}
                                    sx={{ 
                                        fontSize: isSubtabsExpanded ? "14px" : "12px",
                                        alignSelf: "center",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {isSubtabsExpanded ? "Map View" : "Map"}
                                </Typography>
                            </Box>

                            <Box
                                sx={{
                                    display: "flex",
                                    flexDirection: isSubtabsExpanded ? "row" : "column",
                                    alignItems: "center",
                                    mb: 0.75,
                                    paddingRight: 0,
                                    paddingLeft: isSubtabsExpanded ? 2 : 0,
                                    paddingBottom: 1,
                                    width: "100%",
                                    justifyContent: isSubtabsExpanded ? "flex-start" : "center",
                                }}
                            >
                                <IconButton
                                    color="white"
                                    aria-label="query"
                                    onClick={() => handleDrawerToggle(4)}
                                    sx={{ 
                                        backgroundColor: currentView === 4 ? "rgba(255, 255, 255, 0.1)" : "transparent",
                                        width: 40,
                                        height: 40,
                                        marginRight: isSubtabsExpanded ? 1 : 0,
                                    }}
                                >
                                    <FilterIcon color={currentView === 4 ? "primary" : "white"} fontSize="small" />
                                </IconButton>
                                <Typography
                                    variant="body"
                                    color={currentView === 4 ? "secondary" : "white"}
                                    align={isSubtabsExpanded ? "left" : "center"}
                                    sx={{ 
                                        fontSize: isSubtabsExpanded ? "14px" : "12px",
                                        alignSelf: "center",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {isSubtabsExpanded ? "Image Query" : "Query"}
                                </Typography>
                            </Box>
                        </>
                    )}
                    {/* Close tab sidebar button */}
                    <Box
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            mt: "auto",
                            mb: 2,
                            paddingRight: 0,
                            paddingLeft: 0,
                            paddingBottom: 1,
                        }}
                    >
                        <IconButton
                            color="white"
                            aria-label="close-sidebar"
                            onClick={handleTabSidebarToggle}
                            sx={{ backgroundColor: "transparent" }}
                        >
                            <KeyboardArrowLeftIcon color="white" fontSize="medium" />
                        </IconButton>
                        <Typography
                            variant="body"
                            color="white"
                            align="center"
                            sx={{ fontSize: "14px" }}
                        >
                            Hide
                        </Typography>
                    </Box>
                </Box>

                {/* Collapsed state - only show open button */}
                {isTabSidebarCollapsed && (
                    <Box
                        sx={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            position: "fixed",
                            height: "100vh",
                            backgroundColor: "transparent",
                            width: `${smallDrawerWidth}px`,
                            zIndex: (theme) => theme.zIndex.drawer + 1,
                            justifyContent: "center",
                        }}
                    >
                        <Box
                            sx={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                backgroundColor: "#546d78",
                                borderRadius: "8px",
                                padding: 1,
                            }}
                        >
                            <IconButton
                                color="white"
                                aria-label="open-sidebar"
                                onClick={handleTabSidebarToggle}
                                sx={{ backgroundColor: "transparent" }}
                            >
                                <KeyboardArrowRightIcon color="white" fontSize="medium" />
                            </IconButton>
                            <Typography
                                variant="body"
                                color="white"
                                align="center"
                                sx={{ fontSize: "14px" }}
                            >
                                Menu
                            </Typography>
                        </Box>
                    </Box>
                )}

                <Drawer
                    variant="persistent"
                    anchor="left"
                    open={shouldDrawerBeOpen()}
                    sx={{
                        width: shouldDrawerBeOpen() ? `${drawerWidth}px` : 0,
                        flexShrink: 0,
                        marginLeft: !isTabSidebarCollapsed ? (isSubtabsExpanded ? `${expandedSidebarWidth}px` : `${smallDrawerWidth}px`) : 0,
                        "& .MuiDrawer-paper": {
                            marginLeft: !isTabSidebarCollapsed ? (isSubtabsExpanded ? `${expandedSidebarWidth}px` : `${smallDrawerWidth}px`) : 0,
                            width: shouldDrawerBeOpen() ? `${drawerWidth}px` : 0,
                            transition: (theme) =>
                                theme.transitions.create(["width", "margin"], {
                                    easing: theme.transitions.easing.sharp,
                                    duration: theme.transitions.duration.standard,
                                }),
                            boxSizing: "border-box",
                            backgroundColor: "#546d78",
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

                {/* Floating Help Icon */}
                <Box
                    sx={{
                        position: 'fixed',
                        bottom: 24,
                        right: 24,
                        zIndex: (theme) => theme.zIndex.fab,
                    }}
                >
                    <Tooltip title="View Documentation" placement="left">
                        <IconButton
                            color="primary"
                            aria-label="help"
                            onClick={() => handleDrawerToggle(8)}
                            sx={{
                                backgroundColor: "success.main",
                                color: "white",
                                width: 48,
                                height: 48,
                                boxShadow: 3,
                                '&:hover': {
                                    backgroundColor: "success.light",
                                    boxShadow: 6,
                                },
                            }}
                        >
                            <HelpIcon fontSize="large" />
                        </IconButton>
                    </Tooltip>
                </Box>

                {/* Floating Bug Report Icon */}
                <Box
                    sx={{
                        position: 'fixed',
                        top: currentView === 0 ? 'auto' : 24,
                        bottom: currentView === 0 ? 88 : 'auto', // Just above help icon (48px height + 16px gap + 24px bottom margin)
                        right: 24,
                        zIndex: (theme) => theme.zIndex.fab,
                    }}
                >
                    <Tooltip title="Report an Issue" placement="left">
                        <IconButton
                            color="primary"
                            aria-label="bug-report"
                            onClick={handleReportBug}
                            sx={{
                                backgroundColor: "#546d78",
                                color: "white",
                                width: 48,
                                height: 48,
                                boxShadow: 3,
                                '&:hover': {
                                    backgroundColor: "error.main",
                                    boxShadow: 6,
                                },
                            }}
                        >
                            <img 
                                src={gitHubIcon}
                                alt="GitHub"
                                style={{ 
                                    width: '42px',
                                    height: '42px',
                                }} 
                            />
                        </IconButton>
                    </Tooltip>
                </Box>
            </Box>
        </ThemeProvider>
    );
}
