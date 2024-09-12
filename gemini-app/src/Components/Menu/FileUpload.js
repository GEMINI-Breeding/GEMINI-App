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

let uploadedSizeSoFar = 0;

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
    const [progress, setProgress] = useState(0);
    const [uploadNewFilesOnly, setUploadNewFilesOnly] = useState(false);
    const cancelUploadRef = useRef(false);
    const [currentInputValues, setCurrentInputValues] = useState({});
    const [dirPath, setDirPath] = useState("");
    const [actionType, setActionType] = useState('upload');


    useEffect(() => {
        console.log(selectedDataType);
    }, [selectedDataType]);

    useEffect(() => {
        if (extractingBinary) {
            const intervalId = setInterval(async () => {
                const processedFilesCount = await getBinaryProgress(dirPath);
                setProgress(Math.round((processedFilesCount / files.length) * 100));
            }, 1000);

            return () => clearInterval(intervalId);
        }
    }, [extractingBinary, dirPath, files.length]);
    

    // Effect to fetch nested directories on component mount
    useEffect(() => {
        setIsLoading(true);
        fetch(`${flaskUrl}list_dirs_nested`)
            .then((response) => response.json())
            .then((data) => {
                setNestedDirectories(data);
                setIsLoading(false);
            })
            .catch((error) => {
                console.error("Error fetching nested directories:", error);
                setIsLoading(false);
            });
    }, [flaskUrl]);

    // Function to check for existing files on the server
    const checkFilesOnServer = async (fileList, dirPath) => {
        const response = await fetch(`${flaskUrl}check_files`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileList, dirPath }),
        });
        return response.json();
    };

    // Function to upload a file with a timeout
    const uploadFileWithTimeout = async (file, dirPath, dataType, timeout = 30000) => {
        const formData = new FormData();
        formData.append("files", file);
        formData.append("dirPath", dirPath);
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

    const uploadChunkWithTimeout = async (chunk, index, totalChunks, fileIdentifier, dirPath, timeout = 10000) => {
        const formData = new FormData();
        formData.append("fileChunk", chunk);
        formData.append("chunkIndex", index);
        formData.append("totalChunks", totalChunks);
        formData.append("fileIdentifier", fileIdentifier);
        formData.append("dirPath", dirPath);

        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(`${flaskUrl}upload_chunk`, {
                method: "POST",
                body: formData,
                signal: controller.signal,
            });
            clearTimeout(id);
            return response;
        } catch(error) {
            console.log("Upload error:", error);
            clearTimeout(id);
            throw error;
        }
    };

    const getBinaryProgress = async (dirPath) => {
        try {
            const response = await fetch(`${flaskUrl}get_binary_progress`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ dirPath }),
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

    const extractBinaryFiles = async (files, dirPath) => {
        setExtractingBinary(true);
        setDirPath(dirPath);

        try {
            const response = await fetch(`${flaskUrl}extract_binary_file`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ files, dirPath }),
            });

            if (response.ok) {
                console.log("Binary file extraction started");
                const result = await response.json();
                setExtractingBinary(false);
                console.log("Extraction complete");
            } else {
                console.error("Failed to extract binary file");
                setExtractingBinary(false);
            }
        } catch (error) {
            console.error("Error extracting binary file:", error);
            setExtractingBinary(false);
        }
    };

    const uploadFileChunks = async (file, dirPath, uploadLength) => {
        const chunkSize = 0.5 * 1024 * 1024;
        const totalChunks = Math.ceil(file.size / chunkSize);
        const fileIdentifier = file.name;
        let temp = 0;

        const uploadedChunks = await checkUploadedChunks(fileIdentifier, dirPath);
        console.log("Uploaded chunks:", uploadedChunks);
        for (let index = uploadedChunks; index < totalChunks; index++) {
            if (cancelUploadRef.current) {
                break;
            }
            const chunk = file.slice(index * chunkSize, (index + 1) * chunkSize);
            await uploadChunkWithTimeout(chunk, index, totalChunks, fileIdentifier, dirPath)
                .catch(error => {
                console.error("Failed to upload chunk", index, error);
                throw error; // Stop upload process if any chunk fails
                });
        
            // Update progress here.
            temp = uploadedSizeSoFar + (Math.round((((index + 1) / totalChunks) * 100))/uploadLength);
            setProgress(temp);
        }
        uploadedSizeSoFar = temp
    };

    const checkUploadedChunks = async (fileIdentifier, dirPath) => {
        try {
          const response = await fetch(`${flaskUrl}check_uploaded_chunks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileIdentifier, dirPath }),
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
            setProgress(0);
            setBadFileType(false);
            // Construct directory path based on data type and form values
            let dirPath = "";
            for (const field of dataTypes[selectedDataType].fields) {
                if (values[field]) {
                    dirPath += dirPath ? `/${values[field]}` : values[field];
                }
            }
            if (selectedDataType === "image") {
                dirPath += "/Images";
            }

            // Step 1: Check which files need to be uploaded
            const fileTypes = {};
            files.forEach(file => {
                fileTypes[file.name] = file.type;
            });
            const fileList = files.map((file) => file.name);
            const filesToUpload = uploadNewFilesOnly ? await checkFilesOnServer(fileList, dirPath) : fileList;
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
                    if(selectedDataType === "image" && fileTypes[filesToUpload[i]].split('/')[0] != "image")
                    {
                        bFT = true;
                        setBadFileType(true);
                        break;
                    }
                    else if((selectedDataType != "image") && (('.' + filesToUpload[i].split('.')[1]) != dataTypes[selectedDataType].fileType))
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
                                
                                if (selectedDataType === "binary") {
                                    await uploadFileChunks(file, dirPath, filesToUpload.length);
                                    break;
                                } else {
                                    await uploadFileWithTimeout(file, dirPath, selectedDataType);
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
                    // Step 3: If binary file, extract the contents
                    if (selectedDataType === "binary") {
                        setProgress(0);
                        console.log("Files to extract:", filesToUpload);
                        await extractBinaryFiles(filesToUpload, dirPath);
                    }
                    uploadedSizeSoFar = 0;
                    setProgress(0);
                    setIsUploading(false);
                    if(!cancelUploadRef.current)
                    {
                        setIsFinishedUploading(true);
                    }
                    setFiles([]);
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
        setFiles(fileArray);
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
                                <input {...getInputProps()} />
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
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <Typography>
                                        {isDragActive
                                            ? "Drop the files here..."
                                            : `Drag and drop files here, or click to select files (${getFileTypeDescription(
                                                  dataTypes[selectedDataType].fileType
                                              )})`}
                                    </Typography>
                                )}
                            </Paper>
                            <Box display="flex" justifyContent="space-between" sx={{ mt: 2, width: "100%" }}>
                                <Button variant="contained" color="primary" type="submit">
                                    Upload
                                </Button>
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
                            <LinearProgress variant="determinate" value={progress} />
                            <Button
                                variant="contained"
                                color="error"
                                sx={{ mt: 2 }}
                                onClick={() => {
                                    cancelUploadRef.current = true;
                                    setIsUploading(false);
                                }}
                            >
                                Cancel Upload
                            </Button>
                        </Paper>
                    )}
                    {!isUploading && isFinishedUploading && (
                        <Paper variant="outlined" sx={{ p: 2, mt: 2, textAlign: "center" }}>
                            <Typography>
                                {extractingBinary ? <b>Extraction Successful</b> : <b>Upload Successful</b>} 
                            </Typography>
                            <LinearProgress color ="success" variant="determinate" value={100} />
                            <Button
                                variant="contained"
                                color="success"
                                sx={{ mt: 2 }}
                                onClick={() => {
                                    setIsFinishedUploading(false);
                                }}
                            >
                                Done
                            </Button>
                        </Paper>
                    )}
                </form>
            </Grid>
                </>)
            }
            {actionType === 'manage' && (
                <Grid item xs={8}>
                    <TableComponent />
                </Grid>
        )}         
        </Grid>
        </>
    );
};

export default FileUploadComponent;
