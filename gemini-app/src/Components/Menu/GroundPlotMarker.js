import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
    FormControlLabel,
    Tooltip,
    TextField
} from '@mui/material';
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CloseIcon from "@mui/icons-material/Close";
import KeyboardArrowLeftIcon from '@mui/icons-material/KeyboardArrowLeft';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft';
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight';
import CropIcon from '@mui/icons-material/Crop';
import MapIcon from '@mui/icons-material/Map';
import ListAltIcon from '@mui/icons-material/ListAlt';
import PlayCircleFilledWhiteOutlinedIcon from '@mui/icons-material/PlayCircleFilledWhiteOutlined';
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import EditIcon from '@mui/icons-material/Edit';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenWithIcon from '@mui/icons-material/OpenWith';
import MoveDownIcon from '@mui/icons-material/MoveDown';
import PlaceIcon from '@mui/icons-material/Place';
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward';
import UndoIcon from '@mui/icons-material/Undo';
import AddIcon from '@mui/icons-material/Add';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { useDataState } from "../../DataContext";
import ReactMapGL, { Source, Layer } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const reactMapboxToken = process.env.REACT_APP_MAPBOX_TOKEN;

function useDebounce(value, delay) {
    const [debouncedValue, setDebouncedValue] = useState(value);
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);
        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);
    return debouncedValue;
}


const GpsPlot = ({ gpsData, currentPoint, viewState, onViewStateChange }) => {
    if (!gpsData || gpsData.length === 0) {
        console.log("No GPS data available.");
        return <Box sx={{ width: '100%', height: 400, border: '1px solid grey', p: 1, boxSizing: 'border-box' }}>No GPS data</Box>;
    }
    const validGpsData = gpsData.filter(p => typeof p.lon === 'number' && typeof p.lat === 'number' && !isNaN(p.lon) && !isNaN(p.lat));

    const subsampledGpsData = validGpsData.filter((point, index) => index % 10 === 0);

    const gpsPointsGeoJSON = {
        type: 'FeatureCollection',
        features: subsampledGpsData.map(point => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [point.lon, point.lat]
            }
        }))
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

    return (
        <Box sx={{ width: '100%', height: 500, position: 'relative' }}>
            <ReactMapGL
                {...viewState}
                onMove={evt => onViewStateChange(evt.viewState)}
                style={{width: '100%', height: '100%'}}
                mapStyle="mapbox://styles/mapbox/satellite-v9"
                mapboxAccessToken={reactMapboxToken}
            >
                <Source id="gps-points" type="geojson" data={gpsPointsGeoJSON}>
                    <Layer
                        id="points-layer"
                        type="circle"
                        paint={{
                            'circle-radius': 3,
                            'circle-color': '#007cbf',
                            'circle-stroke-width': 0,
                            'circle-opacity': 0.7
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
            </ReactMapGL>
            {currentPointMessage && (
                <Box sx={{
                    position: 'absolute',
                    bottom: 10,
                    left: 10,
                    right: 10,
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                    padding: 1,
                    borderRadius: 1,
                    textAlign: 'center'
                }}>
                    <Typography variant="caption" color="text.secondary">
                        {currentPointMessage}
                    </Typography>
                </Box>
            )}
        </Box>
    );
};


export const GroundPlotMarker = ({ open, obj, onClose, plotIndex: initialPlotIndex, onPlotIndexChange }) => {
    const [visualIndex, setVisualIndex] = useState(0); 
    const debouncedIndex = useDebounce(visualIndex, 50); // Reduced from 200ms to 50ms for better responsiveness
    const [imageIndex, setImageIndex] = useState(0); 
    const [displayedIndex, setDisplayedIndex] = useState(0);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [overlayStyle, setOverlayStyle] = useState({});

    const [imageList, setImageList] = useState([]);
    const [imageViewerLoading, setImageViewerLoading] = useState(false);

    // NEW: granular loading states + overall initial loading overlay
    const [initialLoading, setInitialLoading] = useState(false);
    const [gpsDataLoading, setGpsDataLoading] = useState(false);
    const [markedPlotsLoading, setMarkedPlotsLoading] = useState(false);
    const {flaskUrl} = useDataState();
    const [directory, setDirectory] = useState("");
    const [plotSelectionState, setPlotSelectionState] = useState('start');
    const imageRef = React.useRef(null);
    const [plotIndex, setPlotIndex] = useState(initialPlotIndex);
    const [stitchDirectionDialogOpen, setStitchDirectionDialogOpen] = useState(false);
    const [stitchDirection, setStitchDirection] = useState('');
    const [shiftAll, setShiftAll] = useState(false);
    const [currentStitchDirection, setCurrentStitchDirection] = useState('');
    const [shiftAllDialogOpen, setShiftAllDialogOpen] = useState(false);
    const [currentImagePlotIndex, setCurrentImagePlotIndex] = useState(null);
    const [currentPlotName, setCurrentPlotName] = useState(null);
    const [currentAccession, setCurrentAccession] = useState(null);
    const [startImageName, setStartImageName] = useState(null);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [isGpsPanelOpen, setIsGpsPanelOpen] = useState(false);
    const [markedPlots, setMarkedPlots] = useState([]);
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

    const preloadedImagesRef = useRef(new Map());
    const [gpsCache, setGpsCache] = useState(new Map());

    const [isEditingPlotIndex, setIsEditingPlotIndex] = useState(false);
    const [editingPlotIndexValue, setEditingPlotIndexValue] = useState('');

    const [gpsReference, setGpsReference] = useState(null);
    const [hasGpsShift, setHasGpsShift] = useState(false);
    const [gpsShiftOperation, setGpsShiftOperation] = useState(null);
    const [gpsOperationLoading, setGpsOperationLoading] = useState(false);

    const [plotMode, setPlotMode] = useState('mark'); 
    const [sortBy, setSortBy] = useState('plot_index'); 
    const [sortOrder, setSortOrder] = useState('asc'); 

    const imageContainerRef = React.useRef(null);

    const theme = useTheme();
    const drawerWidth = 400;
    const gpsDrawerWidth = 400;

    const calculateOverlayStyle = useCallback(() => {
        const container = imageContainerRef.current;
        const img = imageRef.current;
        if (img && container && img.naturalWidth > 0) {
            const containerWidth = container.offsetWidth;
            const containerHeight = container.offsetHeight;
            const imageRatio = img.naturalWidth / img.naturalHeight;
            const containerRatio = containerWidth / containerHeight;
    
            let newStyle = {};
            if (imageRatio > containerRatio) {
                const renderedHeight = containerWidth / imageRatio;
                newStyle = {
                    width: `${containerWidth}px`,
                    height: `${renderedHeight}px`,
                    top: `${(containerHeight - renderedHeight) / 2}px`,
                    left: '0px',
                };
            } else {
                const renderedWidth = containerHeight * imageRatio;
                newStyle = {
                    width: `${renderedWidth}px`,
                    height: `${containerHeight}px`,
                    top: '0px',
                    left: `${(containerWidth - renderedWidth) / 2}px`,
                };
            }
            setOverlayStyle(newStyle);
        }
    }, []);

    useEffect(() => {
        const container = imageContainerRef.current;
        if (!container) return;

        const observer = new ResizeObserver(() => {
            calculateOverlayStyle();
        });
        observer.observe(container);

        return () => observer.disconnect();
    }, [calculateOverlayStyle]);
    
    const handleVisibleImageLoad = () => {
        calculateOverlayStyle();
    };

    useEffect(() => {
        setImageIndex(debouncedIndex);
    }, [debouncedIndex]);

    useEffect(() => {
        if (imageIndex !== displayedIndex) {
            setIsTransitioning(true);
        }
    }, [imageIndex, displayedIndex]);

    const handleNewImageLoad = () => {
        setDisplayedIndex(imageIndex);
        setIsTransitioning(false);
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
            console.log("DEBUG: get_plot_data response:", data);
            
            if (response.ok) {
                const sortedPlots = data.sort((a, b) => a.plot_index - b.plot_index);
                
                const enhancedPlots = await Promise.all(sortedPlots.map(async (plot) => {
                    try {
                        const imageName = plot.image_name ? plot.image_name.split('/').pop() : null;
                        if (!imageName) {
                            return plot;
                        }
                        
                        const plotResponse = await fetch(`${flaskUrl}get_image_plot_index`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                directory: directory,
                                image_name: imageName,
                            }),
                        });
                        const plotData = await plotResponse.json();
                        if (plotResponse.ok) {
                            return {
                                ...plot,
                                plot_name: plotData.plot_name,
                                accession: plotData.accession
                            };
                        } else {
                            return plot;
                        }
                    } catch (error) {
                        console.error("Error fetching plot metadata for plot", plot.plot_index, ":", error);
                    }
                    return plot;
                }));
                
                setMarkedPlots(enhancedPlots);
            } else {
                console.error("Failed to fetch marked plots:", data.error || data);
                setMarkedPlots([]);
            }
        } catch (error) {
            console.error("Error fetching marked plots:", error);
            setMarkedPlots([]);
        }
    };

    const sortMarkedPlots = (plots, sortBy, sortOrder) => {
        return [...plots].sort((a, b) => {
            let aValue, bValue;
            
            switch (sortBy) {
                case 'plot_index':
                    aValue = a.plot_index;
                    bValue = b.plot_index;
                    break;
                case 'plot_name':
                    aValue = a.plot_name || '';
                    bValue = b.plot_name || '';
                    break;
                case 'accession':
                    aValue = a.accession || '';
                    bValue = b.accession || '';
                    break;
                default:
                    aValue = a.plot_index;
                    bValue = b.plot_index;
            }
            
            if (sortBy === 'plot_name') {
                const aStr = aValue.toString();
                const bStr = bValue.toString();
                if (aStr === '' && bStr !== '') return 1;
                if (bStr === '' && aStr !== '') return -1;
                if (aStr === '' && bStr === '') return 0;
                const aHasUnderscore = aStr.includes('_');
                const bHasUnderscore = bStr.includes('_');
                if (aHasUnderscore && !bHasUnderscore) return 1;
                if (bHasUnderscore && !aHasUnderscore) return -1;
                const comparison = aStr.localeCompare(bStr);
                return sortOrder === 'asc' ? comparison : -comparison;
            }
            if (sortBy === 'accession') {
                const aStr = aValue.toString();
                const bStr = bValue.toString();
                if (aStr === '' && bStr !== '') return 1;
                if (bStr === '' && aStr !== '') return -1;
                if (aStr === '' && bStr === '') return 0;
                const comparison = aStr.localeCompare(bStr);
                return sortOrder === 'asc' ? comparison : -comparison;
            }
            if (sortBy === 'plot_index') {
                return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
            } else {
                const comparison = aValue.toString().localeCompare(bValue.toString());
                return sortOrder === 'asc' ? comparison : -comparison;
            }
        });
    };
    const sortedMarkedPlots = sortMarkedPlots(markedPlots, sortBy, sortOrder);
    const handleSortChange = (newSortBy) => {
        if (newSortBy === sortBy) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(newSortBy);
            setSortOrder('asc');
        }
    };

    useEffect(() => {
        if (open && obj) {
            let newDirectory = "";
            if(obj.platform === 'Amiga' || obj.platform === 'rover') {
                newDirectory = `Raw/${obj.year}/${obj.experiment}/${obj.location}/${obj.population}/${obj.date}/${obj.platform}/RGB/Images/${obj.camera}/`;
            } else {
                newDirectory = `Raw/${obj.year}/${obj.experiment}/${obj.location}/${obj.population}/${obj.date}/${obj.platform}/${obj.sensor}/Images/`;
            }
            setDirectory(newDirectory);
        }
    }, [open, obj]);

    useEffect(() => {
        if (open) {
            setPlotIndex(initialPlotIndex);
        }
    }, [open, initialPlotIndex]);

    useEffect(() => {
        if (open && directory) {
            fetchMarkedPlots();
        }
    }, [open, directory]);

    useEffect(() => {
        if (directory) {
            setVisualIndex(0);
            setImageIndex(0);
            setDisplayedIndex(0);
            setPlotIndex(initialPlotIndex);
            fetchImages();
            fetchMarkedPlots();
            fetchGpsData();
            fetchStitchDirection();
            fetchGpsReference();
            checkGpsShiftStatus();
        }
    }, [directory]);


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

    const fetchStitchDirection = async () => {
        if (!directory) return;
        try {
            const response = await fetch(`${flaskUrl}get_stitch_direction`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ directory }),
            });
            const data = await response.json();
            if (response.ok && data.stitch_direction) {
                setCurrentStitchDirection(data.stitch_direction);
                setStitchDirection(data.stitch_direction);
            }
        } catch (error) {
            console.error("Error fetching stitch direction:", error);
        }
    };

    const fetchGpsReference = async () => {
        if (!directory) return;
        try {
            const response = await fetch(`${flaskUrl}get_gps_reference`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ directory }),
            });
            const data = await response.json();
            if (response.ok) {
                if (data.reference_lat !== null && data.reference_lon !== null) {
                    setGpsReference({ lat: data.reference_lat, lon: data.reference_lon });
                } else {
                    setGpsReference(null);
                }
            }
        } catch (error) {
            console.error("Error fetching GPS reference:", error);
        }
    };

    const checkGpsShiftStatus = async () => {
        if (!directory) return;
        try {
            const response = await fetch(`${flaskUrl}check_gps_shift_status`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ directory }),
            });
            
            const data = await response.json();
            if (response.ok) {
                setHasGpsShift(data.has_shift);
                setGpsShiftOperation(data.shift_applied);
                console.log(`GPS shift status: ${data.has_shift ? 'Applied' : 'None'}`);
            }
        } catch (error) {
            console.error("Error checking GPS shift status:", error);
            setHasGpsShift(false);
            setGpsShiftOperation(null);
        }
    };

    const handleMarkGpsReference = async () => {
        if (!currentLatLon) {
            console.error("No current GPS coordinates available");
            return;
        }

        try {
            const response = await fetch(`${flaskUrl}set_gps_reference`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    directory: directory,
                    lat: currentLatLon.lat,
                    lon: currentLatLon.lon
                }),
            });

            if (response.ok) {
                setGpsReference({ lat: currentLatLon.lat, lon: currentLatLon.lon });
                console.log(`GPS reference set to: ${currentLatLon.lat}, ${currentLatLon.lon}`);
            } else {
                console.error("Failed to set GPS reference");
            }
        } catch (error) {
            console.error("Error setting GPS reference:", error);
        }
    };

    const handleShiftGps = async () => {
        if (!currentLatLon || !gpsReference) {
            console.error("Missing current coordinates or GPS reference");
            return;
        }

        setGpsOperationLoading(true);
        try {
            const response = await fetch(`${flaskUrl}shift_gps`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    directory: directory,
                    current_lat: currentLatLon.lat,
                    current_lon: currentLatLon.lon
                }),
            });

            const data = await response.json();
            if (response.ok) {
                setHasGpsShift(true);
                setGpsShiftOperation(data.shift_applied);
                setGpsCache(new Map());
                await handleRefilterPlots();
                
            } else {
                console.error("Failed to shift GPS:", data.error);
            }
        } catch (error) {
            console.error("Error shifting GPS:", error);
        } finally {
            setGpsOperationLoading(false);
        }
    };

    const handleUndoGpsShift = async () => {
        setGpsOperationLoading(true);
        try {
            const response = await fetch(`${flaskUrl}undo_gps_shift`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ directory: directory }),
            });

            const data = await response.json();
            if (response.ok) {
                setHasGpsShift(false);
                setGpsShiftOperation(null);
                setGpsCache(new Map());
                await handleRefilterPlots();
                
            } else {
                console.error("Failed to undo GPS shift:", data.error);
            }
        } catch (error) {
            console.error("Error undoing GPS shift:", error);
        } finally {
            setGpsOperationLoading(false);
        }
    };

    const handleRefilterPlots = async () => {
        setGpsOperationLoading(true);
        try {
            // Call filter_plot_borders endpoint first, similar to TableComponent
            if (obj) {
                try {
                    const filterResponse = await fetch(`${flaskUrl}filter_plot_borders`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            year: obj.year,
                            experiment: obj.experiment,
                            location: obj.location,
                            population: obj.population,
                            date: obj.date,
                        }),
                    });
                    if (!filterResponse.ok) {
                        const errorData = await filterResponse.json().catch(() => null);
                        console.warn('Could not filter plot borders during refilter.', errorData?.error);
                    }
                } catch (error) {
                    console.error("Error filtering plot borders during refilter:", error);
                }
            }

            setGpsCache(new Map());
            await fetchGpsData();
            await fetchMarkedPlots();
            await fetchImagePlotIndex();
            if (isGpsPanelOpen && currentLatLon) {
                setViewState(prev => ({
                    ...prev,
                    longitude: currentLatLon.lon,
                    latitude: currentLatLon.lat,
                    zoom: 20
                }));
            }
        } catch (error) {
            console.error("Error refiltering plots:", error);
        } finally {
            setGpsOperationLoading(false);
        }
    };
    
    useEffect(() => {
        if (imageList.length > 0 && directory) {
            fetchImagePlotIndex();
        }
    }, [imageIndex, imageList, directory]);
    useEffect(() => {
        if (imageList.length > 0 && directory) {
            const timeoutId = setTimeout(() => {
                prefetchPlotData();
            }, 100);
            return () => clearTimeout(timeoutId);
        }
    }, [imageIndex, imageList, directory]);

    const API_ENDPOINT = `${flaskUrl}files`;

    const fetchImagePlotIndex = async () => {
        const imageName = imageList[imageIndex];
        if (!imageName) return;

        const cacheKey = `${directory}${imageName}`;
        if (gpsCache.has(cacheKey)) {
            const cached = gpsCache.get(cacheKey);
            setCurrentImagePlotIndex(cached.plot_index);
            setCurrentLatLon(cached.latLon);
            setCurrentPlotName(cached.plot_name);
            setCurrentAccession(cached.accession);
            return;
        }

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
                const result = {
                    plot_index: data.plot_index,
                    latLon: (data.lat !== null && data.lon !== null) ? { lat: data.lat, lon: data.lon } : null,
                    plot_name: data.plot_name,
                    accession: data.accession
                };

                setGpsCache(prev => {
                    const newCache = new Map(prev);
                    newCache.set(cacheKey, result);
                    if (newCache.size > 50) {
                        const entries = Array.from(newCache.entries());
                        const limitedEntries = entries.slice(-50);
                        return new Map(limitedEntries);
                    }
                    
                    return newCache;
                });

                setCurrentImagePlotIndex(result.plot_index);
                setCurrentLatLon(result.latLon);
                setCurrentPlotName(result.plot_name);
                setCurrentAccession(result.accession);
            } else {
                console.error("Failed to fetch plot index:", response.status, data);
                setCurrentImagePlotIndex(null);
                setCurrentLatLon(null);
                setCurrentPlotName(null);
                setCurrentAccession(null);
            }
        } catch (error) {
            console.error("Error fetching plot index for image", imageName, ":", error);
            setCurrentImagePlotIndex(null);
            setCurrentLatLon(null);
            setCurrentPlotName(null);
            setCurrentAccession(null);
        }
    };

    const prefetchPlotData = async () => {
        if (!imageList.length || !directory) return;

        const indicesToPrefetch = new Set();
        const maxIndex = imageList.length - 1;
        for (let i = 1; i <= 3; i++) {
            const prevIndex = imageIndex - i;
            const nextIndex = imageIndex + i;
            if (prevIndex >= 0) indicesToPrefetch.add(prevIndex);
            if (nextIndex <= maxIndex) indicesToPrefetch.add(nextIndex);
        }
        const jumpNext = imageIndex + 10;
        const jumpPrev = imageIndex - 10;
        if (jumpNext <= maxIndex) indicesToPrefetch.add(jumpNext);
        if (jumpPrev >= 0) indicesToPrefetch.add(jumpPrev);
        window.requestIdleCallback(() => {
            indicesToPrefetch.forEach(async (index) => {
                const imageName = imageList[index];
                if (!imageName) return;

                const cacheKey = `${directory}${imageName}`;
                if (gpsCache.has(cacheKey)) return; // Already cached

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
                        const result = {
                            plot_index: data.plot_index,
                            latLon: (data.lat !== null && data.lon !== null) ? { lat: data.lat, lon: data.lon } : null,
                            plot_name: data.plot_name,
                            accession: data.accession
                        };

                        setGpsCache(prev => {
                            const newCache = new Map(prev);
                            newCache.set(cacheKey, result);
                            if (newCache.size > 50) {
                                const entries = Array.from(newCache.entries());
                                const limitedEntries = entries.slice(-50);
                                return new Map(limitedEntries);
                            }
                            
                            return newCache;
                        });
                    }
                } catch (error) {
                    // Silently fail for prefetch to avoid console spam
                }
            });
        });
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

    const handleRefreshPlotIndex = async () => {
        const maxPlotIndex = await fetchMaxPlotIndex();
        const nextPlotIndex = maxPlotIndex + 1;
        setPlotIndex(nextPlotIndex);
        onPlotIndexChange(nextPlotIndex);
    };

    const handlePlotIndexEdit = () => {
        setIsEditingPlotIndex(true);
        if (plotMode === 'mark') {
            setEditingPlotIndexValue(plotIndex.toString());
        } else {
            setEditingPlotIndexValue(currentImagePlotIndex !== null ? currentImagePlotIndex.toString() : '');
        }
    };

    const handlePlotIndexSave = () => {
        const newValue = parseInt(editingPlotIndexValue, 10);
        if (!isNaN(newValue) && newValue >= 0) {
            if (plotMode === 'mark') {
                setPlotIndex(newValue);
                onPlotIndexChange(newValue);
            } else if (plotMode === 'view') {
                const targetPlot = markedPlots.find(plot => plot.plot_index === newValue);
                if (targetPlot) {
                    handleJumpToPlot(targetPlot);
                }
            }
        }
        setIsEditingPlotIndex(false);
        setEditingPlotIndexValue('');
    };

    const handlePlotIndexCancel = () => {
        setIsEditingPlotIndex(false);
        setEditingPlotIndexValue('');
    };

    const handlePlotModeToggle = () => {
        setPlotMode(plotMode === 'mark' ? 'view' : 'mark');
    };

    const handlePlotIndexKeyPress = (e) => {
        if (e.key === 'Enter') {
            handlePlotIndexSave();
        } else if (e.key === 'Escape') {
            handlePlotIndexCancel();
        }
    };

    useEffect(() => {
        if (!imageList.length || !directory) return;
    
        const handle = window.requestIdleCallback(() => {
            const indicesToPreload = new Set();
            const maxIndex = imageList.length - 1;
    
            for (let i = 1; i <= 3; i++) {
                const prevIndex = imageIndex - i;
                const nextIndex = imageIndex + i;
                if (prevIndex >= 0) indicesToPreload.add(prevIndex);
                if (nextIndex <= maxIndex) indicesToPreload.add(nextIndex);
            }
    
            for (let i = 1; i <= 3; i++) {
                const jumpIndex = imageIndex + i * 10;
                if (jumpIndex <= maxIndex) {
                    indicesToPreload.add(jumpIndex);
                } else {
                    break; 
                }
            }
    
            for (let i = 1; i <= 3; i++) {
                const jumpIndex = imageIndex - i * 10;
                if (jumpIndex >= 0) {
                    indicesToPreload.add(jumpIndex);
                } else {
                    break;
                }
            }
    
            for (const index of indicesToPreload) {
                if (index === imageIndex) continue; 
    
                const imageName = imageList[index];
                const imageUrl = `${API_ENDPOINT}/${directory}${imageName}`;
                
                if (!preloadedImagesRef.current.has(imageUrl)) {
                    preloadedImagesRef.current.set(imageUrl, true);
                    const img = new Image();
                    img.src = imageUrl;
                }
            }
        });
    
        return () => window.cancelIdleCallback(handle);
    
    }, [imageIndex, imageList, directory, API_ENDPOINT]);


    const handlePrevious = () => {
        if (visualIndex > 0) {
            const newIndex = visualIndex - 1;
            setVisualIndex(newIndex);
            setImageIndex(newIndex);
        }
    };

    const handleNext = () => {
        if (visualIndex < imageList.length - 1) {
            const newIndex = visualIndex + 1;
            setVisualIndex(newIndex);
            setImageIndex(newIndex);
        }
    };

    const handleJumpBack = () => {
        const newIndex = Math.max(0, visualIndex - 10);
        setVisualIndex(newIndex);
        setImageIndex(newIndex);
    };

    const handleJumpForward = () => {
        const newIndex = Math.min(imageList.length - 1, visualIndex + 10);
        setVisualIndex(newIndex);
        setImageIndex(newIndex);
    };

    const handleBackButton = () => {
        onClose();
    };

    const handleCancel = () => {
        setPlotSelectionState('start');
        setStartImageName(null);
    };

    const handlePlotSelection = async () => {
        const currentIndex = visualIndex;
        if (currentIndex !== imageIndex) {
            setImageIndex(currentIndex);
        }
        
        const imageName = imageList[currentIndex];
        if (plotSelectionState === 'start') {
            setStartImageName(imageName);
            setPlotSelectionState('end');
        }
    };

    const handleStitchDirectionSelection = async (direction) => {
        const currentIndex = visualIndex;
        if (currentIndex !== imageIndex) {
            setImageIndex(currentIndex);
        }
        
        const endImageName = imageList[currentIndex];
        let shiftAmount = 0;
        let originalStartImageIndex = null;

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
                    shift_all: shiftAll,
                    shift_amount: shiftAmount,
                    original_start_image_index: originalStartImageIndex
                }),
            });

            if (response.ok) {
                fetchMarkedPlots();
                setCurrentStitchDirection(direction);
                setGpsCache(new Map());
                const nextPlotIndex = plotIndex + 1;
                setPlotIndex(nextPlotIndex);
                onPlotIndexChange(nextPlotIndex);
                
                setPlotSelectionState('start');
                setStartImageName(null);
                setShiftAll(false);
            } else {
                console.error("Failed to mark plot end with stitch direction");
            }
        } catch (error) {
            console.error("Error marking plot end:", error);
        }
        setStitchDirectionDialogOpen(false);
        setShiftAllDialogOpen(false);
    };

    const handleMarkPlotEnd = () => {
        if (markedPlots.length === 0 || !currentStitchDirection) {
            setStitchDirectionDialogOpen(true);
        } else {
            handleStitchDirectionSelection(currentStitchDirection);
        }
    };

    const handleStitchDirectionButtonClick = () => {
        setStitchDirectionDialogOpen(true);
    };

    const handleDeletePlot = async (plotIndexToDelete) => {
        try {
            const response = await fetch(`${flaskUrl}delete_plot`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ directory, plot_index: plotIndexToDelete }),
            });
            if (response.ok) {
                fetchMarkedPlots();
                setGpsCache(new Map());
            } else {
                console.error("Failed to delete plot");
            }
        } catch (error) {
            console.error("Error deleting plot:", error);
        }
    };

    const handleChangePlot = (plot) => {
        const image = plot.image_name.split("/").pop();
        const imageIdx = imageList.findIndex(img => img === image);
        if (imageIdx !== -1) {
            setPlotIndex(plot.plot_index);
            setVisualIndex(imageIdx);
            setPlotSelectionState('start');
        } else {
            console.error("Start image for the plot not found in the image list.");
        }
    };

    const handleJumpToPlot = (plot) => {
        const image = plot.image_name.split("/").pop();
        const imageIdx = imageList.findIndex(img => img === image);
        if (imageIdx !== -1) {
            setVisualIndex(imageIdx);
            setIsPanelOpen(false);
        } else {
            console.error("Start image for the plot not found in the image list.");
        }
    };

    const getImageContainerBounds = () => {
        if (!imageContainerRef.current) return null;
        return imageContainerRef.current.getBoundingClientRect();
    };

    const getImageBounds = () => {
        if (!imageRef.current || !imageContainerRef.current) return null;
        
        const containerBounds = imageContainerRef.current.getBoundingClientRect();
        const img = imageRef.current;
        
        const imgRect = img.getBoundingClientRect();
        
        const scaleX = img.naturalWidth / imgRect.width;
        const scaleY = img.naturalHeight / imgRect.height;
        
        return {
            left: imgRect.left - containerBounds.left,
            top: imgRect.top - containerBounds.top,
            width: imgRect.width,
            height: imgRect.height,
            scaleX,
            scaleY,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight
        };
    };

    const handleCropButtonClick = () => {
        if (!cropMode) {
            const imgBounds = getImageBounds();
            if (imgBounds) {
                const size = Math.min(imgBounds.width, imgBounds.height) * 0.3;
                setCropBox({
                    x: imgBounds.left + (imgBounds.width - size) / 2,
                    y: imgBounds.top + (imgBounds.height - size) / 2,
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
        const imgBounds = getImageBounds();
    
        if (!bounds || !imgBounds) return;
    
        const x = e.clientX - bounds.left;
        const y = e.clientY - bounds.top;
        const deltaX = x - dragStart.x;
        const deltaY = y - dragStart.y;
    
        if (isDragging) {
            setCropBox({
                x: Math.max(imgBounds.left, Math.min(imgBounds.left + imgBounds.width - dragStart.cropBox.width, dragStart.cropBox.x + deltaX)),
                y: Math.max(imgBounds.top, Math.min(imgBounds.top + imgBounds.height - dragStart.cropBox.height, dragStart.cropBox.y + deltaY)),
                width: dragStart.cropBox.width,
                height: dragStart.cropBox.height
            });
        } else if (isResizing && resizeHandle) {
            let newBox = { ...dragStart.cropBox };
    
            let finalX = newBox.x;
            let finalY = newBox.y;
            let finalWidth = newBox.width;
            let finalHeight = newBox.height;
    
            if (resizeHandle.includes('e')) {
                finalWidth = Math.max(20, dragStart.cropBox.width + deltaX);
            }
            if (resizeHandle.includes('w')) {
                finalWidth = Math.max(20, dragStart.cropBox.width - deltaX);
                finalX = dragStart.cropBox.x + deltaX;
            }
            if (resizeHandle.includes('s')) {
                finalHeight = Math.max(20, dragStart.cropBox.height + deltaY);
            }
            if (resizeHandle.includes('n')) {
                finalHeight = Math.max(20, dragStart.cropBox.height - deltaY);
                finalY = dragStart.cropBox.y + deltaY;
            }
    
            // Constrain to image boundaries
            if (finalX < imgBounds.left) {
                finalWidth += finalX - imgBounds.left;
                finalX = imgBounds.left;
            }
            if (finalY < imgBounds.top) {
                finalHeight += finalY - imgBounds.top;
                finalY = imgBounds.top;
            }
            if (finalX + finalWidth > imgBounds.left + imgBounds.width) {
                finalWidth = imgBounds.left + imgBounds.width - finalX;
            }
            if (finalY + finalHeight > imgBounds.top + imgBounds.height) {
                finalHeight = imgBounds.top + imgBounds.height - finalY;
            }
    
            setCropBox({ x: finalX, y: finalY, width: Math.max(20, finalWidth), height: Math.max(20, finalHeight) });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
        setIsResizing(false);
        setDragStart(null);
        setResizeHandle(null);
    };

    const handleConfirmCrop = () => {
        const imgBounds = getImageBounds();
        if (!cropBox || !imgBounds) return;
    
        const scaleX = imgBounds.naturalWidth / imgBounds.width;
        const scaleY = imgBounds.naturalHeight / imgBounds.height;
    
        const imageLeft = imgBounds.left;
        const imageTop = imgBounds.top;
    
        const cropLeftOnImage = (cropBox.x - imageLeft) * scaleX;
        const cropTopOnImage = (cropBox.y - imageTop) * scaleY;
        const cropRightOnImage = (cropBox.x + cropBox.width - imageLeft) * scaleX;
        const cropBottomOnImage = (cropBox.y + cropBox.height - imageTop) * scaleY;
    
        const leftMask = Math.max(0, Math.round(cropLeftOnImage));
        const rightMask = Math.max(0, Math.round(imgBounds.naturalWidth - cropRightOnImage));
        const topMask = Math.max(0, Math.round(cropTopOnImage));
        const bottomMask = Math.max(0, Math.round(imgBounds.naturalHeight - cropBottomOnImage));
    
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
            } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
                handleJumpForward();
            } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
                handleJumpBack();
            } else if (e.key === 'Enter') {
                if (plotMode !== 'view') {
                    if (plotSelectionState === 'start') {
                        handlePlotSelection();
                    } else {
                        handleMarkPlotEnd();
                    }
                }
            } else if (e.key === 'Escape') {
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
    }, [open, visualIndex, imageList.length, plotSelectionState, cropMode, plotMode]);

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
                        <Tooltip title="Close GPS Panel" arrow>
                            <IconButton onClick={() => setIsGpsPanelOpen(false)}>
                                <CloseIcon />
                            </IconButton>
                        </Tooltip>
                    </Box>
                    <Box sx={{ px: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                         {gpsData.length > 0 &&
                            <GpsPlot
                                gpsData={gpsData}
                                currentPoint={currentLatLon}
                                viewState={viewState}
                                onViewStateChange={setViewState}
                            />
                        }
                        {currentLatLon && (
                            <>
                                <Typography variant="caption" display="block" sx={{ mt: 1, textAlign: 'center' }}>
                                    Lat: {currentLatLon.lat.toFixed(6)}<br/>
                                    Lon: {currentLatLon.lon.toFixed(6)}
                                </Typography>
                                
                                <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1, width: '100%' }}>
                                    <Button
                                        variant="outlined"
                                        size="small"
                                        startIcon={<PlaceIcon />}
                                        onClick={handleMarkGpsReference}
                                        disabled={gpsOperationLoading}
                                        fullWidth
                                    >
                                        Mark as GPS Reference
                                    </Button>
                                    
                                    {gpsReference && (
                                        <Typography variant="caption" display="block" sx={{ textAlign: 'center', color: 'text.secondary' }}>
                                            Reference: {gpsReference.lat.toFixed(6)}, {gpsReference.lon.toFixed(6)}
                                        </Typography>
                                    )}
                                    
                                    <Button
                                        variant="contained"
                                        size="small"
                                        startIcon={gpsOperationLoading ? <CircularProgress size={16} /> : <ArrowOutwardIcon />}
                                        onClick={handleShiftGps}
                                        disabled={!gpsReference || gpsOperationLoading}
                                        fullWidth
                                    >
                                        {gpsOperationLoading ? 'Applying Shift...' : 'Shift GPS'}
                                    </Button>
                                    
                                    <Tooltip 
                                        title="Re-filter and update plot boundaries based on current GPS coordinates. Use after applying GPS shifts to update plot locations."
                                        placement="bottom"
                                    >
                                        <span>
                                            <Button
                                                variant="outlined"
                                                size="small"
                                                startIcon={gpsOperationLoading ? <CircularProgress size={16} /> : <RefreshIcon />}
                                                onClick={handleRefilterPlots}
                                                disabled={gpsOperationLoading}
                                                fullWidth
                                                color="primary"
                                            >
                                                {gpsOperationLoading ? 'Updating...' : 'Re-filter Plots'}
                                            </Button>
                                        </span>
                                    </Tooltip>
                                    
                                    {hasGpsShift && (
                                        <>
                                            <Typography variant="caption" display="block" sx={{ textAlign: 'center', color: 'warning.main' }}>
                                                GPS shift applied
                                                {gpsShiftOperation && (
                                                    <>
                                                        <br/>Δ Lat: {gpsShiftOperation.lat_shift.toFixed(6)}
                                                        <br/>Δ Lon: {gpsShiftOperation.lon_shift.toFixed(6)}
                                                    </>
                                                )}
                                            </Typography>
                                            <Button
                                                variant="outlined"
                                                size="small"
                                                startIcon={gpsOperationLoading ? <CircularProgress size={16} /> : <UndoIcon />}
                                                onClick={handleUndoGpsShift}
                                                disabled={gpsOperationLoading}
                                                fullWidth
                                                color="warning"
                                            >
                                                {gpsOperationLoading ? 'Undoing...' : 'Undo Shift'}
                                            </Button>
                                        </>
                                    )}
                                </Box>
                            </>
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
                        <Tooltip title="Go Back" arrow>
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
                        </Tooltip>

                        <Tooltip title="View GPS Data" arrow>
                            <IconButton
                                onClick={() => setIsGpsPanelOpen(true)}
                                style={{
                                    position: "absolute",
                                    top: "60px",
                                    left: "10px",
                                    zIndex: 10,
                                    width: '40px',
                                    height: '40px',
                                    backgroundColor: '#3874cb',
                                }}
                                size="large"
                            >
                                <MapIcon style={{ color: "white", fontSize: '2rem' }} />
                            </IconButton>
                        </Tooltip>

                        <Box sx={{
                            position: 'absolute',
                            top: '10px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            zIndex: 10,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            backgroundColor: 'rgba(255, 255, 255, 0.9)',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                            marginLeft: `calc(${isGpsPanelOpen ? `${gpsDrawerWidth / 2}px` : '0px'} - ${isPanelOpen ? `${drawerWidth / 2}px` : '0px'})`,
                            transition: theme.transitions.create(['margin-left'], {
                                easing: theme.transitions.easing.sharp,
                                duration: theme.transitions.duration.enteringScreen,
                            })
                        }}>

                            <Typography variant="h6" sx={{ margin: 0, whiteSpace: 'nowrap' }}>
                                {plotMode === 'mark' ? 'Marking Plot Index:' : 'Viewing Plot:'}
                            </Typography>
                            {isEditingPlotIndex ? (
                                <TextField
                                    value={editingPlotIndexValue}
                                    onChange={(e) => setEditingPlotIndexValue(e.target.value)}
                                    onKeyDown={handlePlotIndexKeyPress}
                                    onBlur={handlePlotIndexSave}
                                    type="number"
                                    size="small"
                                    autoFocus
                                    sx={{
                                        width: '80px',
                                        '& .MuiInputBase-root': {
                                            height: '32px',
                                            fontSize: '1.25rem',
                                            fontWeight: 'bold'
                                        }
                                    }}
                                />
                            ) : (
                                <Tooltip title={plotMode === 'mark' ? "Click to edit plot index" : "Click to jump to plot"} arrow>
                                    <Typography
                                        variant="h6"
                                        onClick={handlePlotIndexEdit}
                                        sx={{
                                            margin: 0,
                                            cursor: 'pointer',
                                            padding: '4px 8px',
                                            borderRadius: '4px',
                                            backgroundColor: 'primary.main',
                                            color: 'white',
                                            fontWeight: 'bold',
                                            '&:hover': {
                                                backgroundColor: 'primary.dark'
                                            }
                                        }}
                                    >
                                        {plotMode === 'mark' ? plotIndex : (currentImagePlotIndex !== null && currentImagePlotIndex !== -1 ? currentImagePlotIndex : 'N/A')}
                                    </Typography>
                                </Tooltip>
                            )}
                            
                            <Tooltip title={plotMode === 'mark' ? "View Plots" : "Mark Plots"} arrow>
                                <IconButton
                                    onClick={handlePlotModeToggle}
                                    size="small"
                                    sx={{
                                        backgroundColor: 'success.main',
                                        color: 'white',
                                        width: '32px',
                                        height: '32px',
                                        '&:hover': {
                                            backgroundColor: 'success.dark'
                                        }
                                    }}
                                >
                                    {plotMode === 'mark' ? <VisibilityIcon fontSize="small" /> : <AddIcon fontSize="small" />}
                                </IconButton>
                            </Tooltip>
                            
                            {plotMode === 'mark' && (
                                <Tooltip title="Refresh to next available plot index" arrow>
                                    <IconButton
                                        onClick={handleRefreshPlotIndex}
                                        size="small"
                                        sx={{
                                            backgroundColor: 'secondary.main',
                                            color: 'white',
                                            width: '32px',
                                            height: '32px',
                                            '&:hover': {
                                                backgroundColor: 'secondary.dark'
                                            }
                                        }}
                                    >
                                        <RefreshIcon fontSize="small" />
                                    </IconButton>
                                </Tooltip>
                            )}
                        </Box>

                        <Tooltip title="View Marked Plots" arrow>
                            <IconButton
                                onClick={() => setIsPanelOpen(true)}
                                style={{
                                    position: "absolute",
                                    top: "60px",
                                    right: "10px",
                                    zIndex: 10,
                                    width: '40px',
                                    height: '40px',
                                    backgroundColor: '#3874cb',
                                }}
                                size="large"
                            >
                                <ListAltIcon style={{ color: "white", fontSize: '2rem' }} />
                            </IconButton>
                        </Tooltip>
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
                                    <>
                                        <img
                                            ref={imageRef}
                                            src={`${API_ENDPOINT}/${directory}${imageList[displayedIndex]}`}
                                            alt={`Image ${displayedIndex + 1}`}
                                            onLoad={handleVisibleImageLoad}
                                            style={{
                                                position: 'absolute',
                                                width: `100%`,
                                                height: `100%`,
                                                objectFit: "contain",
                                                pointerEvents: 'none'
                                            }}
                                        />
                                        {isTransitioning && (
                                            <img
                                                src={`${API_ENDPOINT}/${directory}${imageList[imageIndex]}`}
                                                onLoad={handleNewImageLoad}
                                                style={{ display: 'none' }}
                                                alt="Preloading"
                                            />
                                        )}
                                    </>
                                )}

                                {(currentImagePlotIndex !== null && currentImagePlotIndex !== -1) && overlayStyle.width && (
                                    <Box sx={{
                                        position: 'absolute',
                                        bottom: `calc(${overlayStyle.top || '0px'} + 10px)`,
                                        left: `calc(${overlayStyle.left || '0px'} + 10px)`,
                                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                                        color: 'white',
                                        padding: '10px 14px',
                                        borderRadius: '6px',
                                        fontSize: '0.875rem',
                                        fontWeight: 'bold',
                                        zIndex: 15,
                                        boxShadow: '0 3px 6px rgba(0,0,0,0.4)',
                                        backdropFilter: 'blur(4px)',
                                        border: '1px solid rgba(255, 255, 255, 0.2)'
                                    }}>
                                        <div>Plot Index: {currentImagePlotIndex}</div>
                                        {currentPlotName && (
                                            <div>Plot: {currentPlotName}</div>
                                        )}
                                        {currentAccession && (
                                            <div>Accession: {currentAccession}</div>
                                        )}
                                    </Box>
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
                                
                                {isTransitioning && (
                                    <Box sx={{
                                        position: 'absolute',
                                        backgroundColor: 'rgba(0, 0, 0, 0.4)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        borderRadius: '4px',
                                        pointerEvents: 'none',
                                        ...overlayStyle
                                    }}>
                                        <CircularProgress color="inherit" sx={{color: 'white'}}/>
                                    </Box>
                                )}

                                <Tooltip title={cropMode ? "Exit Crop Mode" : "Enter Crop Mode"} arrow>
                                    <IconButton
                                        onClick={handleCropButtonClick}
                                        sx={{
                                            position: 'absolute',
                                            top: 10,
                                            right: 'calc(50% + 20px)',
                                            zIndex: 20,
                                            width: '40px',
                                            height: '40px',
                                            backgroundColor: cropMode ? 'rgba(244, 67, 54, 0.8)' : 'rgba(33, 150, 243, 0.8)',
                                            '&:hover': {
                                                backgroundColor: cropMode ? 'rgba(211, 47, 47, 0.9)' : 'rgba(25, 118, 210, 0.9)'
                                            }
                                        }}
                                    >
                                        <CropIcon style={{ color: "white", fontSize: '1.5rem' }} />
                                    </IconButton>
                                </Tooltip>

                                <Tooltip title="Change Stitch Direction" arrow>
                                    <IconButton
                                        onClick={handleStitchDirectionButtonClick}
                                        sx={{
                                            position: 'absolute',
                                            top: 10,
                                            left: 'calc(50% + 20px)',
                                            zIndex: 20,
                                            width: '40px',
                                            height: '40px',
                                            backgroundColor: 'rgba(33, 150, 243, 0.8)',
                                            '&:hover': {
                                                backgroundColor: 'rgba(33, 150, 243, 0.9)'
                                            }
                                        }}
                                    >
                                        <OpenWithIcon style={{ color: "white", fontSize: '1.5rem' }} />
                                    </IconButton>
                                </Tooltip>

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
                                                default: break;
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
                        <Typography>Image {visualIndex + 1} of {imageList.length}</Typography>
                        <Box sx={{ width: '80%', mt: 2, position: 'relative' }}>
                            <Slider
                                value={visualIndex}
                                onChange={(e, newValue) => {
                                    if (newValue !== visualIndex) {
                                        setVisualIndex(newValue);
                                    }
                                }}
                                aria-labelledby="image-slider"
                                min={0}
                                max={imageList.length > 0 ? imageList.length - 1 : 0}
                            />
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px', mt: 4 }}>
                            <Tooltip title="Jump Back 10 Images" arrow>
                                <span>
                                    <IconButton
                                        onClick={handleJumpBack}
                                        disabled={visualIndex < 10}
                                        size="large"
                                        sx={{
                                            backgroundColor: 'primary.main',
                                            color: 'white',
                                            '&:hover': { backgroundColor: 'primary.dark' },
                                            '&:disabled': { backgroundColor: 'grey.300', color: 'grey.500' }
                                        }}
                                    >
                                        <KeyboardDoubleArrowLeftIcon />
                                    </IconButton>
                                </span>
                            </Tooltip>
                            <Tooltip title="Previous Image" arrow>
                                <span>
                                    <IconButton
                                        onClick={handlePrevious}
                                        disabled={visualIndex === 0}
                                        size="large"
                                        sx={{
                                            backgroundColor: 'primary.main',
                                            color: 'white',
                                            '&:hover': { backgroundColor: 'primary.dark' },
                                            '&:disabled': { backgroundColor: 'grey.300', color: 'grey.500' }
                                        }}
                                    >
                                        <KeyboardArrowLeftIcon />
                                    </IconButton>
                                </span>
                            </Tooltip>
                            
                            <Tooltip title={plotMode === 'view' ? 'Switch to Mark mode to mark plots' : (plotSelectionState === 'start' ? 'Mark Plot Start' : 'Mark Plot End')} arrow>
                                <span>
                                    <IconButton
                                        onClick={plotSelectionState === 'start' ? handlePlotSelection : handleMarkPlotEnd}
                                        disabled={plotMode === 'view'}
                                        size='large'
                                        sx={{
                                            backgroundColor: plotMode === 'view' ? 'grey.300' : (plotSelectionState === 'start' ? 'success.main' : 'error.main'),
                                            color: plotMode === 'view' ? 'grey.500' : 'white',
                                            '&:hover': {
                                                backgroundColor: plotMode === 'view' ? 'grey.300' : (plotSelectionState === 'start' ? 'success.dark' : 'error.dark'),
                                            },
                                            '&:disabled': {
                                                backgroundColor: 'grey.300',
                                                color: 'grey.500'
                                            }
                                        }}
                                    >
                                        {plotSelectionState === 'start' ? (
                                            <PlayCircleFilledWhiteOutlinedIcon />
                                        ) : (
                                            <StopCircleOutlinedIcon />
                                        )}
                                    </IconButton>
                                </span>
                            </Tooltip>

                            {plotSelectionState === 'end' && (
                                <Tooltip title="Cancel Plot Marking" arrow>
                                    <IconButton
                                        onClick={handleCancel}
                                        size='large'
                                        sx={{
                                            backgroundColor: 'secondary.main',
                                            color: 'white',
                                             '&:hover': {
                                                backgroundColor: 'secondary.dark',
                                            }
                                        }}
                                    >
                                        <CancelOutlinedIcon />
                                    </IconButton>
                                </Tooltip>
                            )}

                            <Tooltip title="Next Image" arrow>
                                <span>
                                    <IconButton
                                        onClick={handleNext}
                                        disabled={visualIndex === imageList.length - 1}
                                        size="large"
                                        sx={{
                                            backgroundColor: 'primary.main',
                                            color: 'white',
                                            '&:hover': { backgroundColor: 'primary.dark' },
                                            '&:disabled': { backgroundColor: 'grey.300', color: 'grey.500' }
                                        }}
                                    >
                                        <KeyboardArrowRightIcon />
                                    </IconButton>
                                </span>
                            </Tooltip>
                            <Tooltip title="Jump Forward 10 Images" arrow>
                                <span>
                                    <IconButton
                                        onClick={handleJumpForward}
                                        disabled={visualIndex >= imageList.length - 10}
                                        size="large"
                                        sx={{
                                            backgroundColor: 'primary.main',
                                            color: 'white',
                                            '&:hover': { backgroundColor: 'primary.dark' },
                                            '&:disabled': { backgroundColor: 'grey.300', color: 'grey.500' }
                                        }}
                                    >
                                        <KeyboardDoubleArrowRightIcon />
                                    </IconButton>
                                </span>
                            </Tooltip>
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
                        <Tooltip title="Close Marked Plots Panel" arrow>
                            <IconButton onClick={() => setIsPanelOpen(false)}>
                                <CloseIcon />
                            </IconButton>
                        </Tooltip>
                    </Box>
                    <TableContainer 
                        component={Paper} 
                        sx={{ 
                            maxHeight: 'calc(100vh - 150px)', 
                            overflow: 'auto',
                            flexGrow: 1
                        }}
                    >
                        <Table stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell 
                                        sx={{ cursor: 'pointer', userSelect: 'none' }}
                                        onClick={() => handleSortChange('plot_index')}
                                    >
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            Plot Index
                                            {sortBy === 'plot_index' && (
                                                sortOrder === 'asc' ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />
                                            )}
                                        </Box>
                                    </TableCell>
                                    {sortedMarkedPlots.some(plot => plot.plot_name) && (
                                        <TableCell 
                                            sx={{ cursor: 'pointer', userSelect: 'none' }}
                                            onClick={() => handleSortChange('plot_name')}
                                        >
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                Plot
                                                {sortBy === 'plot_name' && (
                                                    sortOrder === 'asc' ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />
                                                )}
                                            </Box>
                                        </TableCell>
                                    )}
                                    {sortedMarkedPlots.some(plot => plot.accession) && (
                                        <TableCell 
                                            sx={{ cursor: 'pointer', userSelect: 'none' }}
                                            onClick={() => handleSortChange('accession')}
                                        >
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                Accession
                                                {sortBy === 'accession' && (
                                                    sortOrder === 'asc' ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />
                                                )}
                                            </Box>
                                        </TableCell>
                                    )}
                                    <TableCell align="right">Actions</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {sortedMarkedPlots.map((plot) => (
                                    <TableRow key={plot.plot_index}>
                                        <TableCell component="th" scope="row">
                                            {plot.plot_index}
                                        </TableCell>
                                        {sortedMarkedPlots.some(p => p.plot_name) && (
                                            <TableCell>
                                                {plot.plot_name || '-'}
                                            </TableCell>
                                        )}
                                        {sortedMarkedPlots.some(p => p.accession) && (
                                            <TableCell>
                                                {plot.accession || '-'}
                                            </TableCell>
                                        )}
                                        <TableCell align="right">
                                            <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                                                <Tooltip title="Jump to Plot Start" arrow>
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => handleJumpToPlot(plot)}
                                                        sx={{
                                                            color: 'secondary.main',
                                                            '&:hover': { backgroundColor: 'secondary.light', color: 'white' }
                                                        }}
                                                    >
                                                        <MoveDownIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                                <Tooltip title="Edit Plot" arrow>
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => handleChangePlot(plot)}
                                                        sx={{
                                                            color: 'primary.main',
                                                            '&:hover': { backgroundColor: 'primary.light', color: 'white' }
                                                        }}
                                                    >
                                                        <EditIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                                <Tooltip title="Delete Plot" arrow>
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => handleDeletePlot(plot.plot_index)}
                                                        sx={{
                                                            color: 'error.main',
                                                            '&:hover': { backgroundColor: 'error.light', color: 'white' }
                                                        }}
                                                    >
                                                        <DeleteForeverIcon fontSize="small" />
                                                    </IconButton>
                                                </Tooltip>
                                            </Box>
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
            }} onKeyDown={(e) => {
                if (e.key === 'Enter' && stitchDirection) {
                    handleStitchDirectionSelection(stitchDirection);
                }
            }}>
                <DialogTitle>Select Plot Stitch Direction</DialogTitle>
                <DialogContent>
                    <Typography>Please select the direction of the plot stitching for this dataset.</Typography>
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
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => {
                        setStitchDirectionDialogOpen(false);
                    }}>Cancel</Button>
                    <Button onClick={() => handleStitchDirectionSelection(stitchDirection)} color="primary" disabled={!stitchDirection}>
                        Confirm
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={shiftAllDialogOpen} onClose={() => {
                setShiftAllDialogOpen(false);
                setShiftAll(false);
            }}>
                <DialogTitle>Modify Plot</DialogTitle>
                <DialogContent>
                    <Typography>You are modifying an existing plot.</Typography>
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
                    <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                        Check "Shift All" to adjust all other plots when this plot is modified.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => {
                        setShiftAllDialogOpen(false);
                        setShiftAll(false);
                    }}>Cancel</Button>
                    <Button onClick={() => handleStitchDirectionSelection(currentStitchDirection)} color="primary">
                        Confirm
                    </Button>
                </DialogActions>
            </Dialog>
        </Dialog>
    );
};