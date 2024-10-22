import React, { useEffect, useState } from 'react';
import { Box, Typography, Switch, LinearProgress, Button, MenuItem, Select, FormControl } from '@mui/material';
import { useDataState, useDataSetters } from "../../DataContext";
import ImageIcon from '@mui/icons-material/Image';
import { ImagePreviewer } from '../Menu/ImagePreviewer';
import Alert from '@mui/material/Alert';

const GroundT4OrthophotoDialog = () => {
    const {
        flaskUrl,
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedYearGCP,
        selectedExperimentGCP,
        selectedDateGCP,
        selectedPlatformGCP,
        selectedSensorGCP
    } = useDataState();

    const {
        setSelectedDateGCP,
        setSelectedPlatformGCP,
        setSelectedSensorGCP
    } = useDataSetters();

    const [oddBed, setOddBed] = useState(false);
    const [progress, setProgress] = useState(0);
    const [orthoGenerated, setOrthoGenerated] = useState(false);
    const [orthoGenerating, setOrthoGenerating] = useState(false);

    const [dates, setDates] = useState([]);
    const [platforms, setPlatforms] = useState([]);
    const [sensors, setSensors] = useState([]);
    const [selectedDate, setSelectedDate] = useState('');
    const [selectedPlatform, setSelectedPlatform] = useState('');
    const [selectedSensor, setSelectedSensor] = useState('');

    const [showIP, setShowIP] = useState(false);
    const [objData, setObjData] = useState(null);
    const [orthoDone, setOrthoDone] = useState(false);

    useEffect(() => {
        setOrthoDone(false);
        setOrthoGenerated(false);
        setOrthoGenerating(false);
        setOddBed(false);
        fetchDates();
    }, [selectedPopulationGCP]);

    const fetchDates = async () => {
        try {
            const response = await fetch(`${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}`);
            const data = await response.json();
            console.log(data);
            setDates(data);
        } catch (error) {
            console.error("Error fetching dates:", error);
        }
    };

    const handleDateChange = async (event) => {
        const date = event.target.value;
        setSelectedDate(date);
        console.log(date);
        setSelectedDateGCP(date);
        if (date != "") {
            fetchPlatforms(date);
        }
    };

    const fetchPlatforms = async (date) => {
        try {
            const response = await fetch(`${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}`);
            const data = await response.json();
            setPlatforms(data); // Adjust according to the response structure
        } catch (error) {
            console.error("Error fetching platforms:", error);
        }
    };

    const handlePlatformChange = async (event) => {
        const platform = event.target.value;
        setSelectedPlatform(platform);
        setSelectedPlatformGCP(platform);
        if (platform != "") {
            fetchSensors(selectedDate, platform);
        }
    };

    const fetchSensors = async (date, platform) => {
        try {
            const response = await fetch(`${flaskUrl}list_dirs/Raw/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${date}/${platform}`);
            const data = await response.json();
            setSensors(data); // Adjust according to the response structure
        } catch (error) {
            console.error("Error fetching sensors:", error);
        }
    };

    const handleSensorChange = (event) => {
        const sensor = event.target.value;
        setSelectedSensor(sensor);
        setSelectedSensorGCP(sensor);
    };

    const handleToggle = () => {
        setOddBed(!oddBed);
    };

    const showImagePreviewer = () => {
        const obj = {
            location: selectedLocationGCP,
            population: selectedPopulationGCP,
            date: selectedDateGCP,
            year: selectedYearGCP,
            experiment: selectedExperimentGCP,
            sensor: selectedSensorGCP,
            platform: selectedPlatformGCP
        };
        setObjData(obj);
        setShowIP(true);
    }

    const handleStart = async () => {
        setOrthoGenerating(true);
        setProgress(0);
    
        const requestData = {
            location: selectedLocationGCP,
            population: selectedPopulationGCP,
            date: selectedDate,
            year: selectedYearGCP,
            experiment: selectedExperimentGCP,
            platform: selectedPlatform,
            sensor: selectedSensor,
            direction: oddBed ? 'true' : 'false'
        };
    
        try {
            const response = await fetch(`${flaskUrl}ground_based_ortho_t4`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(requestData),
            });
    
            if (!response.ok) {
                throw new Error("Error generating ortho");
            }
    
            const interval = setInterval(async () => {
                try {
                    const progressResponse = await fetch(`${flaskUrl}get_t4_ortho_progress`);
                    if (!progressResponse.ok) {
                        throw new Error("Error fetching progress");
                    }
                    const progressData = await progressResponse.json();
                    console.log("Progress:", progressData.progress);
                    setProgress(progressData.progress);
    
                    if (progressData.progress >= 100 || response.ok) {
                        clearInterval(interval);
                        setOrthoGenerating(false);
                        setOrthoDone(true);
                    }
                } catch (error) {
                    console.error("Error fetching progress:", error);
                    clearInterval(interval);
                }
            }, 5000);
    
        } catch (error) {
            console.error("Error starting orthophoto generation:", error);
            setOrthoGenerating(false);
        }
    };
//, flexDirection: 'row', justifyContent: 'space-around'
    return (<>
        {selectedPopulationGCP && <div>
        <Box sx={{ display: 'flex'}}> 
            <Box sx={{ marginRight: 2 }}>
                <FormControl fullWidth sx={{ mb: 2 }}>
                    <Select
                        value={selectedDate}
                        onChange={handleDateChange}
                        displayEmpty
                        placeholder="Select Date"
                    >
                        <MenuItem value="" disabled>Select Date</MenuItem>
                        {dates.map((date) => (
                            <MenuItem key={date} value={date}>{date}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <FormControl fullWidth sx={{ mb: 2 }} disabled={!selectedDate}>
                    <Select
                        value={selectedPlatform}
                        onChange={handlePlatformChange}
                        displayEmpty
                        placeholder="Select Platform"
                    >
                        <MenuItem value="" disabled>Select Platform</MenuItem>
                        {platforms.map((platform) => (
                            <MenuItem key={platform} value={platform}>{platform}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <FormControl fullWidth sx={{ mb: 2 }} disabled={!selectedPlatform}>
                    <Select
                        value={selectedSensor}
                        onChange={handleSensorChange}
                        displayEmpty
                        placeholder="Select Sensor"
                    >
                        <MenuItem value="" disabled>Select Sensor</MenuItem>
                        {sensors.map((sensor) => (
                            <MenuItem key={sensor} value={sensor}>{sensor}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Box>
            {selectedDate && selectedPlatform && selectedSensor && (
                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        padding: 2,
                        width: '60vw',
                        //height: '35vw',
                        border: '1px solid rgba(0, 0, 0, 0.12)',
                        borderRadius: 2,
                        boxShadow: 2,
                        backgroundColor: 'white',
                    }}
                >
                    {orthoDone && (
                        <div style={{ marginBottom: '10px' }}>
                            <Alert severity="success">Orthophoto Successfully Generated.</Alert>
                        </div>
                    )}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="h6">Generate T4 Ground-based Orthophoto</Typography>
                        <Button
                            variant="outlined"
                            startIcon={<ImageIcon />}
                            onClick={showImagePreviewer} // Call showImagePreviewer need to write
                        >
                            View Images
                        </Button>
                    </Box>
                    {/* <Typography variant="h7">Selected Date: \t {selectedDate}</Typography>
                    <Typography variant="h7">Selected Platform: \t {selectedPlatform}</Typography>
                    <Typography variant="h7">Selected Sensor: \t {selectedSensor}</Typography> */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', marginTop: 5}}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="h7">Selected Date:</Typography>
                            <Typography variant="h7" sx={{ fontWeight: 'bold' }}>{selectedDate}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="h7">Selected Platform:</Typography>
                            <Typography variant="h7" sx={{ fontWeight: 'bold' }}>{selectedPlatform}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="h7">Selected Sensor:</Typography>
                            <Typography variant="h7" sx={{ fontWeight: 'bold' }}>{selectedSensor}</Typography>
                        </Box>
                    </Box>
                    {/* <Box sx={{ marginTop: 2 }}>
                        <Typography>Odd Bed:</Typography>
                        <Switch checked={oddBed} onChange={handleToggle} />
                        <Typography>{oddBed ? 'Odd' : 'Even'}</Typography>
                    </Box> */}
                    <Box sx={{ marginTop: 2, display: 'flex', alignItems: 'center' }}>
                        <Switch checked={oddBed} onChange={handleToggle} />
                        <Typography sx={{ marginLeft: 1, marginRight: 1 }}>
                            Odd Bed:
                        </Typography>
                        <Typography>
                            {oddBed ? 'Odd' : 'Even'}
                        </Typography>
                    </Box>
                    <Box sx={{ marginTop: 2 }}>
                        <LinearProgress variant="determinate" value={progress} />
                    </Box>
                    <Box sx={{ marginTop: 2, display: 'flex', justifyContent: 'flex-end' }}>
                        <Button onClick={handleStart} color="primary">Start Generation</Button>
                    </Box>
                </Box>
            )}
        </Box>
        <ImagePreviewer
            open={showIP}
            obj={objData}
            onClose={() => setShowIP(false)}
        /> 
        </div>}</>
    );
};

export default GroundT4OrthophotoDialog;
