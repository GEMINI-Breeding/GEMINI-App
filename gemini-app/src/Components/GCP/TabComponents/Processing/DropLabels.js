import React, { useRef ,useState, useCallback } from 'react';
import {
    Dialog,
    DialogTitle,
    Box,
    Typography,
    Button,
    LinearProgress,
    CircularProgress
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
        processRunning,
        roverPrepTab
    } = useDataState();
    const { setIsUploadingLabels, setProcessRunning } = useDataSetters();
    const [acceptedAnnotations, setAcceptedAnnotations] = useState([]);
    const [uploadNewFilesOnly, setUploadNewFilesOnly] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0); 
    const cancelUploadRef = useRef(false);
    const [isSettingUpServer, setIsSettingUpServer] = useState(false);

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
            setProcessRunning(false);
            setIsUploadingLabels(false);
            setAcceptedAnnotations([]);
            setUploadProgress(0);
            onClose();
        };
    }

    const handleCancelUpload = async () => {
        try{
            console.log("Upload canceled.");
            cancelUploadRef.current = true;
            setProcessRunning(false);
            setIsUploadingLabels(false);
            setAcceptedAnnotations([]);
            setUploadProgress(0);
        } catch (error) {
            console.error("Error:", error);
        }
    };
    
    // Function to check for existing files on the server
    const checkFilesOnServer = async (fileList, dirPath) => {
        console.log("Checking files on server.")
        const response = await fetch(`${flaskUrl}check_existing_labels`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dirPath, fileList }),
        });
        return response.json();
    };

    // Function to upload a file with a timeout
    const uploadFileWithTimeout = async (file, dirPath, timeout = 10000) => {
        const formData = new FormData();
        formData.append("files", file);
        formData.append("dirPath", dirPath);
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(`${flaskUrl}upload_trait_labels`, {
                method: "POST",
                body: formData,
                signal: controller.signal,
            });
            clearTimeout(id);
            return response;
        } catch (error) {
            clearTimeout(id);
            throw error;
        }
    };

    const handleUploadLabels = async () => {
        
        try {
            console.log("Uploading labels...")
            setIsUploadingLabels(true);
            setProcessRunning(true);
            cancelUploadRef.current = false;

            // Construct directory path for the labels
            let trait = ''
            if (roverPrepTab === 0) {
                trait = 'Plant';
            } else {
                trait = selectRoverTrait;
            }
            const dirPath = `Intermediate/${selectedYearGCP}/${selectedExperimentGCP}/${selectedLocationGCP}/${selectedPopulationGCP}/${item.date}/${platform}/${sensor}/Labels/${trait} Detection/annotations`;

            // Check which files need to be uploaded
            const fileList = acceptedAnnotations.map((file) => file.name);
            // const filesToUpload = await checkFilesOnServer(fileList, dirPath);
            const filesToUpload = fileList; // for now it will replace them

            // Upload the files
            const maxRetries = 3;
            for (let i = 0; i < filesToUpload.length; i++) {
                let retries = 0;
                while (retries < maxRetries) {
                    try {
                        if (cancelUploadRef.current) {
                            break;
                        }

                        const file = acceptedAnnotations.find((f) => f.name === filesToUpload[i]);
                        await uploadFileWithTimeout(file, dirPath);
                        setUploadProgress(((i + 1) / filesToUpload.length) * 100);
                        break;
                    } catch (error) {
                        if (retries === maxRetries - 1) {
                            alert(`Failed to upload file: ${filesToUpload[i]}`);
                            setProcessRunning(false)
                            setIsUploadingLabels(false);
                            setAcceptedAnnotations([]);
                            setUploadProgress(0);
                            break;
                        }
                        retries++;
                        }
                }
            }

        } catch (error) {
            console.error("There was an error sending the request", error);
        } finally {
            setProcessRunning(false);
            setIsUploadingLabels(false);
            setAcceptedAnnotations([]);
            setUploadProgress(0);
        }
    };

    // Function to open CVAT annotation tool in a new tab
    const handleOpenAnnotateTab = async () => {
        setIsSettingUpServer(true); // Start loading

        // call flask endpoint
        try {
            const response = await fetch(`${flaskUrl}start_cvat`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            });

            if (response.ok) {
                const data = await response.json();
                console.log(data.status);

                // Open CVAT instance
                window.open("http://localhost:8080/", "_blank");
            } else {
                const errorData = await response.json();
                console.error("Error starting CVAT:", errorData.error);
                alert(`Error starting CVAT: ${errorData.error}`);
            }
        } catch (error) {
            console.error("Error:", error);
            alert("An error occurred while starting CVAT.");
        } finally {
            setIsSettingUpServer(false); // Stop loading
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
                    <p>{acceptedAnnotations.length > 0 ? `${acceptedAnnotations.length} files` : "Insert Annotations"}</p>
                </div>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'center', paddingBottom: '10px' }}>
                <Button
                    onClick={isUploadingLabels ? handleCancelUpload : handleUploadLabels}
                    style={{
                        backgroundColor: isUploadingLabels ? "red" : "#1976d2",
                        color: "white",
                        borderRadius: "4px",
                    }}
                >
                    {isUploadingLabels ? "Cancel" : "Upload"}
                </Button>
                <Button
                    onClick={handleOpenAnnotateTab}
                    style={{
                        marginLeft: '10px',
                        backgroundColor: "#4CAF50",
                        color: "white",
                        borderRadius: "4px",
                    }}
                    disabled={isSettingUpServer} // Disable button while loading
                >
                    {isSettingUpServer ? <CircularProgress size={24} style={{ color: "white" }} /> : "Annotate"}
                </Button>
            </Box>
            {isUploadingLabels && (
                <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center" }}>
                    <Box sx={{ width: "100%", padding: '10px' }}>
                        {uploadProgress > 0 && <LinearProgress variant="determinate" value={uploadProgress} />}
                    </Box>
                    <Box sx={{ minWidth: 35, mr: 1 }}>
                        <Typography variant="body2" color="text.secondary">{`${Math.round(uploadProgress)}%`}</Typography>
                    </Box>
                </Box>
            )}
        </Dialog>
    );
}

export { LabelsMenu };