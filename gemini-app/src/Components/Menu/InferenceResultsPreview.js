import React, { useState, useEffect, useRef } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    IconButton,
    CircularProgress,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Slider,
    FormControlLabel,
    Switch,
    Paper,
    Chip,
    Grid,
    Alert,
    Snackbar
} from '@mui/material';
import { ArrowBack, ArrowForward, Close, ZoomIn, ZoomOut, FitScreen, Refresh } from '@mui/icons-material';
import { fetchData, useDataState } from "../../DataContext";

const InferenceResultsPreview = ({ open, onClose, inferenceData }) => {
    const [plotImages, setPlotImages] = useState([]);
    const [currentPlotIndex, setCurrentPlotIndex] = useState(0);
    const [currentImageUrl, setCurrentImageUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingImage, setLoadingImage] = useState(false); // New: loading state for individual images
    const [zoom, setZoom] = useState(1);
    const [panX, setPanX] = useState(0);
    const [panY, setPanY] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
    const [isImageLoaded, setIsImageLoaded] = useState(false);

    // New state for auto-zoom and horizontal panning
    const [isAutoZoomed, setIsAutoZoomed] = useState(true);
    const [baseAutoZoom, setBaseAutoZoom] = useState(1); // The base zoom level to fill container height
    const [horizontalPanPercent, setHorizontalPanPercent] = useState(50); // 0-100, where 50 is center
    const [verticalPanPercent, setVerticalPanPercent] = useState(50); // 0-100, where 50 is center
    const [showBoundingBoxes, setShowBoundingBoxes] = useState(true);
    const [showMasks, setShowMasks] = useState(true); // new: toggle for masks
    const [showConfidence, setShowConfidence] = useState(false); // new: toggle for confidence display
    const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
    const [hoveredPrediction, setHoveredPrediction] = useState(null);
    const [hasSegmentation, setHasSegmentation] = useState(false); // new: whether any prediction has segmentation points
    const [predictions, setPredictions] = useState([]);
    const [classCounts, setClassCounts] = useState({});
    const [confidenceThreshold, setConfidenceThreshold] = useState(0.5);
    const [selectedClasses, setSelectedClasses] = useState(new Set());
    const [plotData, setPlotData] = useState({});

    // New state for confidence threshold updates
    const [updatingThreshold, setUpdatingThreshold] = useState(false);
    const [revertingThreshold, setRevertingThreshold] = useState(false);
    const [alertOpen, setAlertOpen] = useState(false);
    const [alertMessage, setAlertMessage] = useState('');
    const [alertSeverity, setAlertSeverity] = useState('success');
    const [showPanSlider, setShowPanSlider] = useState(true); // Toggle for pan slider visibility

    const imageRef = useRef(null);
    const imageContainerRef = useRef(null);
    const canvasRef = useRef(null);
    
    // Caching refs for performance
    const imageUrlCache = useRef(new Map()); // Cache image URLs by fileName
    const predictionCache = useRef(new Map()); // Cache predictions by fileName
    const preloadedImages = useRef(new Set()); // Track which images have been preloaded

    const { flaskUrl, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP } = useDataState();

    const generateClassColors = (classes) => {
        const colors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
            '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
            '#F8C471', '#82E0AA', '#F1948A', '#85C1E9', '#D7DBDD'
        ];

        const classColors = {};
        classes.forEach((className, index) => {
            classColors[className] = colors[index % colors.length];
        });

        return classColors;
    };

    const [classColors, setClassColors] = useState({});

    useEffect(() => {
        if (open && inferenceData) {
            fetchPlotImages();
            fetchPlotData();
        }

        if (open) {
            setZoom(1);
            setPanX(0);
            setPanY(0);
            setIsImageLoaded(false);
            setShowBoundingBoxes(true);
            setConfidenceThreshold(0.5);
            setIsAutoZoomed(true);
            setHorizontalPanPercent(50);
            setVerticalPanPercent(50);
        } else {
            // Clear caches when dialog closes
            imageUrlCache.current.forEach(url => {
                if (url.startsWith('blob:')) {
                    URL.revokeObjectURL(url);
                }
            });
            imageUrlCache.current.clear();
            predictionCache.current.clear();
            preloadedImages.current.clear();
        }

        return () => {
            if (currentImageUrl && currentImageUrl.startsWith('blob:')) {
                URL.revokeObjectURL(currentImageUrl);
            }
        };
    }, [open, inferenceData, selectedYearGCP, selectedExperimentGCP, selectedLocationGCP, selectedPopulationGCP, flaskUrl]);

    useEffect(() => {
        // Fetch predictions when plot changes
        if (plotImages.length > 0 && currentPlotIndex < plotImages.length) {
            fetchPredictionsForCurrentPlot();
        }
    }, [currentPlotIndex, plotImages, inferenceData]);

    useEffect(() => {
        // Preload adjacent images for faster navigation
        if (plotImages.length > 0 && inferenceData && open) {
            const { date, platform, sensor, agrowstitch_version, orthomosaic } = inferenceData;
            const versionDir = orthomosaic || agrowstitch_version;
            const isPlotImages = versionDir === 'Plot_Images';

            // Preload next image
            if (currentPlotIndex < plotImages.length - 1) {
                const nextFileName = plotImages[currentPlotIndex + 1];
                preloadImage(nextFileName, date, platform, sensor, versionDir, isPlotImages);
            }

            // Preload previous image
            if (currentPlotIndex > 0) {
                const prevFileName = plotImages[currentPlotIndex - 1];
                preloadImage(prevFileName, date, platform, sensor, versionDir, isPlotImages);
            }

            // Preload predictions for adjacent plots
            if (currentPlotIndex < plotImages.length - 1) {
                preloadPredictions(plotImages[currentPlotIndex + 1]);
            }
            if (currentPlotIndex > 0) {
                preloadPredictions(plotImages[currentPlotIndex - 1]);
            }
        }
    }, [currentPlotIndex, plotImages, inferenceData, open]);

    useEffect(() => {
        // Update class colors when predictions change
        if (predictions.length > 0) {
            const classes = [...new Set(predictions.map(p => p.class))];
            setClassColors(generateClassColors(classes));
            setSelectedClasses(new Set(classes)); // Show all classes by default
            // detect segmentation
            const seg = predictions.some(p => (p.points && p.points.length >= 3) || (p.segments && p.segments.length));
            setHasSegmentation(seg);
            if (!seg) setShowMasks(false); else setShowMasks(true);
        } else {
            setHasSegmentation(false);
            setShowMasks(false);
        }
    }, [predictions]);

    useEffect(() => {
        // Redraw bounding boxes / masks when relevant state changes
        if (isImageLoaded && (showBoundingBoxes || (showMasks && hasSegmentation) || showConfidence)) {
            // Use requestAnimationFrame for smoother updates
            requestAnimationFrame(() => {
                drawDetections();
            });
        } else if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            ctx && ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
    }, [isImageLoaded, showBoundingBoxes, showMasks, showConfidence, hasSegmentation, predictions, confidenceThreshold, selectedClasses, classColors, zoom, baseAutoZoom, horizontalPanPercent, verticalPanPercent, panX, panY, hoveredPrediction, isAutoZoomed]);

    useEffect(() => {
        // Keyboard navigation
        const handleKeyDown = (e) => {
            if (!open) return;

            switch (e.key) {
                case 'ArrowLeft':
                    e.preventDefault();
                    handlePreviousPlot();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    handleNextPlot();
                    break;
                case 'Escape':
                    e.preventDefault();
                    onClose();
                    break;
                case '+':
                case '=':
                    e.preventDefault();
                    handleZoomIn();
                    break;
                case '-':
                    e.preventDefault();
                    handleZoomOut();
                    break;
                case '0':
                    e.preventDefault();
                    handleFitScreen();
                    break;
                case 'r':
                case 'R':
                    e.preventDefault();
                    handleResetToDefault();
                    break;
            }
        };

        // Mouse wheel zoom
        const handleWheel = (e) => {
            if (!open || !imageContainerRef.current || !imageDimensions.width || !imageDimensions.height) return;
            e.preventDefault();
            
            const delta = e.deltaY > 0 ? -0.05 : 0.05;
            const maxZoom = isAutoZoomed ? 5 : 3;
            const newZoom = Math.max(0.1, Math.min(maxZoom, zoom + delta));
            
            if (isAutoZoomed) {
                // Get mouse position relative to container
                const rect = imageContainerRef.current.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                
                const containerWidth = rect.width;
                const containerHeight = rect.height;
                
                // Calculate current and new display dimensions
                const oldEffectiveZoom = baseAutoZoom * zoom;
                const newEffectiveZoom = baseAutoZoom * newZoom;
                
                const oldDisplayWidth = imageDimensions.width * oldEffectiveZoom;
                const oldDisplayHeight = imageDimensions.height * oldEffectiveZoom;
                const newDisplayWidth = imageDimensions.width * newEffectiveZoom;
                const newDisplayHeight = imageDimensions.height * newEffectiveZoom;
                
                let newHorizontalPercent = horizontalPanPercent;
                let newVerticalPercent = verticalPanPercent;
                
                // Calculate where the image currently is positioned
                const oldMaxPanX = Math.max(0, oldDisplayWidth - containerWidth);
                const oldMaxPanY = Math.max(0, oldDisplayHeight - containerHeight);
                const oldPanXPixels = oldMaxPanX > 0 ? -(oldMaxPanX * (horizontalPanPercent - 50) / 50) : 0;
                const oldPanYPixels = oldMaxPanY > 0 ? -(oldMaxPanY * (verticalPanPercent - 50) / 50) : 0;
                
                const oldImageLeft = (containerWidth - oldDisplayWidth) / 2 + oldPanXPixels;
                const oldImageTop = (containerHeight - oldDisplayHeight) / 2 + oldPanYPixels;
                
                // Calculate mouse position relative to the image (as a ratio 0-1)
                const mouseXOnImage = (mouseX - oldImageLeft) / oldDisplayWidth;
                const mouseYOnImage = (mouseY - oldImageTop) / oldDisplayHeight;
                
                // Calculate where the image should be positioned after zoom to keep mouse point fixed
                const newImageLeft = mouseX - (mouseXOnImage * newDisplayWidth);
                const newImageTop = mouseY - (mouseYOnImage * newDisplayHeight);
                
                // Convert new position to pan percentages (if new image overflows)
                const newMaxPanX = Math.max(0, newDisplayWidth - containerWidth);
                const newMaxPanY = Math.max(0, newDisplayHeight - containerHeight);
                
                if (newMaxPanX > 0) {
                    const newPanXPixels = newImageLeft - (containerWidth - newDisplayWidth) / 2;
                    newHorizontalPercent = 50 - (newPanXPixels / newMaxPanX) * 50;
                    newHorizontalPercent = Math.max(0, Math.min(100, newHorizontalPercent));
                } else {
                    // Image fits horizontally, reset to center
                    newHorizontalPercent = 50;
                }
                
                if (newMaxPanY > 0) {
                    const newPanYPixels = newImageTop - (containerHeight - newDisplayHeight) / 2;
                    newVerticalPercent = 50 - (newPanYPixels / newMaxPanY) * 50;
                    newVerticalPercent = Math.max(0, Math.min(100, newVerticalPercent));
                } else {
                    // Image fits vertically, reset to center
                    newVerticalPercent = 50;
                }
                
                setZoom(newZoom);
                setHorizontalPanPercent(newHorizontalPercent);
                setVerticalPanPercent(newVerticalPercent);
                
                // Immediately update image styling and redraw canvas
                requestAnimationFrame(() => {
                    updateImageStyle(newZoom, newHorizontalPercent, panX, panY, newVerticalPercent);
                    if (isImageLoaded && (showBoundingBoxes || (showMasks && hasSegmentation) || showConfidence)) {
                        drawDetections();
                    }
                });
            } else {
                // Manual zoom mode - keep existing behavior
                setZoom(newZoom);
                if (newZoom === 1) {
                    setPanX(0);
                    setPanY(0);
                }
                
                // Immediately update image styling and redraw canvas
                requestAnimationFrame(() => {
                    updateImageStyle(newZoom, horizontalPanPercent, panX, panY, verticalPanPercent);
                    if (isImageLoaded && (showBoundingBoxes || (showMasks && hasSegmentation) || showConfidence)) {
                        drawDetections();
                    }
                });
            }
        };

        if (open) {
            document.addEventListener('keydown', handleKeyDown);
            const imageContainer = imageContainerRef.current;
            if (imageContainer) {
                imageContainer.addEventListener('wheel', handleWheel, { passive: false });
            }
        }

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            const imageContainer = imageContainerRef.current;
            if (imageContainer) {
                imageContainer.removeEventListener('wheel', handleWheel);
            }
        };
    }, [open, currentPlotIndex, plotImages.length, zoom, onClose]);

    useEffect(() => {
        // Set up ResizeObserver to update canvas when image size changes
        let resizeObserver;

        if (imageRef.current) {
            resizeObserver = new ResizeObserver(() => {
                if (isImageLoaded && (showBoundingBoxes || (showMasks && hasSegmentation) || showConfidence)) {
                    drawDetections();
                }
            });

            resizeObserver.observe(imageRef.current);
        }

        // Also listen for window resize events
        const handleWindowResize = () => {
            if (isImageLoaded && (showBoundingBoxes || (showMasks && hasSegmentation) || showConfidence)) {
                setTimeout(() => drawDetections(), 100); // Small delay to ensure layout is updated
            }
        };

        window.addEventListener('resize', handleWindowResize);

        return () => {
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
            window.removeEventListener('resize', handleWindowResize);
        };
    }, [imageRef.current, isImageLoaded, showBoundingBoxes, showMasks, showConfidence, hasSegmentation]);

    const fetchPlotImages = async () => {
        if (!inferenceData) return;

        const { date, platform, sensor, agrowstitch_version, orthomosaic } = inferenceData;
        // Use orthomosaic if available, otherwise fall back to agrowstitch_version for backward compatibility
        const versionDir = orthomosaic || agrowstitch_version;
        setLoading(true);

        try {
            let plotFiles = [];
            let isPlotImages = false;

            // Check if this is Plot_Images format
            if (versionDir === 'Plot_Images') {
                isPlotImages = true;
                // Look in Intermediate directory for Plot_Images
                plotFiles = await fetchData(
                    `${flaskUrl}list_files/Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/plot_images/${date}`
                );

                // Filter for plot images from split_orthomosaics
                plotFiles = plotFiles
                    .filter(file => file.startsWith('plot_') && file.endsWith('.png'))
                    .sort((a, b) => {
                        const plotNumA = parseInt(a.match(/plot_(\d+)_/)?.[1] || 0);
                        const plotNumB = parseInt(b.match(/plot_(\d+)_/)?.[1] || 0);
                        return plotNumA - plotNumB;
                    });
            } else {
                // Traditional AgRowStitch format
                plotFiles = await fetchData(
                    `${flaskUrl}list_files/Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/${versionDir}`
                );

                // Filter for AgRowStitch plot images
                plotFiles = plotFiles
                    .filter(file => file.startsWith('full_res_mosaic_temp_plot_') && file.endsWith('.png'))
                    .sort((a, b) => {
                        const plotNumA = parseInt(a.match(/plot_(\d+)/)?.[1] || 0);
                        const plotNumB = parseInt(b.match(/plot_(\d+)/)?.[1] || 0);
                        return plotNumA - plotNumB;
                    });
            }

            setPlotImages(plotFiles);
            setCurrentPlotIndex(0);
            setLoading(false);

            if (plotFiles.length > 0) {
                loadPlotImage(plotFiles[0], date, platform, sensor, versionDir, isPlotImages);
            }

        } catch (error) {
            console.error('Error fetching plot images:', error);
            setLoading(false);
        }
    };

    const fetchPlotData = async () => {
        try {
            const response = await fetch(`${flaskUrl}get_plot_borders_data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                }),
            });

            if (response.ok) {
                const data = await response.json();
                setPlotData(data.plot_data || {});
            }
        } catch (error) {
            console.error('Error fetching plot data:', error);
            setPlotData({});
        }
    };

    const fetchPredictionsForCurrentPlot = async () => {
        if (!inferenceData || plotImages.length === 0) return;

        const currentFileName = plotImages[currentPlotIndex];
        
        // Check cache first
        if (predictionCache.current.has(currentFileName)) {
            const cached = predictionCache.current.get(currentFileName);
            setPredictions(cached.predictions || []);
            setClassCounts(cached.class_counts || {});
            return;
        }

        const { date, platform, sensor, agrowstitch_version, orthomosaic, model_task } = inferenceData;
        const versionDir = orthomosaic || agrowstitch_version;

        try {
            const response = await fetch(`${flaskUrl}get_plot_predictions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date,
                    platform,
                    sensor,
                    agrowstitch_version: versionDir, // Keep for backend compatibility
                    orthomosaic: versionDir, // New parameter name
                    plot_filename: currentFileName,
                    model_task: model_task || 'detection' // Pass model task to get correct predictions
                })
            });

            if (response.ok) {
                const data = await response.json();
                // Cache the result
                predictionCache.current.set(currentFileName, {
                    predictions: data.predictions || [],
                    class_counts: data.class_counts || {}
                });
                setPredictions(data.predictions || []);
                setClassCounts(data.class_counts || {});
            } else {
                console.error('Error fetching predictions:', response.status);
                setPredictions([]);
                setClassCounts({});
            }
        } catch (error) {
            console.error('Error fetching predictions:', error);
            setPredictions([]);
            setClassCounts({});
        }
    };

    const preloadPredictions = async (fileName) => {
        if (!inferenceData || !fileName || predictionCache.current.has(fileName)) return;

        const { date, platform, sensor, agrowstitch_version, orthomosaic, model_task } = inferenceData;
        const versionDir = orthomosaic || agrowstitch_version;

        try {
            const response = await fetch(`${flaskUrl}get_plot_predictions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date,
                    platform,
                    sensor,
                    agrowstitch_version: versionDir,
                    orthomosaic: versionDir,
                    plot_filename: fileName,
                    model_task: model_task || 'detection'
                })
            });

            if (response.ok) {
                const data = await response.json();
                predictionCache.current.set(fileName, {
                    predictions: data.predictions || [],
                    class_counts: data.class_counts || {}
                });
            }
        } catch (error) {
            console.log('Preload predictions failed for', fileName, error);
        }
    };

    const loadPlotImage = async (fileName, date, platform, sensor, versionDir, isPlotImages = false) => {
        // Set loading state
        setLoadingImage(true);
        
        // Check cache first
        if (imageUrlCache.current.has(fileName)) {
            const cachedUrl = imageUrlCache.current.get(fileName);
            setCurrentImageUrl(cachedUrl);
            setZoom(1);
            setIsImageLoaded(false);
            // Loading will be cleared in handleImageLoad
            return;
        }

        try {
            if (currentImageUrl && currentImageUrl.startsWith('blob:')) {
                URL.revokeObjectURL(currentImageUrl);
            }

            // Determine the correct path based on whether this is Plot_Images or AgRowStitch
            let imagePath;
            if (isPlotImages || versionDir === 'Plot_Images') {
                // Plot_Images are stored in Intermediate/.../ plot_images/date/
                imagePath = `Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/plot_images/${date}/${fileName}`;
            } else {
                // AgRowStitch images are stored in Processed/.../date/platform/sensor/versionDir/
                imagePath = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/${versionDir}/${fileName}`;
            }

            const directUrl = `${flaskUrl}files/${imagePath}`;

            try {
                const directResponse = await fetch(directUrl);
                if (directResponse.ok) {
                    // Cache the direct URL
                    imageUrlCache.current.set(fileName, directUrl);
                    setCurrentImageUrl(directUrl);
                    setZoom(1);
                    setIsImageLoaded(false);
                    // Loading will be cleared in handleImageLoad
                    return;
                }
            } catch (directError) {
                console.log('Direct file serving failed, trying blob method');
            }

            const response = await fetch(`${flaskUrl}get_png_file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: imagePath }),
            });

            if (response.ok) {
                const blob = await response.blob();
                if (blob.size > 0) {
                    const imageUrl = URL.createObjectURL(blob);
                    // Cache the blob URL
                    imageUrlCache.current.set(fileName, imageUrl);
                    setCurrentImageUrl(imageUrl);
                    setZoom(1);
                    setIsImageLoaded(false);
                    // Loading will be cleared in handleImageLoad
                }
            } else {
                setLoadingImage(false);
            }
        } catch (error) {
            console.error('Error loading plot image:', error);
            setCurrentImageUrl('');
            setLoadingImage(false);
        }
    };

    const preloadImage = async (fileName, date, platform, sensor, versionDir, isPlotImages = false) => {
        // Skip if already cached or being preloaded
        if (imageUrlCache.current.has(fileName) || preloadedImages.current.has(fileName)) {
            return;
        }

        preloadedImages.current.add(fileName);

        try {
            // Determine the correct path
            let imagePath;
            if (isPlotImages || versionDir === 'Plot_Images') {
                imagePath = `Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/plot_images/${date}/${fileName}`;
            } else {
                imagePath = `Processed/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}/${sensor}/${versionDir}/${fileName}`;
            }

            const directUrl = `${flaskUrl}files/${imagePath}`;

            try {
                const directResponse = await fetch(directUrl);
                if (directResponse.ok) {
                    // Cache the direct URL
                    imageUrlCache.current.set(fileName, directUrl);
                    // Preload the image in browser cache
                    const img = new Image();
                    img.src = directUrl;
                    return;
                }
            } catch (directError) {
                console.log('Direct preload failed, trying blob method');
            }

            const response = await fetch(`${flaskUrl}get_png_file`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: imagePath }),
            });

            if (response.ok) {
                const blob = await response.blob();
                if (blob.size > 0) {
                    const imageUrl = URL.createObjectURL(blob);
                    imageUrlCache.current.set(fileName, imageUrl);
                    // Preload the image in browser
                    const img = new Image();
                    img.src = imageUrl;
                }
            }
        } catch (error) {
            console.log('Preload failed for', fileName, error);
        }
    };

    const handleImageLoad = (event) => {
        const img = event.target;
        setImageDimensions({
            width: img.naturalWidth,
            height: img.naturalHeight
        });
        setIsImageLoaded(true);
        setLoadingImage(false); // Clear loading state when image is loaded

        // Calculate auto-zoom to fill container height
        if (imageContainerRef.current) {
            const containerHeight = imageContainerRef.current.clientHeight;
            const autoZoom = containerHeight / img.naturalHeight;
            setBaseAutoZoom(autoZoom);
            setZoom(1); // Reset zoom to 1 (will be multiplied by baseAutoZoom)
            setIsAutoZoomed(true);
            setHorizontalPanPercent(50); // Center horizontally
            setVerticalPanPercent(50); // Center vertically
            setPanX(0);
            setPanY(0);
        }

        // Setup canvas to match image display size and position
        setTimeout(() => {
            if (canvasRef.current && imageContainerRef.current) {
                drawBoundingBoxes();
            }
        }, 100); // Small delay to ensure image is fully rendered
    };

    const drawDetections = () => {
        if (!canvasRef.current || !imageRef.current || !isImageLoaded || !imageContainerRef.current) return;
        const canvas = canvasRef.current;
        const img = imageRef.current;
        const ctx = canvas.getContext('2d');

        // Container metrics
        const containerRect = imageContainerRef.current.getBoundingClientRect();
        const containerWidth = containerRect.width;
        const containerHeight = containerRect.height;

        let displayWidth, displayHeight, imageLeft, imageTop;

        if (isAutoZoomed) {
            // Auto-zoom mode: calculate effective zoom and positioning
            const effectiveZoom = baseAutoZoom * zoom;
            displayHeight = imageDimensions.height * effectiveZoom;
            displayWidth = imageDimensions.width * effectiveZoom;

            // Calculate horizontal position based on pan percentage
            const maxPanX = Math.max(0, displayWidth - containerWidth);
            const panXFromPercent = -(maxPanX * (horizontalPanPercent - 50) / 50);

            // Calculate vertical position based on pan percentage
            const maxPanY = Math.max(0, displayHeight - containerHeight);
            const panYFromPercent = -(maxPanY * (verticalPanPercent - 50) / 50);

            imageLeft = (containerWidth - displayWidth) / 2 + panXFromPercent;
            imageTop = (containerHeight - displayHeight) / 2 + panYFromPercent;
        } else {
            // Manual zoom mode: use existing logic
            const imageAspectRatio = imageDimensions.width / imageDimensions.height;
            const containerAspectRatio = containerWidth / containerHeight;

            if (imageAspectRatio > containerAspectRatio) {
                displayWidth = containerWidth;
                displayHeight = containerWidth / imageAspectRatio;
            } else {
                displayHeight = containerHeight;
                displayWidth = containerHeight * imageAspectRatio;
            }

            const zoomedWidth = displayWidth * zoom;
            const zoomedHeight = displayHeight * zoom;
            imageLeft = (containerWidth - zoomedWidth) / 2 + panX;
            imageTop = (containerHeight - zoomedHeight) / 2 + panY;
            displayWidth = zoomedWidth;
            displayHeight = zoomedHeight;
        }

        // Only update canvas size and position if they've changed
        const needsResize = canvas.width !== displayWidth || canvas.height !== displayHeight;
        const needsReposition = canvas.style.left !== `${imageLeft}px` || canvas.style.top !== `${imageTop}px`;

        if (needsResize) {
            canvas.width = displayWidth;
            canvas.height = displayHeight;
            canvas.style.width = `${displayWidth}px`;
            canvas.style.height = `${displayHeight}px`;
        }

        if (needsReposition) {
            canvas.style.top = `${imageTop}px`;
            canvas.style.left = `${imageLeft}px`;
        }

        // Clear and redraw
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const scaleX = displayWidth / imageDimensions.width;
        const scaleY = displayHeight / imageDimensions.height;
        const filteredPredictions = predictions.filter(pred => pred.confidence >= confidenceThreshold && selectedClasses.has(pred.class));

        filteredPredictions.forEach(pred => {
            const color = classColors[pred.class] || '#FF0000';
            // draw mask/polygon first (under box)
            if (showMasks && hasSegmentation) {
                // Roboflow polygon points: pred.points = [{x,y},...]
                let pts = [];
                if (pred.points && pred.points.length >= 3) {
                    pts = pred.points;
                } else if (pred.segments && pred.segments.length) {
                    // optional: segments as array of numbers [x1,y1,x2,y2,...]
                    const seg = pred.segments[0];
                    for (let i = 0; i < seg.length; i += 2) pts.push({ x: seg[i], y: seg[i + 1] });
                }
                if (pts.length >= 3) {
                    ctx.beginPath();
                    pts.forEach((pt, idx) => {
                        const px = pt.x * scaleX;
                        const py = pt.y * scaleY;
                        if (idx === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                    });
                    ctx.closePath();
                    ctx.fillStyle = hexToRgba(color, 0.25);
                    ctx.fill();
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = color;
                    ctx.stroke();
                }
            }
            if (showBoundingBoxes && !hasSegmentation) {
                const x = (pred.x - pred.width / 2) * scaleX;
                const y = (pred.y - pred.height / 2) * scaleY;
                const width = pred.width * scaleX;
                const height = pred.height * scaleY;
                ctx.strokeStyle = color;
                ctx.lineWidth = 2;
                ctx.strokeRect(x, y, width, height);
            }

            // Draw confidence text if enabled
            if (showConfidence) {
                const confidenceText = `${(pred.confidence * 100).toFixed(1)}%`;
                const fontSize = Math.max(12, 16 * Math.min(scaleX, scaleY));

                // Position text at top-left of detection
                let textX, textY;
                if (hasSegmentation && pred.points && pred.points.length > 0) {
                    // For segmentation, use the top-left of bounding box of points
                    const minX = Math.min(...pred.points.map(p => p.x));
                    const minY = Math.min(...pred.points.map(p => p.y));
                    textX = minX * scaleX;
                    textY = minY * scaleY;
                } else {
                    // For bounding boxes, use top-left corner
                    textX = (pred.x - pred.width / 2) * scaleX;
                    textY = (pred.y - pred.height / 2) * scaleY;
                }

                // Check if this prediction's text would overlap with others
                const hasOverlap = filteredPredictions.some(otherPred => {
                    if (otherPred === pred) return false;

                    let otherTextX, otherTextY;
                    if (hasSegmentation && otherPred.points && otherPred.points.length > 0) {
                        const minX = Math.min(...otherPred.points.map(p => p.x));
                        const minY = Math.min(...otherPred.points.map(p => p.y));
                        otherTextX = minX * scaleX;
                        otherTextY = minY * scaleY;
                    } else {
                        otherTextX = (otherPred.x - otherPred.width / 2) * scaleX;
                        otherTextY = (otherPred.y - otherPred.height / 2) * scaleY;
                    }

                    // Check if text positions are close (within 60 pixels)
                    const distance = Math.sqrt(Math.pow(textX - otherTextX, 2) + Math.pow(textY - otherTextY, 2));
                    return distance < 60;
                });

                // Only show text if no overlap OR if this prediction is being hovered
                const shouldShowText = !hasOverlap || (hoveredPrediction &&
                    Math.abs(hoveredPrediction.x - pred.x) < 5 &&
                    Math.abs(hoveredPrediction.y - pred.y) < 5);

                if (shouldShowText) {
                    ctx.font = `${fontSize}px Arial`;
                    ctx.fillStyle = '#FFFFFF';
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = 1;

                    // Ensure text doesn't go off canvas
                    textX = Math.max(5, textX);
                    textY = Math.max(fontSize + 5, textY);

                    // Draw text with stroke for better visibility
                    ctx.strokeText(confidenceText, textX, textY);
                    ctx.fillText(confidenceText, textX, textY);
                }
            }
        });
    };
    // helper to convert hex to rgba
    const hexToRgba = (hex, alpha) => {
        let c = hex.replace('#', '');
        if (c.length === 3) c = c.split('').map(ch => ch + ch).join('');
        const num = parseInt(c, 16);
        const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
        return `rgba(${r},${g},${b},${alpha})`;
    };

    // Function to immediately update image styling without waiting for React re-render
    const updateImageStyle = (newZoom = zoom, newHorizontalPanPercent = horizontalPanPercent, newPanX = panX, newPanY = panY, newVerticalPanPercent = verticalPanPercent) => {
        if (!imageRef.current || !imageContainerRef.current || !imageDimensions.width || !imageDimensions.height) return;

        const img = imageRef.current;

        if (isAutoZoomed) {
            const containerWidth = imageContainerRef.current.clientWidth;
            const containerHeight = imageContainerRef.current.clientHeight;
            const displayWidth = baseAutoZoom * newZoom * imageDimensions.width;
            const displayHeight = baseAutoZoom * newZoom * imageDimensions.height;
            
            // Calculate horizontal translation
            const translateX = -(Math.max(0, displayWidth - containerWidth) * (newHorizontalPanPercent - 50) / 50);
            
            // Calculate vertical translation
            const translateY = -(Math.max(0, displayHeight - containerHeight) * (newVerticalPanPercent - 50) / 50);

            const newHeight = `${displayHeight}px`;
            img.style.height = newHeight;
            img.style.transform = `translate(${translateX}px, ${translateY}px)`;
            img.style.maxWidth = 'none';
            img.style.maxHeight = 'none';
            img.style.width = 'auto';
        } else {
            img.style.transform = `scale(${newZoom}) translate(${newPanX / newZoom}px, ${newPanY / newZoom}px)`;
            img.style.maxWidth = '100%';
            img.style.maxHeight = '100%';
            img.style.width = 'auto';
            img.style.height = 'auto';
        }
    };

    const drawBoundingBoxes = () => drawDetections();

    const handleZoomIn = () => {
        let newZoom;
        if (isAutoZoomed) {
            // In auto-zoom mode, increase zoom multiplier
            newZoom = Math.min(5, zoom + 0.05);
        } else {
            // Manual zoom mode
            newZoom = Math.min(3, zoom + 0.05);
        }

        // Update zoom state and immediately update image styling
        setZoom(newZoom);

        // Force immediate image style update
        if (imageRef.current && imageContainerRef.current) {
            requestAnimationFrame(() => {
                updateImageStyle(newZoom, horizontalPanPercent, panX, panY, verticalPanPercent);
                if (isImageLoaded && (showBoundingBoxes || (showMasks && hasSegmentation) || showConfidence)) {
                    drawDetections();
                }
            });
        }
    };

    const handleZoomOut = () => {
        let newZoom;
        if (isAutoZoomed) {
            // In auto-zoom mode, decrease zoom multiplier
            newZoom = Math.max(0.1, zoom - 0.05);
        } else {
            // Manual zoom mode
            newZoom = Math.max(0.1, zoom - 0.05);
            if (newZoom === 1) {
                setPanX(0);
                setPanY(0);
            }
        }

        // Update zoom state and immediately update image styling
        setZoom(newZoom);

        // Force immediate image style update
        if (imageRef.current && imageContainerRef.current) {
            requestAnimationFrame(() => {
                updateImageStyle(newZoom, horizontalPanPercent, panX, panY, verticalPanPercent);
                if (isImageLoaded && (showBoundingBoxes || (showMasks && hasSegmentation) || showConfidence)) {
                    drawDetections();
                }
            });
        }
    };

    const handleFitScreen = () => {
        setZoom(1);
        setPanX(0);
        setPanY(0);
        setIsAutoZoomed(false);
        setHorizontalPanPercent(50);
        setVerticalPanPercent(50);
        
        // Immediately update image styling and redraw canvas
        requestAnimationFrame(() => {
            updateImageStyle(1, 50, 0, 0, 50);
            if (isImageLoaded && (showBoundingBoxes || (showMasks && hasSegmentation) || showConfidence)) {
                drawDetections();
            }
        });
    };

    const handleResetToDefault = () => {
        setZoom(1);
        setPanX(0);
        setPanY(0);
        setIsAutoZoomed(true);
        setHorizontalPanPercent(50);
        setVerticalPanPercent(50);
        
        // Immediately update image styling and redraw canvas
        requestAnimationFrame(() => {
            updateImageStyle(1, 50, 0, 0, 50);
            if (isImageLoaded && (showBoundingBoxes || (showMasks && hasSegmentation) || showConfidence)) {
                drawDetections();
            }
        });
    };    const handlePreviousPlot = () => {
        if (currentPlotIndex > 0 && inferenceData) {
            const newIndex = currentPlotIndex - 1;
            setCurrentPlotIndex(newIndex);
            const { date, platform, sensor, agrowstitch_version, orthomosaic } = inferenceData;
            const versionDir = orthomosaic || agrowstitch_version;
            const isPlotImages = versionDir === 'Plot_Images';
            loadPlotImage(plotImages[newIndex], date, platform, sensor, versionDir, isPlotImages);
            // Reset to auto-zoom when changing plot
            setIsAutoZoomed(true);
            setHorizontalPanPercent(50);
            setVerticalPanPercent(50);
            setPanX(0);
            setPanY(0);
        }
    };

    const handleNextPlot = () => {
        if (currentPlotIndex < plotImages.length - 1 && inferenceData) {
            const newIndex = currentPlotIndex + 1;
            setCurrentPlotIndex(newIndex);
            const { date, platform, sensor, agrowstitch_version, orthomosaic } = inferenceData;
            const versionDir = orthomosaic || agrowstitch_version;
            const isPlotImages = versionDir === 'Plot_Images';
            loadPlotImage(plotImages[newIndex], date, platform, sensor, versionDir, isPlotImages);
            // Reset to auto-zoom when changing plot
            setIsAutoZoomed(true);
            setHorizontalPanPercent(50);
            setVerticalPanPercent(50);
            setPanX(0);
            setPanY(0);
        }
    };

    const handleMouseDown = (e) => {
        // Enable dragging in auto-zoom mode when image is larger than container, or in manual zoom mode
        if (isAutoZoomed) {
            if (imageContainerRef.current && imageDimensions.width > 0 && imageDimensions.height > 0) {
                const effectiveZoom = baseAutoZoom * zoom;
                const displayWidth = imageDimensions.width * effectiveZoom;
                const displayHeight = imageDimensions.height * effectiveZoom;
                const containerWidth = imageContainerRef.current.clientWidth;
                const containerHeight = imageContainerRef.current.clientHeight;
                
                // Enable dragging if image is wider OR taller than container
                const canPanHorizontally = displayWidth > containerWidth;
                const canPanVertically = displayHeight > containerHeight;
                
                if (canPanHorizontally || canPanVertically) {
                    setIsDragging(true);
                    // Store the starting mouse position
                    setDragStart({ x: e.clientX, y: e.clientY });
                }
            }
        } else if (zoom > 1) {
            setIsDragging(true);
            setDragStart({ x: e.clientX - panX, y: e.clientY - panY });
        }
    };

    const handleMouseMove = (e) => {
        if (isDragging) {
            if (isAutoZoomed) {
                // In auto-zoom mode, update horizontal and vertical pan percentage based on mouse movement
                if (imageContainerRef.current && imageDimensions.width > 0 && imageDimensions.height > 0) {
                    const containerWidth = imageContainerRef.current.clientWidth;
                    const containerHeight = imageContainerRef.current.clientHeight;
                    const effectiveZoom = baseAutoZoom * zoom;
                    const displayWidth = imageDimensions.width * effectiveZoom;
                    const displayHeight = imageDimensions.height * effectiveZoom;
                    const maxPanX = Math.max(0, displayWidth - containerWidth);
                    const maxPanY = Math.max(0, displayHeight - containerHeight);

                    let newHorizontalPercent = horizontalPanPercent;
                    let newVerticalPercent = verticalPanPercent;

                    // Handle horizontal panning if image is wider than container
                    if (maxPanX > 0) {
                        const deltaX = e.clientX - dragStart.x;
                        const percentChangeX = -(deltaX / maxPanX) * 100;
                        newHorizontalPercent = Math.max(0, Math.min(100, horizontalPanPercent + percentChangeX));
                    }

                    // Handle vertical panning if image is taller than container
                    if (maxPanY > 0) {
                        const deltaY = e.clientY - dragStart.y;
                        const percentChangeY = -(deltaY / maxPanY) * 100;
                        newVerticalPercent = Math.max(0, Math.min(100, verticalPanPercent + percentChangeY));
                    }

                    setHorizontalPanPercent(newHorizontalPercent);
                    setVerticalPanPercent(newVerticalPercent);

                    // Update drag start for next move event (continuous dragging)
                    setDragStart({ x: e.clientX, y: e.clientY });

                    // Immediately update image styling and redraw canvas
                    requestAnimationFrame(() => {
                        updateImageStyle(zoom, newHorizontalPercent, 0, 0, newVerticalPercent);
                        if (isImageLoaded && (showBoundingBoxes || (showMasks && hasSegmentation) || showConfidence)) {
                            drawDetections();
                        }
                    });
                }
            } else if (zoom > 1) {
                // In manual zoom mode, allow free panning
                const newPanX = e.clientX - dragStart.x;
                const newPanY = e.clientY - dragStart.y;
                setPanX(newPanX);
                setPanY(newPanY);

                // Immediately update image styling and redraw canvas
                requestAnimationFrame(() => {
                    updateImageStyle(zoom, horizontalPanPercent, newPanX, newPanY, verticalPanPercent);
                    if (isImageLoaded && (showBoundingBoxes || (showMasks && hasSegmentation) || showConfidence)) {
                        drawDetections();
                    }
                });
            }
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleCanvasMouseMove = (e) => {
        if (!canvasRef.current || !imageContainerRef.current || !isImageLoaded) return;

        const canvas = canvasRef.current;
        const containerRect = imageContainerRef.current.getBoundingClientRect();
        const canvasRect = canvas.getBoundingClientRect();

        // Get mouse position relative to canvas
        const mouseX = e.clientX - canvasRect.left;
        const mouseY = e.clientY - canvasRect.top;

        // Convert canvas coordinates to image coordinates
        const scaleX = canvas.width / imageDimensions.width;
        const scaleY = canvas.height / imageDimensions.height;
        const imageX = mouseX / scaleX;
        const imageY = mouseY / scaleY;

        // Find which prediction (if any) the mouse is over
        const filteredPredictions = predictions.filter(pred =>
            pred.confidence >= confidenceThreshold && selectedClasses.has(pred.class)
        );

        let hoveredPred = null;
        for (const pred of filteredPredictions) {
            let isInside = false;

            if (hasSegmentation && pred.points && pred.points.length > 0) {
                // Check if point is inside segmentation polygon
                isInside = isPointInPolygon({ x: imageX, y: imageY }, pred.points);
            } else {
                // Check if point is inside bounding box
                const left = pred.x - pred.width / 2;
                const right = pred.x + pred.width / 2;
                const top = pred.y - pred.height / 2;
                const bottom = pred.y + pred.height / 2;

                isInside = imageX >= left && imageX <= right && imageY >= top && imageY <= bottom;
            }

            if (isInside) {
                hoveredPred = pred;
                break;
            }
        }

        setHoveredPrediction(hoveredPred);
    };

    const handleCanvasMouseLeave = () => {
        setHoveredPrediction(null);
    };

    // Helper function to check if point is inside polygon
    const isPointInPolygon = (point, polygon) => {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            if (((polygon[i].y > point.y) !== (polygon[j].y > point.y)) &&
                (point.x < (polygon[j].x - polygon[i].x) * (point.y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)) {
                inside = !inside;
            }
        }
        return inside;
    };

    const handleZoomChange = (e, newValue) => {
        setZoom(newValue);
        // Reset pan when zoom changes to 1 in manual mode
        if (!isAutoZoomed && newValue === 1) {
            setPanX(0);
            setPanY(0);
        }

        // Immediately update image styling and redraw canvas
        requestAnimationFrame(() => {
            updateImageStyle(newValue, horizontalPanPercent, panX, panY, verticalPanPercent);
            if (isImageLoaded && (showBoundingBoxes || (showMasks && hasSegmentation) || showConfidence)) {
                drawDetections();
            }
        });
    };

    const handlePlotSelection = (event) => {
        const selectedFileName = event.target.value;
        const newIndex = plotImages.findIndex(img => img === selectedFileName);
        if (newIndex !== -1 && inferenceData) {
            setCurrentPlotIndex(newIndex);
            const { date, platform, sensor, agrowstitch_version, orthomosaic } = inferenceData;
            const versionDir = orthomosaic || agrowstitch_version;
            const isPlotImages = versionDir === 'Plot_Images';
            loadPlotImage(plotImages[newIndex], date, platform, sensor, versionDir, isPlotImages);
        }
    };

    const getPlotNumber = (fileName) => {
        const match = fileName.match(/plot_(\d+)/);
        return match ? match[1] : 'Unknown';
    };

    const getPlotDisplayName = (fileName) => {
        const plotNumber = getPlotNumber(fileName);
        const plotIndex = parseInt(plotNumber);
        const metadata = plotData[plotIndex] || {};

        if (metadata.plot) {
            return `Plot ${metadata.plot}${metadata.accession ? ` - ${metadata.accession}` : ''}`;
        }
        return `Plot ${plotNumber}`;
    };

    const toggleClassVisibility = (className) => {
        const newSelectedClasses = new Set(selectedClasses);
        if (newSelectedClasses.has(className)) {
            newSelectedClasses.delete(className);
        } else {
            newSelectedClasses.add(className);
        }
        setSelectedClasses(newSelectedClasses);
    };

    const handleUpdateConfidenceThreshold = async () => {
        if (!inferenceData) return;

        setUpdatingThreshold(true);

        try {
            const { date, platform, sensor, agrowstitch_version, orthomosaic, model_task } = inferenceData;
            const versionDir = orthomosaic || agrowstitch_version;

            const response = await fetch(`${flaskUrl}update_traits_confidence_threshold`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date,
                    platform,
                    sensor,
                    agrowstitch_version: versionDir,
                    orthomosaic: versionDir,
                    confidence_threshold: confidenceThreshold,
                    model_task: model_task || 'detection'
                })
            });

            const result = await response.json();

            if (response.ok) {
                setAlertMessage(result.message);
                setAlertSeverity('success');
                setAlertOpen(true);
            } else {
                setAlertMessage(result.error || 'Failed to update confidence threshold');
                setAlertSeverity('error');
                setAlertOpen(true);
            }
        } catch (error) {
            console.error('Error updating confidence threshold:', error);
            setAlertMessage('Error updating confidence threshold');
            setAlertSeverity('error');
            setAlertOpen(true);
        } finally {
            setUpdatingThreshold(false);
        }
    };

    const handleRevertToOriginal = async () => {
        if (!inferenceData) return;

        setRevertingThreshold(true);

        try {
            const { date, platform, sensor, agrowstitch_version, orthomosaic } = inferenceData;
            const versionDir = orthomosaic || agrowstitch_version;

            const response = await fetch(`${flaskUrl}revert_traits_to_original`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    year: selectedYearGCP,
                    experiment: selectedExperimentGCP,
                    location: selectedLocationGCP,
                    population: selectedPopulationGCP,
                    date,
                    platform,
                    sensor,
                    agrowstitch_version: versionDir,
                    orthomosaic: versionDir
                })
            });

            const result = await response.json();

            if (response.ok) {
                setAlertMessage(result.message);
                setAlertSeverity('success');
                setAlertOpen(true);
            } else {
                setAlertMessage(result.error || 'Failed to revert to original');
                setAlertSeverity('error');
                setAlertOpen(true);
            }
        } catch (error) {
            console.error('Error reverting to original:', error);
            setAlertMessage('Error reverting to original');
            setAlertSeverity('error');
            setAlertOpen(true);
        } finally {
            setRevertingThreshold(false);
        }
    };

    const handleCloseAlert = () => {
        setAlertOpen(false);
    };

    if (!open || !inferenceData) return null;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth={false}
            fullScreen
            sx={{
                '& .MuiDialog-paper': {
                    margin: 0,
                    maxHeight: '100vh'
                }
            }}
        >
            <DialogTitle>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                    <Box>
                        <Typography variant="h6">
                            Inference Results - {inferenceData.date}
                        </Typography>
                        {(inferenceData.model_id || inferenceData.model_version) && (
                            <Typography variant="subtitle2" color="textSecondary">
                                Model: {inferenceData.model_id || 'Unknown'}
                                {inferenceData.model_version && ` v${inferenceData.model_version}`}
                                {(inferenceData.orthomosaic || inferenceData.agrowstitch_version) &&
                                    ` • Orthomosaic: ${inferenceData.orthomosaic || inferenceData.agrowstitch_version}`}
                            </Typography>
                        )}
                    </Box>
                    <IconButton onClick={onClose}>
                        <Close />
                    </IconButton>
                </Box>
            </DialogTitle>

            <DialogContent sx={{
                height: 'calc(100vh - 140px)',
                overflow: 'auto',
                p: 2
            }}>
                {loading && (
                    <Box display="flex" justifyContent="center" alignItems="center" height="400px">
                        <CircularProgress />
                    </Box>
                )}

                {!loading && plotImages.length > 0 && (
                    <Grid container spacing={2} sx={{ height: '100%' }}>
                        {/* Image Display */}
                        <Grid item xs={12} md={8} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                            <Paper elevation={2} sx={{ p: 1.5, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                                {/* Navigation Controls */}
                                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                                    <Box display="flex" alignItems="center" gap={2}>
                                        {/* Previous/Next Navigation */}
                                        <Box display="flex" alignItems="center" gap={1}>
                                            <IconButton
                                                onClick={handlePreviousPlot}
                                                disabled={currentPlotIndex === 0}
                                            >
                                                <ArrowBack />
                                            </IconButton>

                                            <Typography variant="body1">
                                                {currentPlotIndex + 1} of {plotImages.length}
                                            </Typography>

                                            <IconButton
                                                onClick={handleNextPlot}
                                                disabled={currentPlotIndex === plotImages.length - 1}
                                            >
                                                <ArrowForward />
                                            </IconButton>
                                        </Box>

                                        {/* Plot Selection Dropdown */}
                                        <FormControl size="small" sx={{ minWidth: 200 }}>
                                            <InputLabel>Select Plot</InputLabel>
                                            <Select
                                                value={plotImages[currentPlotIndex] || ''}
                                                onChange={handlePlotSelection}
                                                label="Select Plot"
                                            >
                                                {plotImages.map((fileName, index) => (
                                                    <MenuItem key={fileName} value={fileName}>
                                                        {getPlotDisplayName(fileName)}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                    </Box>

                                    <Box display="flex" alignItems="center" gap={1}>
                                        {/* Zoom Controls */}
                                        <IconButton onClick={handleZoomOut} disabled={zoom <= 0.1} title="Zoom Out">
                                            <ZoomOut />
                                        </IconButton>
                                        <IconButton onClick={handleFitScreen} title="Fit to Screen">
                                            <FitScreen />
                                        </IconButton>
                                        <IconButton onClick={handleResetToDefault} title="Reset to Default Zoom">
                                            <Refresh />
                                        </IconButton>
                                        <IconButton onClick={handleZoomIn} disabled={zoom >= (isAutoZoomed ? 5 : 3)} title="Zoom In">
                                            <ZoomIn />
                                        </IconButton>


                                        {/* Toggle Controls */}
                                        {!hasSegmentation && (
                                            <FormControlLabel
                                                control={
                                                    <Switch
                                                        checked={showBoundingBoxes}
                                                        onChange={(e) => setShowBoundingBoxes(e.target.checked)}
                                                    />
                                                }
                                                label="Show Boxes"
                                            />
                                        )}
                                        {hasSegmentation && (
                                            <FormControlLabel
                                                control={
                                                    <Switch
                                                        checked={showMasks}
                                                        onChange={(e) => setShowMasks(e.target.checked)}
                                                    />
                                                }
                                                label="Show Masks"
                                            />
                                        )}
                                        <FormControlLabel
                                            control={
                                                <Switch
                                                    checked={showConfidence}
                                                    onChange={(e) => setShowConfidence(e.target.checked)}
                                                />
                                            }
                                            label="Show Confidence"
                                        />
                                    </Box>
                                </Box>

                                {/* Image Container */}
                                <Box
                                    ref={imageContainerRef}
                                    position="relative"
                                    width="100%"
                                    flex="1"
                                    overflow="hidden"
                                    border="1px solid #ddd"
                                    display="flex"
                                    justifyContent="center"
                                    alignItems="center"
                                >
                                    {/* Loading Spinner Overlay */}
                                    {loadingImage && (
                                        <Box
                                            position="absolute"
                                            top="0"
                                            left="0"
                                            width="100%"
                                            height="100%"
                                            display="flex"
                                            justifyContent="center"
                                            alignItems="center"
                                            bgcolor="rgba(255, 255, 255, 0.8)"
                                            zIndex={20}
                                        >
                                            <CircularProgress size={60} />
                                        </Box>
                                    )}
                                    
                                    {currentImageUrl && (
                                        <>
                                            <img
                                                ref={imageRef}
                                                src={currentImageUrl}
                                                alt={`Plot ${getPlotNumber(plotImages[currentPlotIndex])}`}
                                                style={{
                                                    maxWidth: isAutoZoomed ? 'none' : '100%',
                                                    maxHeight: isAutoZoomed ? 'none' : '100%',
                                                    width: isAutoZoomed ? 'auto' : 'auto',
                                                    height: isAutoZoomed ? `${baseAutoZoom * zoom * imageDimensions.height}px` : 'auto',
                                                    objectFit: 'contain',
                                                    transform: isAutoZoomed
                                                        ? `translate(${-(Math.max(0, (baseAutoZoom * zoom * imageDimensions.width) - (imageContainerRef.current?.clientWidth || 0)) * (horizontalPanPercent - 50) / 50)}px, ${-(Math.max(0, (baseAutoZoom * zoom * imageDimensions.height) - (imageContainerRef.current?.clientHeight || 0)) * (verticalPanPercent - 50) / 50)}px)`
                                                        : `scale(${zoom}) translate(${panX / zoom}px, ${panY / zoom}px)`,
                                                    cursor: (isAutoZoomed || zoom > 1) ? (isDragging ? 'grabbing' : 'grab') : 'default',
                                                    userSelect: 'none', // Prevent text selection during drag
                                                    opacity: loadingImage ? 0.3 : 1,
                                                    transition: 'opacity 0.2s ease-in-out'
                                                }}
                                                onLoad={handleImageLoad}
                                                onMouseDown={handleMouseDown}
                                                onMouseMove={(e) => {
                                                    handleMouseMove(e);
                                                    handleCanvasMouseMove(e);
                                                }}
                                                onMouseUp={handleMouseUp}
                                                onMouseLeave={(e) => {
                                                    handleMouseUp();
                                                    handleCanvasMouseLeave();
                                                }}
                                                draggable={false} // Prevent default drag behavior
                                            />
                                            <canvas
                                                ref={canvasRef}
                                                style={{
                                                    position: 'absolute',
                                                    pointerEvents: 'none', // Changed to 'none' to allow dragging through canvas
                                                    zIndex: 10,
                                                    cursor: hoveredPrediction ? 'pointer' : 'default'
                                                }}
                                            />
                                        </>
                                    )}
                                </Box>

                                {/* Horizontal Pan Slider - Toggleable, shown as overlay or below image */}
                                {isAutoZoomed && imageDimensions.width > 0 && imageDimensions.height > 0 &&
                                    imageContainerRef.current && baseAutoZoom > 0 &&
                                    (baseAutoZoom * zoom * imageDimensions.width) > imageContainerRef.current.clientWidth && showPanSlider && (
                                        <Box
                                            px={1}
                                            sx={{
                                                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                                                borderRadius: 1,
                                                py: 1
                                            }}
                                        >
                                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                                                <Typography variant="body2">
                                                    Horizontal Pan
                                                </Typography>
                                                <Button
                                                    size="small"
                                                    onClick={() => setShowPanSlider(false)}
                                                    sx={{ minWidth: 'auto', p: 0.5 }}
                                                >
                                                    Hide
                                                </Button>
                                            </Box>
                                            <Slider
                                                value={horizontalPanPercent}
                                                onChange={(e, newValue) => {
                                                    setHorizontalPanPercent(newValue);
                                                    // Immediately update image styling and redraw canvas
                                                    requestAnimationFrame(() => {
                                                        updateImageStyle(zoom, newValue, panX, panY, verticalPanPercent);
                                                        if (isImageLoaded && (showBoundingBoxes || (showMasks && hasSegmentation) || showConfidence)) {
                                                            drawDetections();
                                                        }
                                                    });
                                                }}
                                                min={0}
                                                max={100}
                                                step={1}
                                                marks={[
                                                    { value: 0, label: 'Left' },
                                                    { value: 50, label: 'Center' },
                                                    { value: 100, label: 'Right' }
                                                ]}
                                                sx={{ width: '100%' }}
                                            />
                                        </Box>
                                    )}

                                {/* Show Pan Slider Button - when hidden */}
                                {isAutoZoomed && imageDimensions.width > 0 && imageDimensions.height > 0 &&
                                    imageContainerRef.current && baseAutoZoom > 0 &&
                                    (baseAutoZoom * zoom * imageDimensions.width) > imageContainerRef.current.clientWidth && !showPanSlider && (
                                        <Box display="flex" flexDirection="column" alignItems="center">
                                            <Typography variant="caption" color="textSecondary" mb={0.5}>
                                                💡 Drag image to pan around
                                            </Typography>
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                onClick={() => setShowPanSlider(true)}
                                            >
                                                Show Pan Slider
                                            </Button>
                                        </Box>
                                    )}
                            </Paper>
                        </Grid>

                        {/* Controls and Detection Info */}
                        <Grid item xs={12} md={4} sx={{ height: '100%', display: 'flex' }}>
                            <Paper
                                elevation={2}
                                sx={{
                                    p: 5,
                                    pr: 5, // Extra padding on right to prevent slider labels from being cut off
                                    width: '100%',
                                    overflow: 'auto',
                                    overflowX: 'hidden',
                                    boxSizing: 'border-box'
                                }}
                            >
                                <Typography variant="h6" gutterBottom>
                                    Detection Controls
                                </Typography>

                                {/* Confidence Threshold */}
                                <Box mb={2}>
                                    <Typography gutterBottom>
                                        Confidence Threshold: {Math.round(confidenceThreshold * 100)}%
                                    </Typography>
                                    <Slider
                                        value={confidenceThreshold}
                                        onChange={(e, newValue) => setConfidenceThreshold(newValue)}
                                        min={0}
                                        max={1}
                                        step={0.01}
                                        marks={[
                                            { value: 0, label: '0%' },
                                            { value: 0.5, label: '50%' },
                                            { value: 1, label: '100%' }
                                        ]}
                                    />

                                    {/* Confidence Threshold Update Buttons */}
                                    <Box display="flex" gap={1} mt={2} flexWrap="wrap">
                                        <Button
                                            variant="contained"
                                            size="small"
                                            onClick={handleUpdateConfidenceThreshold}
                                            disabled={updatingThreshold}
                                            sx={{ flex: '1 1 auto', minWidth: 0 }}
                                        >
                                            {updatingThreshold ? 'Updating...' : 'Update Threshold'}
                                        </Button>
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            onClick={handleRevertToOriginal}
                                            disabled={revertingThreshold}
                                            sx={{ flex: '1 1 auto', minWidth: 0 }}
                                        >
                                            {revertingThreshold ? 'Reverting...' : 'Revert'}
                                        </Button>
                                    </Box>
                                </Box>

                                {/* Class Legend */}
                                <Typography variant="h6" gutterBottom>
                                    Class Legend
                                </Typography>
                                <Box mb={2}>
                                    {Object.entries(classCounts).map(([className, count]) => (
                                        <Box key={className} display="flex" alignItems="center" mb={1}>
                                            <Box
                                                width={20}
                                                height={20}
                                                bgcolor={classColors[className]}
                                                mr={1}
                                                style={{ cursor: 'pointer' }}
                                                onClick={() => toggleClassVisibility(className)}
                                                border={selectedClasses.has(className) ? '2px solid black' : '2px solid transparent'}
                                            />
                                            <Chip
                                                label={`${className} (${count})`}
                                                size="small"
                                                onClick={() => toggleClassVisibility(className)}
                                                color={selectedClasses.has(className) ? 'primary' : 'default'}
                                                variant={selectedClasses.has(className) ? 'filled' : 'outlined'}
                                            />
                                        </Box>
                                    ))}
                                </Box>

                                {/* Detection Summary */}
                                <Typography variant="h6" gutterBottom>
                                    Detection Summary
                                </Typography>
                                <Typography variant="body2" gutterBottom>
                                    Total Detections: {predictions.length}
                                </Typography>
                                <Typography variant="body2" gutterBottom>
                                    Visible Detections: {predictions.filter(pred =>
                                        pred.confidence >= confidenceThreshold &&
                                        selectedClasses.has(pred.class)
                                    ).length}
                                </Typography>
                                <Typography variant="body2">
                                    Classes: {Object.keys(classCounts).length}
                                </Typography>
                                {/* Zoom Controls */}
                                <Box mt={2}>
                                    <Typography gutterBottom>
                                        Zoom: {Math.round((isAutoZoomed ? baseAutoZoom * zoom : zoom) * 100)}%
                                    </Typography>
                                    {(isAutoZoomed || zoom > 1) && (
                                        <Typography variant="body2" color="textSecondary" gutterBottom>
                                            Click and drag to pan around the image
                                        </Typography>
                                    )}
                                    <Slider
                                        value={zoom}
                                        onChange={handleZoomChange}
                                        min={0.1}
                                        max={isAutoZoomed ? 5 : 3}
                                        step={0.01}
                                        marks={isAutoZoomed ? [
                                            { value: 0.5, label: '50%' },
                                            { value: 1, label: '100%' },
                                            { value: 2, label: '200%' },
                                            { value: 3, label: '300%' }
                                        ] : [
                                            { value: 0.5, label: '50%' },
                                            { value: 1, label: '100%' },
                                            { value: 2, label: '200%' }
                                        ]}
                                    />

                                    {/* Keyboard Shortcuts Help */}
                                    <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                                        <strong>Keyboard shortcuts:</strong> ← → (navigate), +/- (zoom), 0 (fit), R (reset), ESC (close), Mouse wheel (zoom)
                                    </Typography>
                                </Box>
                            </Paper>
                        </Grid>
                    </Grid>

                )}

                {!loading && plotImages.length === 0 && (
                    <Box textAlign="center" py={4}>
                        <Typography variant="body1" color="textSecondary">
                            No plot images found for the selected inference results.
                        </Typography>
                    </Box>
                )}
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose} variant="contained">
                    Close
                </Button>
            </DialogActions>

            {/* Success/Error Alert */}
            <Snackbar
                open={alertOpen}
                autoHideDuration={4000}
                onClose={handleCloseAlert}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert
                    onClose={handleCloseAlert}
                    severity={alertSeverity}
                    sx={{ width: '100%' }}
                >
                    {alertMessage}
                </Alert>
            </Snackbar>
        </Dialog>
    );
};

export default InferenceResultsPreview;
