import React, { useState, useEffect } from "react";
import { useTheme } from '@mui/material/styles';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Button,
    CircularProgress,
    Box,
    Slider,
    Typography,
    DialogActions,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    Drawer,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Checkbox,
    FormControlLabel
} from '@mui/material';
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CloseIcon from "@mui/icons-material/Close";
import { useDataState } from "../../DataContext";
import Map, { Source, Layer } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
const reactMapboxToken = process.env.REACT_APP_MAPBOX_TOKEN;

const GpsPlot = ({ gpsData, currentPoint, viewState, onViewStateChange }) => {
    if (!gpsData || gpsData.length === 0) {
        console.log("No GPS data available.");
        return <Box sx={{ width: '100%', height: 400, border: '1px solid grey', p: 1, boxSizing: 'border-box' }}>No GPS data</Box>;
    }
    const validGpsData = gpsData.filter(p => typeof p.lon === 'number' && typeof p.lat === 'number' && !isNaN(p.lon) && !isNaN(p.lat));

    const pathGeoJSON = {
        type: 'Feature',
        geometry: {
            type: 'LineString',
            coordinates: validGpsData.map(p => [p.lon, p.lat])
        }
    };
    const currentPointGeoJSON = (currentPoint &&
      typeof currentPoint.lon === 'number' &&
      typeof currentPoint.lat === 'number' &&
      !isNaN(currentPoint.lon) &&
      !isNaN(currentPoint.lat))
      ? {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [currentPoint.lon, currentPoint.lat]
          }
        }
      : null;

    const currentPointMessage = !currentPointGeoJSON
      ? "No GPS data found for current image."
      : null;
    {currentPointMessage && (
      <div style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 1,
          backgroundColor: 'rgba(255, 255, 255, 0.8)',
          padding: '8px',
          borderRadius: '4px'
      }}>
          {currentPointMessage}
      </div>
    )}

    return (
        <Map
            {...viewState}
            onMove={evt => onViewStateChange(evt.viewState)}
            style={{width: '100%', height: 500}}
            mapStyle="mapbox://styles/mapbox/satellite-v9"
            mapboxAccessToken={reactMapboxToken}
        >
            <Source id="gps-path" type="geojson" data={pathGeoJSON}>
                <Layer
                    id="path-layer"
                    type="line"
                    paint={{
                        'line-color': '#007cbf',
                        'line-width': 3
                    }}
                />
            </Source>
            {currentPointGeoJSON && (
                <Source id="current-point" type="geojson" data={currentPointGeoJSON}>
                    <Layer
                        id="point-layer"
                        type="circle"
                        paint={{
                            'circle-radius': 8,
                            'circle-color': 'red',
                            'circle-stroke-width': 2,
                            'circle-stroke-color': 'white'
                        }}
                    />
                </Source>
            )}
        </Map>
    );
};


export const GroundPlotMarker = ({ open, obj, onClose, plotIndex: initialPlotIndex, onPlotIndexChange }) => {
    const [imageIndex, setImageIndex] = useState(0);
    const [imageList, setImageList] = useState([]);
    const [imageViewerLoading, setImageViewerLoading] = useState(false);
    const {flaskUrl} = useDataState();
    const [directory, setDirectory] = useState("");
    const [imageLoading, setImageLoading] = useState(false);
    const [plotSelectionState, setPlotSelectionState] = useState('start');
    const imageRef = React.useRef(null);
    const [plotIndex, setPlotIndex] = useState(initialPlotIndex);
    const [stitchDirectionDialogOpen, setStitchDirectionDialogOpen] = useState(false);
    const [stitchDirection, setStitchDirection] = useState('');
    const [shiftAll, setShiftAll] = useState(false);
    const [currentImagePlotIndex, setCurrentImagePlotIndex] = useState(null);
    const [startImageName, setStartImageName] = useState(null);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [isGpsPanelOpen, setIsGpsPanelOpen] = useState(false);
    const [markedPlots, setMarkedPlots] = useState([]);
    const [originalPlotIndex, setOriginalPlotIndex] = useState(null);
    const [gpsData, setGpsData] = useState([]);
    const [currentLatLon, setCurrentLatLon] = useState(null);
    const [viewState, setViewState] = useState({
        longitude: -121.777,
        latitude: 38.536,
        zoom: 14
    });
    const [cropMode, setCropMode] = useState(false);
    const [cropBox, setCropBox] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const [dragStart, setDragStart] = useState(null);
    const [resizeHandle, setResizeHandle] = useState(null);
    const [cropBoundaryDialogOpen, setCropBoundaryDialogOpen] = useState(false);
    const [pendingCropMask, setPendingCropMask] = useState(null);
    const imageContainerRef = React.useRef(null);

    const theme = useTheme();
    const drawerWidth = 200;
    const gpsDrawerWidth = 400;

    useEffect(() => {
        if (open) {
            setPlotIndex(initialPlotIndex);
        }
    }, [open, initialPlotIndex]);

    useEffect(() => {
        if (open && obj) {
            setImageIndex(0);
            if(obj.platform === 'rover'){
                const newDirectory = `Raw/${obj.year}/${obj.experiment}/${obj.location}/${obj.population}/${obj.date}/${obj.platform}/RGB/Images/${obj.camera}/`;
                setDirectory(newDirectory);
            }
            else {
                const newDirectory = `Raw/${obj.year}/${obj.experiment}/${obj.location}/${obj.population}/${obj.date}/${obj.platform}/${obj.sensor}/Images/`;
                setDirectory(newDirectory);
            }
        }
    }, [open, obj]);

    const fetchGpsData = async () => {
        if (!directory) return;
        try {
            const response = await fetch(`${flaskUrl}get_gps_data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ directory }),
            });
            const data = await response.json();
            if (response.ok) {
                setGpsData(data);
                 if (data.length > 0) {
                    const lons = data.map(p => p.lon).filter(l => typeof l === 'number' && !isNaN(l));
                    const lats = data.map(p => p.lat).filter(l => typeof l === 'number' && !isNaN(l));
                    if (lons.length > 0 && lats.length > 0) {
                        setViewState({
                            longitude: lons.reduce((a, b) => a + b, 0) / lons.length,
                            latitude: lats.reduce((a, b) => a + b, 0) / lats.length,
                            zoom: 20
                        });
                    }
                }
            } else {
                console.error("Failed to fetch GPS data:", data.error);
            }
        } catch (error) {
            console.error("Error fetching GPS data:", error);
        }
    };

     useEffect(() => {
        if (isGpsPanelOpen && currentLatLon) {
             setViewState(prev => ({
                ...prev,
                longitude: currentLatLon.lon,
                latitude: currentLatLon.lat,
                zoom: 20
            }));
        }
    }, [isGpsPanelOpen, currentLatLon]);


    useEffect(() => {
        if (directory) {
            fetchImages();
            fetchMarkedPlots();
            fetchGpsData();
        }
    }, [directory]);

    useEffect(() => {
        if (imageList.length > 0 && directory) {
            fetchImagePlotIndex();
        }
    }, [imageIndex, imageList, directory]);

    const API_ENDPOINT = `${flaskUrl}files`;

    const fetchImagePlotIndex = async () => {
        const imageName = imageList[imageIndex];
        if (!imageName) return;

        try {
            const response = await fetch(`${flaskUrl}get_image_plot_index`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    directory: directory,
                    image_name: imageName,
                }),
            });
            const data = await response.json();
            if (response.ok) {
                setCurrentImagePlotIndex(data.plot_index);
                if (data.lat !== null && data.lon !== null) {
                    setCurrentLatLon({ lat: data.lat, lon: data.lon });
                } else {
                    setCurrentLatLon(null);
                }
            } else {
                console.error("Failed to fetch plot index:", data.error);
                setCurrentImagePlotIndex(null);
                setCurrentLatLon(null);
            }
        } catch (error) {
            console.error("Error fetching plot index:", error);
            setCurrentImagePlotIndex(null);
            setCurrentLatLon(null);
        }
    };

    const fetchMarkedPlots = async () => {
        if (!directory) return;
        try {
            const response = await fetch(`${flaskUrl}get_plot_data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ directory }),
            });
            const data = await response.json();
            if (response.ok) {
                setMarkedPlots(data.sort((a, b) => a.plot_index - b.plot_index));
            } else {
                console.error("Failed to fetch marked plots:", data.error);
            }
        } catch (error) {
            console.error("Error fetching marked plots:", error);
        }
    };

    const fetchImages = async () => {
        try {
            setImageViewerLoading(true);
            const response = await fetch(`${flaskUrl}list_files/${directory}`);
            const data = await response.json();
            setImageList(data);
            setImageViewerLoading(false);
        } catch (error) {
            console.error("Error fetching images:", error);
            setImageViewerLoading(false);
        }
    };

    const fetchMaxPlotIndex = async () => {
        if (!directory) return -1;
        try {
            const response = await fetch(`${flaskUrl}get_max_plot_index`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ directory }),
            });
            const data = await response.json();
            if (response.ok) {
                return data.max_plot_index;
            } else {
                console.error("Failed to fetch max plot index:", data.error);
                return -1;
            }
        } catch (error) {
            console.error("Error fetching max plot index:", error);
            return -1;
        }
    };

    const handlePrevious = () => {
        if (imageIndex > 0) {
            setImageIndex(imageIndex - 1);
            setImageLoading(true);
        }
    };

    const handleNext = () => {
        if (imageIndex < imageList.length - 1) {
            setImageIndex(imageIndex + 1);
            setImageLoading(true);
        }
    };

    const handleBackButton = () => {
        onClose();
    };

    const handleImageLoadEnd = () => {
        setImageLoading(false);
    };

    const handleCancel = () => {
        setPlotSelectionState('start');
        setStartImageName(null);
    };

    const handlePlotSelection = async () => {
        const imageName = imageList[imageIndex];
        if (plotSelectionState === 'start') {
            setStartImageName(imageName);
            setPlotSelectionState('end');
        }
    };

    const handleStitchDirectionSelection = async (direction) => {
        const endImageName = imageList[imageIndex];
        let shiftAmount = 0;
        let originalStartImageIndex = null;
        
        // Calculate shift amount if this is a modification (originalPlotIndex exists) and shiftAll is checked
        if (originalPlotIndex !== null && shiftAll) {
            // Get the current start image index
            const currentStartImageIndex = imageList.findIndex(img => img === startImageName);
            
            // Find the original start image index from markedPlots
            const originalPlot = markedPlots.find(plot => plot.plot_index === originalPlotIndex);
            if (originalPlot) {
                const originalStartImageName = originalPlot.image_name.split("/").pop();
                originalStartImageIndex = imageList.findIndex(img => img === originalStartImageName);
                
                if (originalStartImageIndex !== -1 && currentStartImageIndex !== -1) {
                    shiftAmount = originalStartImageIndex - currentStartImageIndex;
                }
            }
        }
        
        try {
            const response = await fetch(`${flaskUrl}mark_plot`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    directory: directory,
                    start_image_name: startImageName,
                    end_image_name: endImageName,
                    plot_index: plotIndex,
                    camera: obj.camera,
                    stitch_direction: direction,
                    original_plot_index: originalPlotIndex,
                    shift_all: shiftAll,
                    shift_amount: shiftAmount,
                    original_start_image_index: originalStartImageIndex
                }),
            });

            if (response.ok) {
                fetchMarkedPlots(); // Refresh plot list
                if (originalPlotIndex !== null) {
                    // After completing a "change" request, fetch the max plot index to set the correct next value
                    const maxPlotIndex = await fetchMaxPlotIndex();
                    const nextPlotIndex = maxPlotIndex + 1;
                    setPlotIndex(nextPlotIndex);
                    onPlotIndexChange(nextPlotIndex);
                    setOriginalPlotIndex(null);
                } else {
                    const newPlotIndex = plotIndex + 1;
                    setPlotIndex(newPlotIndex);
                    onPlotIndexChange(newPlotIndex);
                }
                setPlotSelectionState('start');
                setStartImageName(null);
                setShiftAll(false); // Reset shift all checkbox
            } else {
                console.error("Failed to mark plot end with stitch direction");
            }
        } catch (error) {
            console.error("Error marking plot end:", error);
        }
        setStitchDirectionDialogOpen(false);
    };

    const handleDeletePlot = async (plotIndexToDelete) => {
        try {
            const response = await fetch(`${flaskUrl}delete_plot`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ directory, plot_index: plotIndexToDelete }),
            });
            if (response.ok) {
                fetchMarkedPlots(); // Refresh plot list
            } else {
                console.error("Failed to delete plot");
            }
        } catch (error) {
            console.error("Error deleting plot:", error);
        }
    };

    const handleChangePlot = (plot) => {
        console.log("Start image for plot: ", plot.image_name);
        const image = plot.image_name.split(["/"]).pop();
        const imageIdx = imageList.findIndex(img => img === image);
        console.log("Image Index:", imageIdx, "Plot Index:", plot.plot_index);
        if (imageIdx !== -1) {
            if (originalPlotIndex === null) {
                setOriginalPlotIndex(plot.plot_index);
                console.log("Original Plot Index set to:", plot.plot_index);
            }
            setPlotIndex(plot.plot_index);
            setImageIndex(imageIdx);
            setImageLoading(true);
            setPlotSelectionState('start');
        } else {
            console.error("Start image for the plot not found in the image list.");
        }
    };

    const getImageContainerBounds = () => {
        if (!imageContainerRef.current) return null;
        return imageContainerRef.current.getBoundingClientRect();
    };

    const handleCropButtonClick = () => {
        if (!cropMode) {
            // Initialize crop box in center of image container
            const bounds = getImageContainerBounds();
            if (bounds) {
                const size = Math.min(bounds.width, bounds.height) * 0.3;
                setCropBox({
                    x: (bounds.width - size) / 2,
                    y: (bounds.height - size) / 2,
                    width: size,
                    height: size
                });
            }
        } else {
            setCropBox(null);
        }
        setCropMode(!cropMode);
    };

    const handleMouseDown = (e) => {
        if (!cropMode || !cropBox) return;
        e.preventDefault();
        
        const bounds = getImageContainerBounds();
        if (!bounds) return;
        
        const x = e.clientX - bounds.left;
        const y = e.clientY - bounds.top;
    
        const handleSize = 10;
        const handles = [
            { name: 'nw', x: cropBox.x, y: cropBox.y },
            { name: 'ne', x: cropBox.x + cropBox.width, y: cropBox.y },
            { name: 'sw', x: cropBox.x, y: cropBox.y + cropBox.height },
            { name: 'se', x: cropBox.x + cropBox.width, y: cropBox.y + cropBox.height },
            { name: 'n', x: cropBox.x + cropBox.width / 2, y: cropBox.y },
            { name: 's', x: cropBox.x + cropBox.width / 2, y: cropBox.y + cropBox.height },
            { name: 'e', x: cropBox.x + cropBox.width, y: cropBox.y + cropBox.height / 2 },
            { name: 'w', x: cropBox.x, y: cropBox.y + cropBox.height / 2 }
        ];
        
        for (let handle of handles) {
            if (Math.abs(x - handle.x) <= handleSize && Math.abs(y - handle.y) <= handleSize) {
                setIsResizing(true);
                setResizeHandle(handle.name);
                setDragStart({ x, y, cropBox: { ...cropBox } });
                return;
            }
        }
        if (x >= cropBox.x && x <= cropBox.x + cropBox.width &&
            y >= cropBox.y && y <= cropBox.y + cropBox.height) {
            setIsDragging(true);
            setDragStart({ x, y, cropBox: { ...cropBox } });
        }
    };

    const handleMouseMove = (e) => {
        if (!cropMode || !dragStart) return;
        
        const bounds = getImageContainerBounds();
        if (!bounds) return;
        
        const x = e.clientX - bounds.left;
        const y = e.clientY - bounds.top;
        const deltaX = x - dragStart.x;
        const deltaY = y - dragStart.y;
        
        if (isDragging) {
            setCropBox({
                x: Math.max(0, Math.min(bounds.width - dragStart.cropBox.width, dragStart.cropBox.x + deltaX)),
                y: Math.max(0, Math.min(bounds.height - dragStart.cropBox.height, dragStart.cropBox.y + deltaY)),
                width: dragStart.cropBox.width,
                height: dragStart.cropBox.height
            });
        } else if (isResizing && resizeHandle) {
            let newBox = { ...dragStart.cropBox };
            
            switch (resizeHandle) {
                case 'nw':
                    newBox.width = Math.max(20, newBox.width - deltaX);
                    newBox.height = Math.max(20, newBox.height - deltaY);
                    newBox.x = Math.max(0, newBox.x + deltaX);
                    newBox.y = Math.max(0, newBox.y + deltaY);
                    break;
                case 'ne':
                    newBox.width = Math.max(20, newBox.width + deltaX);
                    newBox.height = Math.max(20, newBox.height - deltaY);
                    newBox.y = Math.max(0, newBox.y + deltaY);
                    break;
                case 'sw':
                    newBox.width = Math.max(20, newBox.width - deltaX);
                    newBox.height = Math.max(20, newBox.height + deltaY);
                    newBox.x = Math.max(0, newBox.x + deltaX);
                    break;
                case 'se':
                    newBox.width = Math.max(20, newBox.width + deltaX);
                    newBox.height = Math.max(20, newBox.height + deltaY);
                    break;
                case 'n':
                    newBox.height = Math.max(20, newBox.height - deltaY);
                    newBox.y = Math.max(0, newBox.y + deltaY);
                    break;
                case 's':
                    newBox.height = Math.max(20, newBox.height + deltaY);
                    break;
                case 'e':
                    newBox.width = Math.max(20, newBox.width + deltaX);
                    break;
                case 'w':
                    newBox.width = Math.max(20, newBox.width - deltaX);
                    newBox.x = Math.max(0, newBox.x + deltaX);
                    break;
            }
            
            if (newBox.x + newBox.width > bounds.width) {
                newBox.width = bounds.width - newBox.x;
            }
            if (newBox.y + newBox.height > bounds.height) {
                newBox.height = bounds.height - newBox.y;
            }
            
            setCropBox(newBox);
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
        setIsResizing(false);
        setDragStart(null);
        setResizeHandle(null);
    };

    const handleConfirmCrop = () => {
        if (!cropBox) return;
        
        const bounds = getImageContainerBounds();
        if (!bounds || !imageRef.current) return;
        
        const imageRect = imageRef.current.getBoundingClientRect();
        const imageWidth = imageRect.width;
        const imageHeight = imageRect.height;
        
        const scaleX = imageRef.current.naturalWidth / imageWidth;
        const scaleY = imageRef.current.naturalHeight / imageHeight;
        
        const imageLeft = (imageRect.left - bounds.left);
        const imageTop = (imageRect.top - bounds.top);
        
        const cropLeftOnImage = (cropBox.x - imageLeft) * scaleX;
        const cropTopOnImage = (cropBox.y - imageTop) * scaleY;
        const cropRightOnImage = (cropBox.x + cropBox.width - imageLeft) * scaleX;
        const cropBottomOnImage = (cropBox.y + cropBox.height - imageTop) * scaleY;
    
        const leftMask = Math.max(0, Math.round(cropLeftOnImage));
        const rightMask = Math.max(0, Math.round(imageRef.current.naturalWidth - cropRightOnImage));
        const topMask = Math.max(0, Math.round(cropTopOnImage));
        const bottomMask = Math.max(0, Math.round(imageRef.current.naturalHeight - cropBottomOnImage));
        
        setPendingCropMask([leftMask, rightMask, topMask, bottomMask]);
        setCropBoundaryDialogOpen(true);
    };

    const handleCancelCrop = () => {
        setCropBox(null);
        setCropMode(false);
    };

    const handleConfirmCropBoundary = async () => {
        if (!pendingCropMask || !directory) return;
        
        try {
            const response = await fetch(`${flaskUrl}save_stitch_mask`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    directory: directory,
                    mask: pendingCropMask
                }),
            });
            
            if (response.ok) {
                console.log("Stitch boundary saved successfully:", pendingCropMask);
            } else {
                console.error("Failed to save stitch boundary");
            }
        } catch (error) {
            console.error("Error saving stitch boundary:", error);
        }
        setCropBox(null);
        setCropMode(false);
        setPendingCropMask(null);
        setCropBoundaryDialogOpen(false);
    };

    const handleCancelCropBoundary = () => {
        setPendingCropMask(null);
        setCropBoundaryDialogOpen(false);
    };

    useEffect(() => {
        if (!open) return;

        const handleKeyDown = (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
                handlePrevious();
            } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
                handleNext();
            } else if (e.key === 'ArrowUp') {
                const newIndex = Math.min(imageList.length - 1, imageIndex + 10);
                if (newIndex !== imageIndex) {
                    setImageIndex(newIndex);
                    setImageLoading(true);
                }
            } else if (e.key === 'ArrowDown') {
                const newIndex = Math.max(0, imageIndex - 10);
                if (newIndex !== imageIndex) {
                    setImageIndex(newIndex);
                    setImageLoading(true);
                }
            } else if (e.key === 'Enter') {
                if (plotSelectionState === 'start') {
                    handlePlotSelection();
                } else {
                    setStitchDirectionDialogOpen(true);
                }
            } else if (e.key === 'Escape') {
                // Cancel crop mode if active
                if (cropMode) {
                    setCropBox(null);
                    setCropMode(false);
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open, imageIndex, imageList.length, plotSelectionState]);
    
    return (
        <Dialog
            open={open}
            onClose={handleBackButton}
            fullScreen
            PaperProps={{
                style: {
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    padding: '5px'
                }
            }}
        >
            <Box sx={{ display: 'flex', height: '100%' }}>
                <Drawer
                    sx={{
                        width: gpsDrawerWidth,
                        flexShrink: 0,
                        '& .MuiDrawer-paper': {
                            width: gpsDrawerWidth,
                            boxSizing: 'border-box',
                        },
                    }}
                    variant="persistent"
                    anchor="left"
                    open={isGpsPanelOpen}
                >
                    <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="h6" gutterBottom component="div">
                            GPS Data
                        </Typography>
                        <IconButton onClick={() => setIsGpsPanelOpen(false)}>
                            <CloseIcon />
                        </IconButton>
                    </Box>
                    <Box sx={{ px: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                         {gpsData.length > 0 && currentLatLon &&
                            <GpsPlot 
                                gpsData={gpsData} 
                                currentPoint={currentLatLon}
                                viewState={viewState}
                                onViewStateChange={setViewState}
                            />
                        }
                        {currentLatLon && (
                            <Typography variant="caption" display="block" sx={{ mt: 1, textAlign: 'center' }}>
                                Lat: {currentLatLon.lat.toFixed(6)}<br/>
                                Lon: {currentLatLon.lon.toFixed(6)}
                            </Typography>
                        )}
                    </Box>
                </Drawer>
                <Box
                    component="main"
                    sx={{
                        flexGrow: 1,
                        p: 3,
                        display: 'flex',
                        height: '100%',
                        flexDirection: 'column',
                        transition: theme.transitions.create('margin', {
                            easing: theme.transitions.easing.sharp,
                            duration: theme.transitions.duration.leavingScreen,
                        }),
                        marginLeft: `-${gpsDrawerWidth}px`,
                        marginRight: `-${drawerWidth}px`,
                        ...(isGpsPanelOpen && {
                            transition: theme.transitions.create('margin', {
                                easing: theme.transitions.easing.easeOut,
                                duration: theme.transitions.duration.enteringScreen,
                            }),
                            marginLeft: 0,
                        }),
                        ...(isPanelOpen && {
                            transition: theme.transitions.create('margin', {
                                easing: theme.transitions.easing.easeOut,
                                duration: theme.transitions.duration.enteringScreen,
                            }),
                            marginRight: 0,
                        }),
                    }}
                >
                    <DialogTitle>
                        <IconButton
                            onClick={handleBackButton}
                            style={{
                                position: "absolute",
                                top: "10px",
                                left: "10px",
                                zIndex: 10,
                                width: '40px',
                                height: '40px',
                                backgroundColor: '#3874cb',
                            }}
                            size="large"
                        >
                            <ArrowBackIcon style={{ color: "white", fontSize: '2rem' }} />
                        </IconButton>
                        
                        <Button
                            variant="contained"
                            onClick={() => setIsGpsPanelOpen(true)}
                            style={{
                                position: "absolute",
                                top: "60px",
                                left: "10px",
                                zIndex: 10,
                            }}
                        >
                            View GPS Data
                        </Button>

                        <Typography variant="h6" style={{ position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}>
                            Next Plot Index: {plotIndex}
                        </Typography>
                        <Button
                            variant="contained"
                            onClick={() => setIsPanelOpen(true)}
                            style={{
                                position: "absolute",
                                top: "60px",
                                right: "10px",
                                zIndex: 10,
                            }}
                        >
                            Marked Plots
                        </Button>
                    </DialogTitle>
                    <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', flexGrow: 1, minHeight: 0 }}>

                        {imageViewerLoading ? (
                            <CircularProgress />
                        ) : (
                            <Box
                                ref={imageContainerRef}
                                sx={{
                                    position: 'relative',
                                    width: '100%',
                                    flexGrow: 1,
                                    overflow: 'hidden',
                                    cursor: cropMode ? (isDragging ? 'move' : isResizing ? 'nwse-resize' : 'default') : 'default'
                                }}
                                onMouseDown={handleMouseDown}
                                onMouseMove={handleMouseMove}
                                onMouseUp={handleMouseUp}
                                onMouseLeave={handleMouseUp}
                            >
                                {imageList.length > 0 && (
                                    <img
                                        ref={imageRef}
                                        src={`${API_ENDPOINT}/${directory}${imageList[imageIndex]}`}
                                        alt={`Image ${imageIndex + 1}`}
                                        style={{
                                            position: 'absolute',
                                            width: `100%`,
                                            height: `100%`,
                                            objectFit: "contain",
                                            pointerEvents: 'none',
                                            display: imageLoading ? 'none' : 'block'
                                        }}
                                        hidden={imageLoading}
                                        onLoad={handleImageLoadEnd}
                                    />
                                )}
                                <div style={{
                                    position: 'absolute',
                                    top: 0,
                                    bottom: 0,
                                    left: '50%',
                                    borderLeft: '2px dashed white',
                                    transform: 'translateX(-50%)'
                                }} />
                                <div style={{
                                    position: 'absolute',
                                    left: 0,
                                    right: 0,
                                    top: '50%',
                                    borderTop: '2px dashed white',
                                    transform: 'translateY(-50%)'
                                }} />
                            
                                <Button
                                    variant="contained"
                                    onClick={handleCropButtonClick}
                                    sx={{
                                        position: 'absolute',
                                        top: 10,
                                        left: '50%',
                                        transform: 'translateX(-50%)',
                                        zIndex: 20,
                                        backgroundColor: cropMode ? 'rgba(244, 67, 54, 0.8)' : 'rgba(33, 150, 243, 0.75)',
                                        '&:hover': {
                                            backgroundColor: cropMode ? 'rgba(211, 47, 47, 0.9)' : 'rgba(25, 118, 210, 0.9)'
                                        }
                                    }}
                                >
                                    {cropMode ? '' : 'Crop'}
                                </Button>
                            
                                {cropBox && (
                                    <div
                                        style={{
                                            position: 'absolute',
                                            left: cropBox.x,
                                            top: cropBox.y,
                                            width: cropBox.width,
                                            height: cropBox.height,
                                            border: '2px solid red',
                                            backgroundColor: 'rgba(255, 0, 0, 0.1)',
                                            zIndex: 10
                                        }}
                                    >
                                        {['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map(handle => {
                                            let style = {
                                                position: 'absolute',
                                                width: '10px',
                                                height: '10px',
                                                backgroundColor: 'red',
                                                border: '1px solid white',
                                                cursor: handle.includes('n') || handle.includes('s') ? 
                                                    (handle.includes('w') || handle.includes('e') ? 'nwse-resize' : 'ns-resize') :
                                                    'ew-resize'
                                            };
                                            
                                            switch(handle) {
                                                case 'nw': style = {...style, top: '-5px', left: '-5px', cursor: 'nw-resize'}; break;
                                                case 'ne': style = {...style, top: '-5px', right: '-5px', cursor: 'ne-resize'}; break;
                                                case 'sw': style = {...style, bottom: '-5px', left: '-5px', cursor: 'sw-resize'}; break;
                                                case 'se': style = {...style, bottom: '-5px', right: '-5px', cursor: 'se-resize'}; break;
                                                case 'n': style = {...style, top: '-5px', left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize'}; break;
                                                case 's': style = {...style, bottom: '-5px', left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize'}; break;
                                                case 'e': style = {...style, top: '50%', right: '-5px', transform: 'translateY(-50%)', cursor: 'ew-resize'}; break;
                                                case 'w': style = {...style, top: '50%', left: '-5px', transform: 'translateY(-50%)', cursor: 'ew-resize'}; break;
                                            }
                                            
                                            return <div key={handle} style={style} />;
                                        })}
                            
                                        <Box sx={{
                                            position: 'absolute',
                                            bottom: 5,
                                            right: 5,
                                            display: 'flex',
                                            gap: 1
                                        }}>
                                            <Button
                                                size="small"
                                                variant="contained"
                                                color="success"
                                                onClick={handleConfirmCrop}
                                                sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.7rem' }}
                                            >
                                                Confirm
                                            </Button>
                                            <Button
                                                size="small"
                                                variant="contained"
                                                color="error"
                                                onClick={handleCancelCrop}
                                                sx={{ minWidth: 'auto', px: 1, py: 0.5, fontSize: '0.7rem' }}
                                            >
                                                Cancel
                                            </Button>
                                        </Box>
                                    </div>
                                )}
                            </Box>
                        )}
                        <Typography>
                            {(currentImagePlotIndex === -1 || currentImagePlotIndex === null) ? 
                                "" :
                                <strong>Image Plot Index: {currentImagePlotIndex}</strong>
                            }
                        </Typography>
                        <Typography>Image {imageIndex + 1} of {imageList.length}</Typography>
                        <Box sx={{ width: '80%', mt: 2, position: 'relative' }}>
                            <Slider
                                value={imageIndex}
                                onChange={(e, newValue) => {
                                    if (newValue !== imageIndex) {
                                        setImageIndex(newValue);
                                        setImageLoading(true);
                                    }
                                }}
                                aria-labelledby="image-slider"
                                min={0}
                                max={imageList.length > 0 ? imageList.length - 1 : 0}
                            />
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', mt: 4 }}>
                            <Button variant="contained" onClick={handlePrevious} disabled={imageIndex === 0}>Previous</Button>
                            <Button
                                variant="contained"
                                style={{ backgroundColor: plotSelectionState === 'start' ? 'green' : 'red', color: 'white' }}
                                onClick={() => {
                                    if (plotSelectionState === 'start') {
                                        handlePlotSelection();
                                    } else {
                                        setStitchDirectionDialogOpen(true);
                                    }
                                }}
                            >
                                {plotSelectionState === 'start' ? 'Start' : 'End'}
                            </Button>
                            {plotSelectionState === 'end' && (
                                <Button variant="contained" onClick={handleCancel} style={{ backgroundColor: 'purple', color: 'white' }}>
                                    Cancel
                                </Button>
                            )}
                            <Button variant="contained" onClick={handleNext} disabled={imageIndex === imageList.length - 1}>Next</Button>
                        </Box>
                    </DialogContent>
                </Box>
                <Drawer
                    sx={{
                        width: drawerWidth,
                        flexShrink: 0,
                        '& .MuiDrawer-paper': {
                            width: drawerWidth,
                            boxSizing: 'border-box',
                        },
                    }}
                    variant="persistent"
                    anchor="right"
                    open={isPanelOpen}
                >
                    <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="h6" gutterBottom component="div">
                            Marked Plots
                        </Typography>
                        <IconButton onClick={() => setIsPanelOpen(false)}>
                            <CloseIcon />
                        </IconButton>
                    </Box>
                    <TableContainer component={Paper}>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell>Plot Index</TableCell>
                                    <TableCell align="right">Actions</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {markedPlots.map((plot) => (
                                    <TableRow key={plot.plot_index}>
                                        <TableCell component="th" scope="row">
                                            {plot.plot_index}
                                        </TableCell>
                                        <TableCell align="right">
                                            <Button size="small" onClick={() => handleChangePlot(plot)}>
                                                Change
                                            </Button>
                                            <Button size="small" color="secondary" onClick={() => handleDeletePlot(plot.plot_index)}>
                                                Delete
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Drawer>
            </Box>
            <Dialog open={cropBoundaryDialogOpen} onClose={handleCancelCropBoundary}>
                <DialogTitle>Save Stitch Boundary</DialogTitle>
                <DialogContent>
                    <Typography>
                        Do you want to save this crop boundary for stitching?
                    </Typography>
                    {pendingCropMask && (
                        <Typography variant="caption" sx={{ mt: 1, display: 'block' }}>
                            Crop mask: [{pendingCropMask.join(', ')}] 
                        </Typography>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCancelCropBoundary}>Cancel</Button>
                    <Button onClick={handleConfirmCropBoundary} color="primary">
                        Confirm
                    </Button>
                </DialogActions>
            </Dialog>
            <Dialog open={stitchDirectionDialogOpen} onClose={() => {
                setStitchDirectionDialogOpen(false);
                setShiftAll(false);
            }} onKeyDown={(e) => {
                if (e.key === 'Enter' && stitchDirection) {
                    handleStitchDirectionSelection(stitchDirection);
                }
            }}>
                <DialogTitle>Select Plot Stitch Direction</DialogTitle>
                <DialogContent>
                    <Typography>Please select the direction of the plot stitching.</Typography>
                    <FormControl fullWidth sx={{ mt: 2 }}>
                        <InputLabel id="stitch-direction-label">Direction</InputLabel>
                        <Select
                            labelId="stitch-direction-label"
                            value={stitchDirection}
                            label="Direction"
                            onChange={(e) => setStitchDirection(e.target.value)}
                        >
                            <MenuItem value="Up">Up</MenuItem>
                            <MenuItem value="Down">Down</MenuItem>
                            <MenuItem value="Left">Left</MenuItem>
                            <MenuItem value="Right">Right</MenuItem>
                        </Select>
                    </FormControl>
                    {originalPlotIndex !== null && (
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={shiftAll}
                                    onChange={(e) => setShiftAll(e.target.checked)}
                                />
                            }
                            label="Shift All"
                            sx={{ mt: 2 }}
                        />
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => {
                        setStitchDirectionDialogOpen(false);
                        setShiftAll(false);
                    }}>Cancel</Button>
                    <Button onClick={() => handleStitchDirectionSelection(stitchDirection)} color="primary" disabled={!stitchDirection}>
                        Confirm
                    </Button>
                </DialogActions>
            </Dialog>
        </Dialog>
    );
};