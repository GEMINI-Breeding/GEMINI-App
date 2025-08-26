import React, { useState, useEffect, useRef } from "react";
import {
    Autocomplete,
    TextField,
    Button,
    CircularProgress,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Paper,
    Typography,
    Grid,
    FormControlLabel,
    Switch,
    LinearProgress,
    Tabs,
    Tab,
} from "@mui/material";
import { useDropzone } from "react-dropzone";
import { useFormik } from "formik";
import { useDataState, useDataSetters } from "../../DataContext";
import useTrackComponent from "../../useTrackComponent";
import dataTypes from "../../uploadDataTypes.json";
import Box from "@mui/material/Box";
import { TableComponent } from "./TableComponent";

// Helper function to map file types to human-readable descriptions
const getFileTypeDescription = (fileType) => {
    const typeMap = {
        "image/*": "Image files",
        ".csv": "CSV files",
        ".txt": "Text files",
        ".bin/*": "Binary files",
        "*": "All files",
        // Add more mappings as needed
    };
    return typeMap[fileType] || fileType;
};

/**
 * FileUploadComponent - React component for file uploading with form fields.
 */
const FileUploadComponent = () => {
    useTrackComponent("FileUploadComponent");

    // State hooks for various component states
    const { flaskUrl, extractingBinary } = useDataState();
    const { setExtractingBinary } = useDataSetters();
    const [isLoading, setIsLoading] = useState(false);
    const [nestedDirectories, setNestedDirectories] = useState({});
    const [selectedDataType, setSelectedDataType] = useState("image");
    const [files, setFiles] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [isFinishedUploading, setIsFinishedUploading] = useState(false);
    const [noFilesToUpload, setNoFilesToUpload] = useState(true);
    const [badFileType, setBadFileType] = useState(false);
    const [failedUpload, setFailedUpload] = useState(false);
    const [progress, setProgress] = useState(0);
    const [uploadNewFilesOnly, setUploadNewFilesOnly] = useState(false);
    const cancelUploadRef = useRef(false);
    const [currentInputValues, setCurrentInputValues] = useState({});
    const [dirPath, setDirPath] = useState("");
    const [actionType, setActionType] = useState('upload');
    const {
        uploadedData
    } = useDataState();

    const {
        setUploadedData
    } = useDataSetters();
    useEffect(() => {
        console.log(selectedDataType);
    }, [selectedDataType]);

    useEffect(() => {

        if (extractingBinary) {
        
            const intervalId = setInterval(async () => {
                    const processedFilesCount = await getBinaryProgress(dirPath);
                    let prog_calc = Math.round((processedFilesCount / files.length) * 100);
                    setProgress(prog_calc);

                    if (prog_calc >= 100) {
                        setIsFinishedUploading(true);
                        setUploadedData(true);
                        setIsUploading(false);
                    }
                }, 1000);
            
            return () => clearInterval(intervalId);
        }
    }, [extractingBinary, dirPath, files.length]);

    useEffect(() => {
        if (!extractingBinary) return;
    
        const intervalId = setInterval(async () => {
            try {
                const response = await fetch(`${flaskUrl}get_binary_status`);
                const { status } = await response.json();
    
                if (status === "failed") {
                    setIsFinishedUploading(true);
                    setFailedUpload(true);
                    setIsUploading(false);
                    clearInterval(intervalId);
                }
            } catch (error) {
                console.error("Error fetching binary status:", error);
            }
        }, 1000);
    
        return () => clearInterval(intervalId);
    }, [extractingBinary]);
    
    // Effect to fetch nested directories on component mount
    useEffect(() => {
        setIsLoading(true);
        setUploadedData(true);
        fetch(`${flaskUrl}list_dirs_nested`)
            .then((response) => response.json())
            .then((data) => {
                setNestedDirectories(data);
                setIsLoading(false);
            })
            .catch((error) => {
                console.error("Error fetching nested directories:", error);
                setIsLoading(false);
                setUploadedData(false);
            });
    }, [flaskUrl]);

    // Function to check for existing files on the server
    const checkFilesOnServer = async (fileList, localDirPath) => {
        const response = await fetch(`${flaskUrl}check_files`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileList, localDirPath }),
        });
        return response.json();
    };

    // Function to upload a file with a timeout
    const uploadFileWithTimeout = async (file, localDirPath, dataType, timeout = 30000) => {
        const formData = new FormData();
        formData.append("files", file);
        formData.append("dirPath", localDirPath);
        formData.append("dataType", dataType);
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(`${flaskUrl}upload`, {
                method: "POST",
                body: formData,
                signal: controller.signal,
            });
            console.log(response)
            clearTimeout(id);
            return response;
        } catch (error) {
            console.log("Upload error:", error);
            clearTimeout(id);
            throw error;
        }
    };

    const uploadChunkWithoutTimeout = async (chunk, index, totalChunks, fileIdentifier, localDirPath) => {
        const formData = new FormData();
        formData.append("fileChunk", chunk);
        formData.append("chunkIndex", index);
        formData.append("totalChunks", totalChunks);
        formData.append("fileIdentifier", fileIdentifier);
        formData.append("dirPath", localDirPath);

        try {
            const response = await fetch(`${flaskUrl}upload_chunk`, {
                method: "POST",
                body: formData
                // No `signal` = no timeout or abort controller
            });
            return response;
        } catch (error) {
            console.log("Upload error:", error);
            throw error;
        }
    };

    const getBinaryProgress = async (localDirPath) => {
        try {
            const response = await fetch(`${flaskUrl}get_binary_progress`,
                {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ localDirPath }),
          }
            );
          if (response.ok) {
            const data = await response.json();
            return data.progress;
          } else {
            console.error("Failed to fetch progress");
            return 0;
          }
        } catch (error) {
            console.error("Error reading text file:", error);
            return 0; // Return 0 if there's an error
        }
    };

    const extractBinaryFiles = async (files, localDirPath) => {
        setExtractingBinary(true);

        try {
            const response = await fetch(`${flaskUrl}extract_binary_file`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ files, localDirPath }),
            });

            if (response.ok) {
                console.log("Binary file extraction started");
                const result = await response.json();
                console.log("Extraction started");
            } else {
                console.error("Failed to extract binary file");
                setIsFinishedUploading(true);
                setFailedUpload(true);

                // If extraction fails, clear the directory
                clearDirPath();
            }
        } catch (error) {
            console.error("Error extracting binary file:", error);
            setIsFinishedUploading(true);
            setFailedUpload(true);

            // If extraction fails, clear the directory
            clearDirPath();
        }
    };

    const uploadFileChunks = async (file, localDirPath, uploadLength, fileIndex, totalFiles) => {
        // Increase chunk size for faster upload (e.g., 4MB)
        const chunkSize = 4 * 1024 * 1024;
        const totalChunks = Math.ceil(file.size / chunkSize);
        const fileIdentifier = file.name;

        const uploadedChunks = await checkUploadedChunks(fileIdentifier, localDirPath);
        console.log("Uploaded chunks:", uploadedChunks);

        // Sequential upload - upload one chunk at a time
        for (let current = uploadedChunks; current < totalChunks; current++) {
            if (cancelUploadRef.current) break;
            
            const chunk = file.slice(current * chunkSize, (current + 1) * chunkSize);
            try {
                await uploadChunkWithoutTimeout(chunk, current, totalChunks, fileIdentifier, localDirPath);
                // Update progress considering multiple files
                setProgress(prev => {
                    // Calculate progress for this specific file
                    const fileProgress = Math.min(current + 1, totalChunks) / totalChunks;
                    // Calculate overall progress across all files
                    const overallProgress = ((fileIndex + fileProgress) / totalFiles) * 100;
                    return Math.round(overallProgress);
                });
            } catch (error) {
                console.error("Failed to upload chunk", current, error);
                throw error;
            }
        }
    };

    const checkUploadedChunks = async (fileIdentifier, localDirPath) => {
        try {
          const response = await fetch(`${flaskUrl}check_uploaded_chunks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileIdentifier, localDirPath }),
          });
          if (response.ok) {
            const data = await response.json();
            // Assuming the server returns a JSON object with the count of uploaded chunks
            return data.uploadedChunksCount;
          } else {
            console.error("Failed to retrieve uploaded chunks count");
            return 0; // If unable to retrieve, assume no chunks uploaded
          }
        } catch (error) {
          console.error("Error checking uploaded chunks:", error);
          return 0; // On error, assume no chunks uploaded
        }
      }

      const clearCache = (localDirPath = null) => {

        // if no localDirPath is provided, use the current dirPath
        if (!localDirPath) {
            localDirPath = dirPath;
        }

        console.log("Clearing cache of uploaded files in: ", localDirPath);
        fetch(`${flaskUrl}clear_upload_cache`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ localDirPath }),
        })
        .then((response) => response.json())
        .then((data) => {
            console.log(data);
        })
        .catch((error) => {
            console.error('Error clearing cache:', error);
        });
    };

    const clearDirPath = () => {
        setProgress(0);
        console.log("Clearing dir of uploaded files in: ", dirPath);
        fetch(`${flaskUrl}clear_upload_dir`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dirPath }),
        })
        .then((response) => response.json())
        .then((data) => {
            console.log(data);
        })
        .catch((error) => {
            console.error('Error clearing directory:', error);
        });
    }

    const handleCancelExtraction = async () => {
        console.log("Cancelling extraction of files in: ", dirPath);
        if (extractingBinary) {
            // ask the server to kill the extraction process
            await fetch(`${flaskUrl}cancel_extraction`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dirPath }),
            });
        };
    }

    // Formik hook for form state management and validation
    const formik = useFormik({
        initialValues: {
            year: "",
            experiment: "",
            location: "",
            population: "",
            date: "",
            platform: "",
            sensor: "",
        },
        onSubmit: async (values) => {
            setIsUploading(true);
            cancelUploadRef.current = false;
            // setProgress(0);
            setBadFileType(false);
            // Construct directory path based on data type and form values
            let localDirPath = "";
            for (const field of dataTypes[selectedDataType].fields) {
                if (values[field]) {
                    // Sanitize field values to remove hidden Unicode characters
                    const sanitizedValue = values[field]
                        .normalize('NFKD')  // Normalize Unicode
                        .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')  // Remove control characters
                        .replace(/[^\x20-\x7E]/g, '')  // Keep only ASCII printable characters
                        .trim();  // Remove leading/trailing whitespace
                    
                    localDirPath += localDirPath ? `/${sanitizedValue}` : sanitizedValue;
                }
            }
            if(selectedDataType === "binary"){
                localDirPath += "/rover";
            }
            if (selectedDataType === "image") {
                localDirPath += "/Images";
            }
            if (selectedDataType === "platformLogs") {
                localDirPath += "/Metadata";
            }
            console.log("Directory path on submit:", localDirPath);
            console.log("Original form values:", values);
            setDirPath(localDirPath);

            // Step 1: Check which files need to be uploaded
            const fileTypes = {};
            files.forEach(file => {
                fileTypes[file.name] = file.type;
            });
            const fileList = files.map((file) => file.name);
            const filesToUpload = uploadNewFilesOnly ? await checkFilesOnServer(fileList, localDirPath) : fileList;
            console.log("Number of files to upload: ", filesToUpload.length)

            // Step 2: Upload the files
            if(filesToUpload.length === 0){
                setNoFilesToUpload(true);
            }
            else{
                setNoFilesToUpload(false);
                const maxRetries = 3;
                let bFT = false;
                for (let i = 0; i < filesToUpload.length; i++) {
                    console.log(('.' + filesToUpload[i].split('.')[1]))
                    if(selectedDataType === "image" && fileTypes[filesToUpload[i]].split('/')[0] != "image")
                    {
                        bFT = true;
                        setBadFileType(true);
                        break;
                    }
                    else if(
                        (selectedDataType != "image") && 
                        selectedDataType !== "platformLogs" &&
                        selectedDataType !== "binary" &&
                        ('.' + filesToUpload[i].split('.')[1]) != dataTypes[selectedDataType].fileType)
                    {
                        bFT = true;
                        setBadFileType(true);
                        break;
                    }
                    else{
                        let retries = 0;
                        while (retries < maxRetries) {
                            try {
                                if (cancelUploadRef.current) {
                                    break;
                                }
                                const file = files.find((f) => f.name === filesToUpload[i]);
                                
                                if (selectedDataType === "binary" && selectedDataType !== "platformLogs") {
                                    await uploadFileChunks(file, localDirPath, filesToUpload.length, i, filesToUpload.length);
                                    break;
                                } else {
                                    await uploadFileWithTimeout(file, localDirPath, selectedDataType);
                                    setProgress(Math.round(((i + 1) / filesToUpload.length) * 100));
                                }
                                break;
                            } catch (error) {
                                if (retries === maxRetries - 1) {
                                    alert(`Failed to upload file: ${filesToUpload[i]}`);
                                    console.log(`Failed to upload file: ${filesToUpload[i]}`, error);
                                    break;
                                }
                                retries++;
                            }
                        }
                    }
                }
                if(!bFT)
                {
                    // Step 3: only extract if not cancelled
                    if (selectedDataType === "binary" && !cancelUploadRef.current) {
                        setProgress(0);
                        console.log("Files to extract:", filesToUpload);
                        await extractBinaryFiles(filesToUpload, localDirPath);
                    }
                    
                    // now handle “finished” state
                    if (!cancelUploadRef.current && selectedDataType === "binary") {
                        setIsFinishedUploading(true)
                        setUploadedData(true)
                        setProgress(0);
                        // setIsUploading(false);
                    } else if (!cancelUploadRef.current) {
                        setIsFinishedUploading(true);
                        setUploadedData(true);
                        setProgress(0);
                        setIsUploading(false);
                    }
                }
            }
        },
        validate: (values) => {
            let errors = {};
            dataTypes[selectedDataType].fields.forEach((field) => {
                if (!values[field]) {
                    errors[field] = "This field is required";
                }
            });
            return errors;
        },
    });

    // Handler for changes in the Autocomplete input
    const handleAutocompleteInputChange = (fieldName, value) => {
        setCurrentInputValues({ ...currentInputValues, [fieldName]: value });
    };

    // Blur handler for Autocomplete fields
    const handleAutocompleteBlur = (fieldName) => {
        const value = currentInputValues[fieldName] || "";
        formik.setFieldValue(fieldName, value);
        const fieldIndex = dataTypes[selectedDataType].fields.indexOf(fieldName);
        const dependentFields = dataTypes[selectedDataType].fields.slice(fieldIndex + 1);
        dependentFields.forEach((dependentField) => {
            formik.setFieldValue(dependentField, "");
            setCurrentInputValues((prevValues) => ({ ...prevValues, [dependentField]: "" }));
        });
    };

    // Handler for file changes in the dropzone
    const handleFileChange = (fileArray) => {
        setFiles(prevFiles => {
            // Create a map of existing file names for quick lookup
            const existingFileNames = new Map(prevFiles.map(file => [file.name, file]));
            
            // Process incoming files including folder content
            const newFiles = [];
            
            // Process each file
            for (const file of fileArray) {
                // Skip collections.json file
                if (file.name === 'collections.json') {
                    continue;
                }
                
                // Check if this file is from a folder (contains path separator)
                const pathParts = file.path ? file.path.split('/') : file.webkitRelativePath ? file.webkitRelativePath.split('/') : null;
                
                // If file is from a folder
                if (pathParts && pathParts.length > 1) {
                    // Get all folder parts (exclude the file name which is the last part)
                    const folderParts = pathParts.slice(0, pathParts.length - 1);
                    const folderPath = folderParts.join('_');
                    const originalFileName = pathParts[pathParts.length - 1];

                    // Skip collections.json file even when in folders
                    if (originalFileName === 'collections.json') {
                        continue;
                    }
                    
                    const newFileName = `${folderPath}_${originalFileName}`;
                    
                    // Create a new file object with the renamed filename
                    const renamedFile = new File(
                        [file], 
                        newFileName, 
                        { type: file.type }
                    );
                    
                    // Add additional metadata to track original info
                    renamedFile.originalName = file.name;
                    renamedFile.folderName = folderPath;
                    
                    // Only add if not already in the list
                    if (!existingFileNames.has(newFileName)) {
                        newFiles.push(renamedFile);
                    }
                } else {
                    // Regular file (not from folder)
                    if (!existingFileNames.has(file.name)) {
                        newFiles.push(file);
                    }
                }
            }
            
            return [...prevFiles, ...newFiles];
        });
    };

    // Function to get options for a specific field
    const getOptionsForField = (field) => {
        let options = [];
        let currentLevel = nestedDirectories;
        for (const key of dataTypes[selectedDataType].fields) {
            if (key === field) break;
            currentLevel = currentLevel[formik.values[key]] || {};
        }
        if (currentLevel) {
            options = Object.keys(currentLevel);
        }
        return options;
    };

    // Render function for Autocomplete components
    const renderAutocomplete = (label) => {
        const fieldName = label.toLowerCase();
        const options = getOptionsForField(fieldName);
        const error = formik.touched[fieldName] && formik.errors[fieldName];

        return (
            <Autocomplete
                freeSolo
                id={`autocomplete-${fieldName}`}
                options={options}
                value={formik.values[fieldName]}
                inputValue={currentInputValues[fieldName] || ""}
                onInputChange={(event, value) => handleAutocompleteInputChange(fieldName, value)}
                onBlur={() => handleAutocompleteBlur(fieldName)}
                onChange={(event, value) => {
                    formik.setFieldValue(fieldName, value);
                }}
                renderInput={(params) => (
                    <TextField
                        {...params}
                        label={label}
                        variant="outlined"
                        fullWidth
                        error={Boolean(error)}
                        helperText={error}
                        onChange={(event) => {
                            formik.setFieldValue(fieldName, event.target.value);
                        }}
                    />
                )}
                sx={{ width: "100%", marginTop: "20px" }}
            />
        );
    };

    // Dropzone configuration
    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop: handleFileChange,
        accept: dataTypes[selectedDataType].fileType,
        maxFiles: Infinity,
        noClick: false,
        noKeyboard: false,
        // Enable directory support
        directory: true,
        webkitdirectory: true,
        // Allow both normal files and directories
        multiple: true
    });

    // Function to clear the files from the dropzone
    const clearFiles = () => {
        setFiles([]);
    };

    // Component render
    return (
        <>
        <Grid
            container
            justifyContent="center"
            alignItems="center"
            direction="row"
            style={{ width: "100%", height: "100%", paddingTop: "20px" }}
        >
            <Grid item xs={10}>
                <Typography variant="h4" component="h2" align="center" style={{ marginBottom: "20px" }}>
                    File Upload
                </Typography>
            </Grid>
            <Grid item xs={8}>
                <Tabs value={actionType} onChange={(event, newValue) => setActionType(newValue)} aria-label="action type tabs" sx={{ marginBottom: 2 }}>
                    <Tab value="upload" label="Upload Files" />
                    <Tab value="manage" label="Manage Files" />
                </Tabs>
            </Grid>

            {actionType === 'upload' && (
                <>
                <Grid item xs={8}>
                <FormControl fullWidth>
                    <InputLabel>Data Type</InputLabel>
                    <Select
                        value={selectedDataType}
                        label="Data Type"
                        onChange={(e) => setSelectedDataType(e.target.value)}
                    >
                        {Object.entries(dataTypes).map(([type, config]) => (
                            <MenuItem key={type} value={type}>
                                {config.label}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Grid>
            <Grid item xs={8}>
                <FormControlLabel
                    control={
                        <Switch
                            checked={uploadNewFilesOnly}
                            onChange={(e) => setUploadNewFilesOnly(e.target.checked)}
                        />
                    }
                    label="Only upload new files"
                />
            </Grid>
            <Grid item xs={8}>
                <form onSubmit={formik.handleSubmit}>
                    {isLoading && <CircularProgress />}
                    {!isLoading && !isUploading && !isFinishedUploading && (
                        <>
                            {dataTypes[selectedDataType].fields.map((field) =>
                                renderAutocomplete(field.charAt(0).toUpperCase() + field.slice(1))
                            ) } 
                            <Paper
                                variant="outlined"
                                sx={{
                                    p: 6,
                                    mt: 2,
                                    textAlign: "center",
                                    cursor: "pointer",
                                    backgroundColor: isDragActive ? "#f0f0f0" : "#fff",
                                }}
                                {...getRootProps()}
                            >
                                <input {...getInputProps()} directory="" webkitdirectory="" />
                                {files.length > 0 ? (
                                    <div
                                        style={{
                                            maxHeight: "200px",
                                            overflowY: "auto",
                                            display: "grid",
                                            gridTemplateColumns: "repeat(3, 1fr)",
                                            gap: "10px",
                                        }}
                                    >
                                        {files.map((file) => (
                                            <div key={file.name} style={{ textAlign: "left" }}>
                                                {file.name}
                                                {file.folderName && <span style={{fontSize: '0.8em', color: '#666'}}> (from {file.folderName})</span>}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <Typography>
                                        {isDragActive
                                            ? "Drop the files or folders here..."
                                            : `Drag and drop files or folders here, or click to select (${getFileTypeDescription(
                                                  dataTypes[selectedDataType].fileType
                                              )})`}
                                    </Typography>
                                )}
                            </Paper>
                            <Box display="flex" justifyContent="space-between" sx={{ mt: 2, width: "100%" }}>
                                <div>
                                    <Button
                                        variant="contained"
                                        color="primary"
                                        type="submit"
                                        onClick={() => {
                                            setProgress(0);
                                        }}
                                        style={{ marginRight: '8px' }}
                                        >
                                        Upload
                                    </Button>
                                    <Button 
                                        variant="contained"
                                        component="label"
                                        style={{ marginRight: '8px' }}
                                    >
                                        Select Folder
                                        <input
                                            type="file"
                                            directory=""
                                            webkitdirectory=""
                                            mozdirectory=""
                                            style={{ display: 'none' }}
                                            onChange={(e) => {
                                                if (e.target.files) {
                                                    handleFileChange(Array.from(e.target.files));
                                                }
                                            }}
                                        />
                                    </Button>
                                </div>
                                <Button variant="outlined" color="secondary" onClick={clearFiles}>
                                    Clear Files
                                </Button>
                            </Box>
                        </>
                    )}
                    {isUploading && noFilesToUpload && (
                        <Paper variant="outlined" sx={{ p: 2, mt: 2, textAlign: "center" }}>
                        <Typography>
                            <b>No files to upload.</b>
                        </Typography>
                        <Button
                            variant="contained"
                            color="error"
                            sx={{ mt: 2 }}
                            onClick={() => {
                                setIsUploading(false);
                            }}
                        >
                            Return
                        </Button>
                    </Paper>
                    )}
                    {isUploading && badFileType && (
                        <Paper variant="outlined" sx={{ p: 2, mt: 2, textAlign: "center" }}>
                        <Typography>
                            <b>Incorrect file type found for selected data type.</b>
                        </Typography>
                        <Button
                            variant="contained"
                            color="error"
                            sx={{ mt: 2 }}
                            onClick={() => {
                                setIsUploading(false);
                                setBadFileType(false);
                                setFiles([]);
                                                            }}
                        >
                            Return
                        </Button>
                    </Paper>
                    )}
                    {isUploading && !noFilesToUpload && !badFileType && (
                        <Paper variant="outlined" sx={{ p: 2, mt: 2, textAlign: "center" }}>
                            <Typography>
                                {extractingBinary ? "Extracting Binary File..." : "Uploading..."} {`${Math.round(progress)}%`}
                            </Typography>
                            <Typography variant="body2" color="warning.main" sx={{ mt: 1, fontWeight: 'bold' }}>
                                ⚠️ Do not leave this page and keep your computer on during the upload process
                            </Typography>
                            <LinearProgress variant="determinate" value={progress} />
                            <Button
                                variant="contained"
                                color="error"
                                sx={{ mt: 2 }}
                                onClick={() => {
                                    
                                    cancelUploadRef.current = true;
                                    setIsUploading(false);
                                    setExtractingBinary(false);
                                    setIsFinishedUploading(false);
                                    setFiles([]);
                                    setProgress(0);
                                    
                                    handleCancelExtraction(); // Cancel extraction if in progress
                                    clearDirPath();   // deletes any files already landed in the dir
                                }}
                            >
                                Cancel Upload
                            </Button>
                        </Paper>
                    )}
                    {!isUploading && isFinishedUploading && (
                        <Paper variant="outlined" sx={{ p: 2, mt: 2, textAlign: "center" }}>
                            <Typography>
                                {!failedUpload ? (
                                    extractingBinary ? <b>Extraction Successful</b> : <b>Upload Successful</b>
                                ) : (
                                    <b>Upload has been stopped.</b>
                                )}
                            </Typography>
                            <LinearProgress
                                color={!failedUpload ? "success" : "error"}
                                variant="determinate"
                                value={100}
                            />
                            <Button
                                variant="contained"
                                color={!failedUpload ? "success" : "error"}
                                sx={{ mt: 2 }}
                                onClick={() => {
                                    setIsFinishedUploading(false);
                                    setFailedUpload(false);
                                    setFiles([]);
                                    setProgress(0);
                                    setExtractingBinary(false);
                                    
                                    if (failedUpload) {
                                        clearDirPath();
                                    } else {
                                        clearCache(); // Here, safe to clear after successful or failed upload
                                    }
                                }}
                            >
                                {failedUpload ? "Return" : "Done"}
                            </Button>
                        </Paper>
                    )}

                </form>
            </Grid>
                </>)
            }
            {actionType === 'manage' && uploadedData && (
                <Grid item xs={8}>
                    <TableComponent />
                </Grid>
        )} 
            {actionType === 'manage' && !uploadedData && (
                <Grid item xs={8}>
                    <b>Uploaded data must be present to manage files.</b>
                </Grid>
        )}     
        </Grid>
        </>
    );
};

export default FileUploadComponent;
