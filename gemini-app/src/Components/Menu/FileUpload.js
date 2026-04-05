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
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
} from "@mui/material";
import FileUploadIcon from '@mui/icons-material/FileUpload';
import BuildIcon from '@mui/icons-material/Build';
import { useDropzone } from "react-dropzone";
import { useFormik } from "formik";
import { useDataState, useDataSetters } from "../../DataContext";
import useTrackComponent from "../../useTrackComponent";
import dataTypes from "../../uploadDataTypes.json";
import { BACKEND_MODE, FRAMEWORK_URL } from "../../api/config";
import Box from "@mui/material/Box";
import { TableComponent } from "./TableComponent";

// Helper function to map file types to human-readable descriptions
const getFileTypeDescription = (fileType) => {
    const typeMap = {
        "image/*": "Image files",
        ".csv": "CSV files",
        ".txt": "Text files",
        ".bin/*": "Binary files",
        ".tif": "TIFF files",
        "*": "All files",
        // Add more mappings as needed
    };
    return typeMap[fileType] || fileType;
};

// Helper function to validate orthomosaic files
const validateOrthomosaicFiles = (files, date) => {
    const fileNames = files.map(file => file.name);
    const demFiles = fileNames.filter(name => name.endsWith('-DEM.tif'));
    const rgbFiles = fileNames.filter(name => name.endsWith('-RGB.tif'));
    
    // Check if we have at least one RGB or DEM file
    if (demFiles.length === 0 && rgbFiles.length === 0) {
        return {
            isValid: false,
            message: "Orthomosaic upload requires -RGB.tif files (and optionally -DEM.tif files for plant height extraction)"
        };
    }
    
    // If we have both DEM and RGB files, validate pairing
    if (demFiles.length > 0 && rgbFiles.length > 0) {
        // Check if we have equal numbers of DEM and RGB files
        if (demFiles.length !== rgbFiles.length) {
            return {
                isValid: false,
                message: "When uploading both file types, the number of DEM files must match the number of RGB files"
            };
        }
        
        // Check if each DEM file has a corresponding RGB file
        for (const demFile of demFiles) {
            const baseName = demFile.replace('-DEM.tif', '');
            const correspondingRgb = baseName + '-RGB.tif';
            if (!rgbFiles.includes(correspondingRgb)) {
                return {
                    isValid: false,
                    message: `Missing corresponding RGB file for ${demFile}. Expected: ${correspondingRgb}`
                };
            }
        }
    }
    
    // Additional validation: Check that we have proper date format if provided
    if (date) {
        // Validate that we'll be able to rename the files properly
        if (rgbFiles.length > 0) {
            const expectedRgbName = `${date}-RGB.tif`;
            console.log(`RGB files will be renamed to: ${expectedRgbName}`);
        }
        if (demFiles.length > 0) {
            const expectedDemName = `${date}-DEM.tif`;
            console.log(`DEM files will be renamed to: ${expectedDemName}`);
        }
    }
    
    return { isValid: true };
};

// Helper function to generate renamed orthomosaic filenames based on date
const getRenamedOrthomosaicFileName = (originalFileName, date) => {
    if (originalFileName.endsWith('-DEM.tif')) {
        return `${date}-DEM.tif`;
    } else if (originalFileName.endsWith('-RGB.tif')) {
        return `${date}-RGB.tif`;
    }
    return originalFileName; // Return original if it doesn't match expected pattern
};

/**
 * FileUploadComponent - React component for file uploading with form fields.
 */
const FileUploadComponent = ({ actionType = null }) => {
    useTrackComponent("FileUploadComponent");

    // State hooks for various component states
    const { flaskUrl, extractingBinary, currentJobId } = useDataState();
    const { setExtractingBinary, setCurrentJobId } = useDataSetters();
    const [isLoading, setIsLoading] = useState(false);
    const [nestedDirectories, setNestedDirectories] = useState({});
    const [selectedDataType, setSelectedDataType] = useState("image");
    const [files, setFiles] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [isFinishedUploading, setIsFinishedUploading] = useState(false);
    const [noFilesToUpload, setNoFilesToUpload] = useState(true);
    const [badFileType, setBadFileType] = useState(false);
    const [badOrthomosaicFiles, setBadOrthomosaicFiles] = useState(false);
    const [orthomosaicErrorMessage, setOrthomosaicErrorMessage] = useState("");
    const [isCreatingPyramids, setIsCreatingPyramids] = useState(false);
    const [failedUpload, setFailedUpload] = useState(false);
    const [progress, setProgress] = useState(0);
    const [uploadNewFilesOnly, setUploadNewFilesOnly] = useState(false);
    const cancelUploadRef = useRef(false);
    const [currentInputValues, setCurrentInputValues] = useState({});
    const [dirPath, setDirPath] = useState("");
    const [internalActionType, setInternalActionType] = useState(actionType || 'upload');
    const [errorDialogOpen, setErrorDialogOpen] = useState(false);
    const [errorDialogTitle, setErrorDialogTitle] = useState("");
    const [errorDialogMessage, setErrorDialogMessage] = useState("");
    const {
        uploadedData
    } = useDataState();

    const {
        setUploadedData
    } = useDataSetters();
    const showErrorDialog = (title, message) => {
        setErrorDialogTitle(title);
        setErrorDialogMessage(message);
        setErrorDialogOpen(true);
    };

    useEffect(() => {
        console.log(selectedDataType);
        // Set default date to today when switching to a data type that has a date field
        if (dataTypes[selectedDataType].fields.includes("date") && !formik.values.date) {
            formik.setFieldValue("date", todayISO);
        }
    }, [selectedDataType]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!extractingBinary) return;

        // Framework mode: track progress via WebSocket
        if (BACKEND_MODE !== 'flask') {
            if (!currentJobId) return;
            const { connectJobProgress } = require('../../api/jobs');
            const ws = connectJobProgress(currentJobId, {
                onProgress: (data) => {
                    const pct = Math.round(data.progress || 0);
                    setProgress(pct);
                },
                onComplete: () => {
                    setExtractingBinary(false);
                    setIsFinishedUploading(true);
                    setUploadedData(true);
                    setIsUploading(false);
                    setProgress(100);
                    setCurrentJobId(null);
                },
                onError: (data) => {
                    setExtractingBinary(false);
                    setIsFinishedUploading(true);
                    setFailedUpload(true);
                    setIsUploading(false);
                    setCurrentJobId(null);
                    const errorMsg = (data && data.error_message) || 'Binary extraction failed. Check that the uploaded file is a valid Amiga .bin recording.';
                    showErrorDialog('Binary Extraction Failed', errorMsg);
                },
            });
            return () => ws.close();
        }

        // Flask mode: poll for progress
        const intervalId = setInterval(async () => {
                const pct = await getBinaryProgress(dirPath);
                let prog_calc = Math.round(pct);
                setProgress(prog_calc);

                if (prog_calc >= 100) {
                    setIsFinishedUploading(true);
                    setUploadedData(true);
                    setIsUploading(false);
                }
            }, 1000);

        return () => clearInterval(intervalId);
    }, [extractingBinary, dirPath, files.length, currentJobId]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!extractingBinary) return;

        // Framework mode: status tracked via WebSocket above
        if (BACKEND_MODE !== 'flask') return;

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
    }, [extractingBinary]); // eslint-disable-line react-hooks/exhaustive-deps
    
    // Effect to fetch nested directories on component mount
    useEffect(() => {
        if (BACKEND_MODE === 'framework') {
            // Framework mode: directory structure comes from entity queries, not filesystem
            setIsLoading(false);
            setUploadedData(true);
            return;
        }
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
    const uploadFileWithTimeout = async (file, localDirPath, dataType, timeout = 30000, renamedFileName = null) => {
        const formData = new FormData();
        formData.append("files", file);
        formData.append("dirPath", localDirPath);
        formData.append("dataType", dataType);
        if (renamedFileName) {
            formData.append("renamedFileName", renamedFileName);
        }
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

    const uploadChunkWithoutTimeout = async (chunk, index, totalChunks, fileIdentifier, localDirPath, renamedFileName = null) => {
        const formData = new FormData();

        if (BACKEND_MODE === 'framework') {
            // Framework mode: upload chunks to MinIO via framework API
            formData.append("file_chunk", chunk);
            formData.append("chunk_index", index);
            formData.append("total_chunks", totalChunks);
            formData.append("file_identifier", renamedFileName || fileIdentifier);
            formData.append("object_name", `${localDirPath}/${renamedFileName || fileIdentifier}`);
        } else {
            // Flask mode: original field names
            formData.append("fileChunk", chunk);
            formData.append("chunkIndex", index);
            formData.append("totalChunks", totalChunks);
            formData.append("fileIdentifier", renamedFileName || fileIdentifier);
            formData.append("dirPath", localDirPath);
        }

        const uploadUrl = BACKEND_MODE === 'framework'
            ? `${FRAMEWORK_URL}files/upload_chunk`
            : `${flaskUrl}upload_chunk`;

        try {
            const response = await fetch(uploadUrl, {
                method: "POST",
                body: formData
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
            // backend may now return fractional progress (files completed + fraction within current file)
            const raw = data.progress; // could be float or int
            const totalFiles = files.length || 1;
            let pct = 0;
            if (typeof raw === 'number') {
                // If raw >= totalFiles treat as all done
                const capped = Math.min(raw, totalFiles);
                pct = (capped / totalFiles) * 100;
            }
            return pct;
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
            if (BACKEND_MODE !== 'flask') {
                // Framework mode: submit as a job
                const { extractBinaryFile } = await import('../../api/processing');
                const data = await extractBinaryFile({ files, localDirPath });
                console.log("Binary extraction job submitted:", data);
                if (data && data.id) {
                    setCurrentJobId(data.id);
                } else {
                    throw new Error('Job submission returned no job ID');
                }
                return;
            }

            const response = await fetch(`${flaskUrl}extract_binary_file`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ files, localDirPath }),
            });

            if (response.ok) {
                console.log("Binary file extraction started");
                await response.json();
            } else {
                const errorText = await response.text().catch(() => '');
                showErrorDialog('Extraction Failed', `Binary extraction request failed (${response.status}). ${errorText}`);
                setIsFinishedUploading(true);
                setFailedUpload(true);
                clearDirPath();
            }
        } catch (error) {
            console.error("Error extracting binary file:", error);
            const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError';
            showErrorDialog(
                'Extraction Failed',
                isNetworkError
                    ? 'Cannot connect to the backend server. Check that the backend is running and accessible.'
                    : `Binary extraction failed: ${error.message}`
            );
            setIsFinishedUploading(true);
            setFailedUpload(true);
            clearDirPath();
        }
    };

    const uploadFileChunks = async (file, localDirPath, uploadLength, fileIndex, totalFiles, renamedFileName = null) => {
        // Increase chunk size for faster upload (e.g., 4MB)
        const chunkSize = 4 * 1024 * 1024;
        const totalChunks = Math.ceil(file.size / chunkSize);
        const fileIdentifier = renamedFileName || file.name;

        const uploadedChunks = await checkUploadedChunks(fileIdentifier, localDirPath);
        console.log("Uploaded chunks:", uploadedChunks);

        // Sequential upload - upload one chunk at a time
        for (let current = uploadedChunks; current < totalChunks; current++) {
            if (cancelUploadRef.current) break;
            
            const chunk = file.slice(current * chunkSize, (current + 1) * chunkSize);
            try {
                await uploadChunkWithoutTimeout(chunk, current, totalChunks, file.name, localDirPath, renamedFileName);
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
        const checkUrl = BACKEND_MODE === 'framework'
            ? `${FRAMEWORK_URL}files/check_uploaded_chunks`
            : `${flaskUrl}check_uploaded_chunks`;
        const body = BACKEND_MODE === 'framework'
            ? { file_identifier: fileIdentifier, total_chunks: 0 }
            : { fileIdentifier, localDirPath };

        try {
          const response = await fetch(checkUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (response.ok) {
            const data = await response.json();
            return BACKEND_MODE === 'framework'
                ? data.uploaded_chunks
                : data.uploadedChunksCount;
          } else {
            console.error("Failed to retrieve uploaded chunks count");
            return 0;
          }
        } catch (error) {
          console.error("Error checking uploaded chunks:", error);
          return 0;
        }
      }

      const clearCache = (localDirPath = null) => {

        // if no localDirPath is provided, use the current dirPath
        if (!localDirPath) {
            localDirPath = dirPath;
        }

        const clearUrl = BACKEND_MODE === 'framework'
            ? `${FRAMEWORK_URL}files/clear_upload_cache`
            : `${flaskUrl}clear_upload_cache`;
        const body = BACKEND_MODE === 'framework'
            ? { file_identifier: localDirPath }
            : { localDirPath };

        console.log("Clearing cache of uploaded files in: ", localDirPath);
        fetch(clearUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
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
        if (BACKEND_MODE !== 'flask') {
            // Framework mode: files are in MinIO, no local dir to clear
            return;
        }
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
        if (!extractingBinary) return;
        if (BACKEND_MODE !== 'flask') {
            // Framework mode: cancel via job API
            if (currentJobId) {
                const { cancelJob } = require('../../api/jobs');
                await cancelJob(currentJobId);
                setCurrentJobId(null);
            }
            setExtractingBinary(false);
            return;
        }
        await fetch(`${flaskUrl}cancel_extraction`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dirPath }),
        });
    }

    // Formik hook for form state management and validation
    const todayISO = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const formik = useFormik({
        initialValues: {
            year: "",
            experiment: "",
            location: "",
            population: "",
            date: todayISO,
            platform: "",
            sensor: "",
        },
        onSubmit: async (values) => {
            setIsUploading(true);
            cancelUploadRef.current = false;
            setBadFileType(false);
            setBadOrthomosaicFiles(false);
            setOrthomosaicErrorMessage("");
            setIsCreatingPyramids(false);

            // Check backend connectivity before starting upload
            try {
                const healthUrl = BACKEND_MODE !== 'flask'
                    ? `${FRAMEWORK_URL}files/list/`
                    : `${flaskUrl}list_dirs_nested`;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                await fetch(healthUrl, { signal: controller.signal });
                clearTimeout(timeoutId);
            } catch (error) {
                setIsUploading(false);
                showErrorDialog(
                    'Backend Not Reachable',
                    BACKEND_MODE !== 'flask'
                        ? 'Cannot connect to the framework backend. Check that the gemini-framework Docker stack is running (docker compose up).'
                        : 'Cannot connect to the Flask backend. Check that the server is running (npm run server).'
                );
                return;
            }

            // Construct directory path based on data type and form values
            let localDirPath = "";
            
            if (selectedDataType === "ortho") {
                // For orthomosaic files, build path directly for Processed directory
                localDirPath = "Processed";
                for (const field of dataTypes[selectedDataType].fields) {
                    if (values[field]) {
                        // Sanitize field values to remove hidden Unicode characters
                        const sanitizedValue = values[field]
                            .normalize('NFKD')  // Normalize Unicode
                            .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')  // Remove control characters
                            .replace(/[^\x20-\x7E]/g, '')  // Keep only ASCII printable characters
                            .trim();  // Remove leading/trailing whitespace
                        
                        localDirPath += `/${sanitizedValue}`;
                    }
                }
            } else {
                // For other data types, use the standard Raw directory structure
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
                    localDirPath += "/Amiga";
                }
                if (selectedDataType === "image") {
                    localDirPath += "/Images";
                }
                if (selectedDataType === "platformLogs") {
                    localDirPath += "/Metadata";
                }
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
            
            // Validate orthomosaic files if applicable
            if (selectedDataType === "ortho") {
                const validation = validateOrthomosaicFiles(files, values.date);
                if (!validation.isValid) {
                    setBadOrthomosaicFiles(true);
                    setOrthomosaicErrorMessage(validation.message);
                    setIsUploading(false);
                    return;
                }
            }
            
            const filesToUpload = (uploadNewFilesOnly && BACKEND_MODE === 'flask')
                ? await checkFilesOnServer(fileList, localDirPath)
                : fileList;
            console.log("Number of files to upload: ", filesToUpload.length)

            // Step 2: Upload the files
            if(filesToUpload.length === 0){
                setNoFilesToUpload(true);
            }
            else{
                setNoFilesToUpload(false);
                const maxRetries = 3;
                let bFT = false;
                const failedFiles = [];
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
                                } else if (selectedDataType === "ortho") {
                                    // Generate renamed filename for orthomosaic files
                                    const renamedFileName = getRenamedOrthomosaicFileName(file.name, values.date);

                                    // Set pyramid creation state for this file
                                    if (file.name.endsWith('.tif')) {
                                        setIsCreatingPyramids(true);
                                    }

                                    await uploadFileChunks(file, localDirPath, filesToUpload.length, i, filesToUpload.length, renamedFileName);

                                    // Pyramid creation is complete when upload finishes (it's done synchronously on backend)
                                    if (file.name.endsWith('.tif')) {
                                        setIsCreatingPyramids(false);
                                    }

                                    setProgress(Math.round(((i + 1) / filesToUpload.length) * 100));
                                    break;
                                } else if (BACKEND_MODE !== 'flask') {
                                    // Framework mode: use chunked upload for all file types
                                    await uploadFileChunks(file, localDirPath, filesToUpload.length, i, filesToUpload.length);
                                    break;
                                } else {
                                    await uploadFileWithTimeout(file, localDirPath, selectedDataType);
                                    setProgress(Math.round(((i + 1) / filesToUpload.length) * 100));
                                }
                                break;
                            } catch (error) {
                                if (retries === maxRetries - 1) {
                                    failedFiles.push(filesToUpload[i]);
                                    console.log(`Failed to upload file: ${filesToUpload[i]}`, error);
                                    break;
                                }
                                retries++;
                            }
                        }
                    }
                }
                if (failedFiles.length > 0) {
                    showErrorDialog(
                        'Upload Failed',
                        `Failed to upload ${failedFiles.length} file(s):\n${failedFiles.join('\n')}\n\nCheck your network connection and that the backend server is running.`
                    );
                }
                if(!bFT)
                {
                    // Step 3: Register entities in framework mode
                    if (BACKEND_MODE !== 'flask' && !cancelUploadRef.current) {
                        try {
                            const { registerUploadEntities } = await import('../../api/entities');
                            await registerUploadEntities(values, selectedDataType, filesToUpload);
                            console.log("Entities registered for upload");
                        } catch (error) {
                            console.error("Failed to register upload entities:", error);
                            showErrorDialog(
                                'Entity Registration Warning',
                                `Files were uploaded successfully, but entity registration failed: ${error.message}\n\nUploaded files are stored but may not appear in the Manage tab until entities are created.`
                            );
                        }
                    }

                    // Step 4: only extract if not cancelled
                    if (selectedDataType === "binary" && !cancelUploadRef.current) {
                        setProgress(0);
                        console.log("Files to extract:", filesToUpload);
                        await extractBinaryFiles(filesToUpload, localDirPath);
                    }

                    // now handle "finished" state
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
        const sanitizedValue = value ? sanitizeFieldInput(value) : value;
        formik.setFieldValue(fieldName, sanitizedValue);
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

    const sanitizeFieldInput = (value) => {
        return value
            .replace(/[\s\/\\<>:"|?*]/g, '')  // Don't allow problematic characters (or space)
    };

    // Render function for Autocomplete components
    const renderAutocomplete = (label, key) => {
        const fieldName = label.toLowerCase();
        const options = getOptionsForField(fieldName);
        const error = formik.touched[fieldName] && formik.errors[fieldName];

        return (
            <Autocomplete
                key={key || fieldName}
                freeSolo
                id={`autocomplete-${fieldName}`}
                options={options}
                value={formik.values[fieldName]}
                inputValue={currentInputValues[fieldName] || ""}
                onInputChange={(event, value) => {
                    const sanitizedValue = value ? sanitizeFieldInput(value) : value;
                    handleAutocompleteInputChange(fieldName, sanitizedValue);
                }}
                onBlur={() => handleAutocompleteBlur(fieldName)}
                onChange={(event, value) => {
                    const sanitizedValue = value ? sanitizeFieldInput(value) : value;
                    formik.setFieldValue(fieldName, sanitizedValue);
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
                            const sanitizedValue = sanitizeFieldInput(event.target.value);
                            formik.setFieldValue(fieldName, sanitizedValue);
                        }}
                    />
                )}
                sx={{ width: "100%", marginTop: "20px" }}
            />
        );
    };

    // Build the accept object for react-dropzone v14+
    // react-dropzone expects { "mime/type": [".ext"] }, not a raw string.
    const getAcceptConfig = (fileType) => {
        if (fileType === "*") return undefined; // Accept all files
        if (fileType === "image/*") return { "image/*": [] };
        if (fileType === ".bin") return { "application/octet-stream": [".bin"] };
        if (fileType === ".csv") return { "text/csv": [".csv"] };
        if (fileType === ".txt") return { "text/plain": [".txt"] };
        if (fileType === ".tif") return { "image/tiff": [".tif", ".tiff"] };
        return undefined;
    };

    // Dropzone configuration
    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop: handleFileChange,
        accept: getAcceptConfig(dataTypes[selectedDataType].fileType),
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
        setIsCreatingPyramids(false);
    };

    const titleStyle = {
        fontSize: "1.25rem", // Adjust for desired size
        fontWeight: "normal",
        textAlign: "center",
    };

    // Use the effective action type (either prop or internal state)
    const effectiveActionType = actionType || internalActionType;

    // Component render
    return (
        <>
        <Grid
            container
            justifyContent="center"
            alignItems="flex-start"
            direction="row"
            style={{ width: "100%", minHeight: "100%", padding: "30px" }}
        >
            {/* Show tabs only when no specific actionType is provided (main Prepare tab) */}
            {!actionType && (
                <Grid item alignItems="center" alignSelf="center" style={{ width: "80%", paddingTop: "20px" }}>
                    <Tabs value={internalActionType} onChange={(event, newValue) => setInternalActionType(newValue)} aria-label="action type tabs" sx={{ marginBottom: 2 }} centered variant="fullWidth">
                        <Tab 
                            value="upload" 
                            label="Upload Files" 
                            style={titleStyle}
                            icon={<FileUploadIcon />}
                            iconPosition="start"
                        />
                        <Tab 
                            value="manage" 
                            label="Manage Files" 
                            style={titleStyle}
                            icon={<BuildIcon />}
                            iconPosition="start"
                        />
                    </Tabs>
                </Grid>
            )}

            {effectiveActionType === 'upload' && (
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
                                field === "date" ? (
                                    <TextField
                                        key="date"
                                        label="Date"
                                        type="date"
                                        value={formik.values.date || ""}
                                        onChange={(e) => formik.setFieldValue("date", e.target.value)}
                                        onBlur={formik.handleBlur}
                                        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                                        error={Boolean(formik.touched.date && formik.errors.date)}
                                        helperText={formik.touched.date && formik.errors.date}
                                        InputLabelProps={{ shrink: true }}
                                        fullWidth
                                        sx={{ width: "100%", marginTop: "20px" }}
                                    />
                                ) : (
                                    renderAutocomplete(field.charAt(0).toUpperCase() + field.slice(1))
                                )
                            ) }
                            {selectedDataType === "ortho" && (
                                <Paper
                                    variant="outlined"
                                    sx={{
                                        p: 2,
                                        mt: 2,
                                        backgroundColor: "#f5f5f5",
                                        borderLeft: "4px solid #2196f3"
                                    }}
                                >
                                    <Typography variant="body2" color="primary" sx={{ fontWeight: 'medium' }}>
                                        <strong>Note:</strong> You can upload RGB.tif files alone for most processing. 
                                        DEM.tif files are required for plant height.
                                    </Typography>
                                </Paper>
                            )}
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
                    {badOrthomosaicFiles && (
                        <Paper variant="outlined" sx={{ p: 2, mt: 2, textAlign: "center" }}>
                        <Typography>
                            <b>{orthomosaicErrorMessage}</b>
                        </Typography>
                        <Button
                            variant="contained"
                            color="error"
                            sx={{ mt: 2 }}
                            onClick={() => {
                                setBadOrthomosaicFiles(false);
                                setOrthomosaicErrorMessage("");
                                setFiles([]);
                            }}
                        >
                            Return
                        </Button>
                    </Paper>
                    )}
                    {isUploading && !noFilesToUpload && !badFileType && !badOrthomosaicFiles && (
                        <Paper variant="outlined" sx={{ p: 2, mt: 2, textAlign: "center" }}>
                            <Typography>
                                {extractingBinary ? "Extracting Binary File..." : 
                                 isCreatingPyramids ? "Creating Pyramid Files..." : 
                                 "Uploading..."} {`${Math.round(progress)}%`}
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
                                    setBadOrthomosaicFiles(false);
                                    setOrthomosaicErrorMessage("");
                                    
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
                                    extractingBinary ? <b>Extraction Successful</b> : 
                                    isCreatingPyramids ? <b>Creating Pyramid Files...</b> :
                                    <b>Upload Successful</b>
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
                                    setBadOrthomosaicFiles(false);
                                    setOrthomosaicErrorMessage("");
                                    
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
            {effectiveActionType === 'manage' && uploadedData && (
                <Grid item xs={8}>
                    <TableComponent />
                </Grid>
        )} 
            {effectiveActionType === 'manage' && !uploadedData && (
                <Grid item xs={8}>
                    <b>Uploaded data must be present to manage files.</b>
                </Grid>
        )}     
        </Grid>
        <Dialog
            open={errorDialogOpen}
            onClose={() => setErrorDialogOpen(false)}
            aria-labelledby="error-dialog-title"
            aria-describedby="error-dialog-description"
        >
            <DialogTitle id="error-dialog-title">{errorDialogTitle}</DialogTitle>
            <DialogContent>
                <DialogContentText id="error-dialog-description" sx={{ whiteSpace: 'pre-wrap' }}>
                    {errorDialogMessage}
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => setErrorDialogOpen(false)} autoFocus>
                    OK
                </Button>
            </DialogActions>
        </Dialog>
        </>
    );
};

export default FileUploadComponent;
