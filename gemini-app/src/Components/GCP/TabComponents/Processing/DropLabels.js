import React, { useCallback } from 'react';
import {
    Dialog,
    DialogTitle,
    Box,
    Typography,
    Button
} from "@mui/material";
import { useDropzone } from 'react-dropzone';
import { fetchData, useDataSetters, useDataState } from "../../../../DataContext";

function LabelsMenu({ open, onClose, item, activeTab, platform, sensor }) {

    // data states
    const { 
        isUploadingLabels,
        selectRoverTrait,
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedYearGCP,
        selectedExperimentGCP,
        flaskUrl,
        processRunning
    } = useDataState();
    const { setIsUploadingLabels, setProcessRunning } = useDataSetters();
    const [acceptedAnnotations, setAcceptedAnnotations] = React.useState([]);

    const onDropAnnotations = useCallback(acceptedFiles => {
        // Handle file objects for images here
        // console.log('Annotations:', acceptedFiles);
        setAcceptedAnnotations(acceptedFiles);
    }, []);

    // Define base style for dropzone
    const baseStyle = {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '20px',
        borderWidth: 2,
        borderRadius: 2,
        borderColor: '#000000',
        borderStyle: 'dashed',
        backgroundColor: '#eeeeee',
        color: '#000000',
        outline: 'none',
        transition: 'border .24s ease-in-out',
        width: '200px', 
        height: '50px', 
      };

    // Accepted file types
    const annotationTypes = {
        'image/jpg': ['.jpg', '.jpeg', '.png'],
        'text/txt': ['.txt']
    }

    const { getRootProps: getRootPropsAnnotations, getInputProps: getInputPropsAnnotations } = useDropzone({ onDrop: onDropAnnotations, accept: annotationTypes });

    const handleClose = () => {
        if (!isUploadingLabels) {
            setAcceptedAnnotations([]);
            onClose();
        };
    }

    const buttonStyle = {
        background: processRunning ? "grey" : "#1976d2",
        color: "white",
        borderRadius: "4px",
    };

    const handleUploadLabels = async () => {
        
        try {
            setIsUploadingLabels(true);
            setProcessRunning(true);
            const payload = {
                location: selectedLocationGCP,
                population: selectedPopulationGCP,
                year: selectedYearGCP,
                experiment: selectedExperimentGCP,
                annotations: acceptedAnnotations,
                date: item.date,
                platform: platform,
                sensor: sensor
            };
            console.log("Payload:", payload);

            if (activeTab === 0) {
                payload.trait = "Plant";
            // } else if (activeTab === 2) {
            //     payload.trait = selectRoverTrait;
            //     payload.date = selections.date;
            //     payload.platform = selections.platform;
            //     payload.sensor = selections.sensor;
            }

            const response = await fetch(`${flaskUrl}prepare_labels`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
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
        } finally {
            setProcessRunning(false);
            setIsUploadingLabels(false);
        }
    };

    return (
        <Dialog open={open} onClose={handleClose}>
            <DialogTitle>Insert Annotations</DialogTitle>
            <Typography variant="body1" style={{ textAlign: 'center', paddingBottom: '10px', paddingLeft: '20px', paddingRight: '20px' }}>
                Please insert the required annotations below.<br />
                The labels should be in YOLO format.
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'space-around', padding: '10px' }}>
                <div {...getRootPropsAnnotations({ className: 'dropzone', style: baseStyle })}>
                    <input {...getInputPropsAnnotations()} />
                    <p>{acceptedAnnotations.length > 0 ? "Complete" : "Insert Annotations"}</p>
                </div>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'center', paddingBottom: '10px' }}>
                <Button
                    onClick={handleUploadLabels}
                    style={{buttonStyle}}
                    disabled={processRunning}
                >
                    Prepare
                </Button>
            </Box>
        </Dialog>
    );
}

export { LabelsMenu };