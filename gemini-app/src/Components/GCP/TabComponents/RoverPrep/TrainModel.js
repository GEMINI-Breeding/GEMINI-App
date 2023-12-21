import React from 'react';
import {
    Accordion,
    AccordionSummary,
    AccordionDetails,
    TextField,
    Typography,
    Grid,
    Button,
    Dialog,
    DialogTitle,
    Select,
    MenuItem,
    InputLabel,
    FormControl
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { fetchData, useDataState } from '../../../../DataContext';

function TrainMenu({ open, onClose, locateDate, activeTab, sensor }) {

    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        flaskUrl,
    } = useDataState();

    // State variables
    const [epochs, setEpochs] = React.useState(100);
    const [batchSize, setBatchSize] = React.useState(32);
    const [imageSize, setImageSize] = React.useState(640);

    const handleTrainModel = async () => {
        try {
            const payload = {
                epochs: epochs,
                batchSize: batchSize,
                imageSize: imageSize,
                location: selectedLocationGCP,
                population: selectedPopulationGCP,
                date: locateDate,
                sensor: sensor
            }

            if (activeTab === 0) {
                payload.trait = 'plant';
            }

            const response = await fetch(`${flaskUrl}train_model`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const data = await response.json();
                console.log("Response from server:", data);
            } else {
                const errorData = await response.json();
                console.error("Error details:", errorData);
            }
        } catch (error) {
            console.error("There was an error sending the request", error);
        }
    };

    return (
        <Dialog open={open} onClose={onClose}>
            <DialogTitle>Training</DialogTitle>
            <Grid container spacing={2} justifyContent="center" style={{ padding: '16px' }}>
                <Button 
                    onClick={handleTrainModel}
                    style={{
                        backgroundColor: "#1976d2",
                        color: "white",
                        borderRadius: "4px",
                        marginTop: "10px",
                    }}
                >
                    Train Model
                </Button>
            </Grid>

            <AdvancedMenu 
                epochs={epochs} setEpochs={setEpochs}
                batchSize={batchSize} setBatchSize={setBatchSize}
                imageSize={imageSize} setImageSize={setImageSize}
            />
        </Dialog>
    );
}

function AdvancedMenu({ epochs, setEpochs, batchSize, setBatchSize, imageSize, setImageSize }) {

    const handleEpochsChange = (event) => {
        setEpochs(event.target.value);
    };

    const handleBatchSizeChange = (event) => {
        setBatchSize(event.target.value);
    };

    const handleImageSizeChange = (event) => {
        setImageSize(event.target.value);
    };

    const resetToDefault = () => {
        setEpochs(100);
        setBatchSize(32);
        setImageSize(640);
    };

    return (
        <Accordion>
            <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                aria-controls="advanced-content"
                id="advanced-header"
            >
                <Typography>Advanced</Typography>
            </AccordionSummary>
            <AccordionDetails>
                <Grid container spacing={2} alignItems="center">
                    {/* Epochs Dropdown */}
                    <Grid item xs={4}>
                        <FormControl fullWidth>
                            <InputLabel>Epochs</InputLabel>
                            <Select value={epochs} label="Epochs" onChange={handleEpochsChange}>
                                <MenuItem value={50}>50</MenuItem>
                                <MenuItem value={100}>100</MenuItem>
                                <MenuItem value={150}>150</MenuItem>
                                <MenuItem value={200}>200</MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>

                    {/* Batch Size Dropdown */}
                    <Grid item xs={4}>
                        <FormControl fullWidth>
                            <InputLabel>Batch Size</InputLabel>
                            <Select value={batchSize} label="Batch Size" onChange={handleBatchSizeChange}>
                                <MenuItem value={16}>16</MenuItem>
                                <MenuItem value={32}>32</MenuItem>
                                <MenuItem value={64}>64</MenuItem>
                                <MenuItem value={128}>128</MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>

                    {/* Image Size Dropdown */}
                    <Grid item xs={4}>
                        <FormControl fullWidth>
                            <InputLabel>Image Size</InputLabel>
                            <Select value={imageSize} label="Image Size" onChange={handleImageSizeChange}>
                                <MenuItem value={320}>320</MenuItem>
                                <MenuItem value={640}>640</MenuItem>
                                <MenuItem value={1280}>1280</MenuItem>
                            </Select>
                        </FormControl>
                    </Grid>

                    {/* Default Button */}
                    <Grid item xs={12}>
                        <Button 
                            onClick={resetToDefault}
                            style={{
                                color: "gray", // Gray text
                                borderColor: "gray", // Gray border
                                borderWidth: "1px",
                                borderStyle: "solid",
                                backgroundColor: "white", // White background
                                borderRadius: "4px",
                                marginTop: "10px"
                            }}
                        >
                            Default
                        </Button>
                    </Grid>
                </Grid>
            </AccordionDetails>
        </Accordion>
    );
}

export { TrainMenu, AdvancedMenu };
