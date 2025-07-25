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
    Paper
} from '@mui/material';
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import CloseIcon from "@mui/icons-material/Close";
import { useDataState } from "../../DataContext";

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
    const [currentImagePlotIndex, setCurrentImagePlotIndex] = useState(null);
    const [startImageName, setStartImageName] = useState(null);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [markedPlots, setMarkedPlots] = useState([]);
    const [originalPlotIndex, setOriginalPlotIndex] = useState(null);

    const theme = useTheme();
    const drawerWidth = 400;

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

    useEffect(() => {
        if (directory) {
            fetchImages();
            fetchMarkedPlots();
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
                console.log("Current Image Plot Index:", data.plot_index);
            } else {
                console.error("Failed to fetch plot index:", data.error);
                setCurrentImagePlotIndex(null);
            }
        } catch (error) {
            console.error("Error fetching plot index:", error);
            setCurrentImagePlotIndex(null);
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
                }),
            });

            if (response.ok) {
                fetchMarkedPlots(); // Refresh plot list
                if (originalPlotIndex !== null) {
                    setPlotIndex(originalPlotIndex);
                    setOriginalPlotIndex(null);
                } else {
                    const newPlotIndex = plotIndex + 1;
                    setPlotIndex(newPlotIndex);
                    onPlotIndexChange(newPlotIndex);
                }
                setPlotSelectionState('start');
                setStartImageName(null);
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
            setIsPanelOpen(false);
        } else {
            console.error("Start image for the plot not found in the image list.");
        }
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
                <Box
                    component="main"
                    sx={{
                        flexGrow: 1,
                        p: 3,
                        display: 'flex',
                        flexDirection: 'column',
                        transition: theme.transitions.create('margin', {
                            easing: theme.transitions.easing.sharp,
                            duration: theme.transitions.duration.leavingScreen,
                        }),
                        marginRight: `-${drawerWidth}px`,
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
                        <Typography variant="h6" style={{ position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)', zIndex: 10 }}>
                            Plot Index: {plotIndex}
                        </Typography>
                        <Button
                            variant="contained"
                            onClick={() => setIsPanelOpen(true)}
                            style={{
                                position: "absolute",
                                top: "10px",
                                right: "10px",
                                zIndex: 10,
                            }}
                        >
                            Marked Plots
                        </Button>
                    </DialogTitle>
                    <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', flexGrow: 1, minHeight: 0 }}>
                        <Typography variant="h6" style={{ marginBottom: '10px' }}>
                            Match the mid line with the start / end of the plot.
                        </Typography>
                        {imageViewerLoading ? (
                            <CircularProgress />
                        ) : (
                            <Box
                                sx={{
                                    position: 'relative',
                                    width: '100%',
                                    flexGrow: 1,
                                    overflow: 'hidden',
                                }}
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
                            </Box>
                        )}
                        <Typography>
                            Image Plot Index: {currentImagePlotIndex === -1 || currentImagePlotIndex === null ? "None" : currentImagePlotIndex}
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
            <Dialog open={stitchDirectionDialogOpen} onClose={() => setStitchDirectionDialogOpen(false)}>
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
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setStitchDirectionDialogOpen(false)}>Cancel</Button>
                    <Button onClick={() => handleStitchDirectionSelection(stitchDirection)} color="primary" disabled={!stitchDirection}>
                        Confirm
                    </Button>
                </DialogActions>
            </Dialog>
        </Dialog>
    );
};