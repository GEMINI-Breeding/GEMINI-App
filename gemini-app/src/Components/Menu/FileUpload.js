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
} from "@mui/material";
import { useDropzone } from "react-dropzone";
import { useFormik } from "formik";
import { useDataState } from "../../DataContext";
import useTrackComponent from "../../useTrackComponent";
import dataTypes from "../../uploadDataTypes.json";

const getFileTypeDescription = (fileType) => {
    const typeMap = {
        "image/*": "Image files",
        ".csv": "CSV files",
        ".txt": "Text files",
        "*": "All files",
        // Add more mappings as needed
    };
    return typeMap[fileType] || fileType;
};

const FileUploadComponent = () => {
    useTrackComponent("FileUploadComponent");

    const { flaskUrl } = useDataState();
    const [isLoading, setIsLoading] = useState(false);
    const [nestedDirectories, setNestedDirectories] = useState({});
    const [selectedDataType, setSelectedDataType] = useState("image");
    const [files, setFiles] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [uploadNewFilesOnly, setUploadNewFilesOnly] = useState(false);
    const cancelUploadRef = useRef(false);

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

    const checkFilesOnServer = async (fileList, dirPath) => {
        const response = await fetch(`${flaskUrl}check_files`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileList, dirPath }),
        });
        return response.json();
    };

    const uploadFileWithTimeout = async (file, dirPath, timeout = 10000) => {
        const formData = new FormData();
        formData.append("files", file);
        formData.append("dirPath", dirPath);

        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(`${flaskUrl}upload`, {
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
            const fileList = files.map((file) => file.name);
            const filesToUpload = uploadNewFilesOnly ? await checkFilesOnServer(fileList, dirPath) : fileList;

            // Step 2: Upload the files
            const maxRetries = 3;
            for (let i = 0; i < filesToUpload.length; i++) {
                let retries = 0;
                while (retries < maxRetries) {
                    try {
                        if (cancelUploadRef.current) {
                            break;
                        }

                        const file = files.find((f) => f.name === filesToUpload[i]);
                        await uploadFileWithTimeout(file, dirPath);

                        setProgress(Math.round(((i + 1) / filesToUpload.length) * 100));
                        break;
                    } catch (error) {
                        if (retries === maxRetries - 1) {
                            alert(`Failed to upload file: ${filesToUpload[i]}`);
                            break;
                        }
                        retries++;
                    }
                }
            }

            setIsUploading(false);
            setFiles([]);
        },
    });

    const handleFileChange = (fileArray) => {
        setFiles(fileArray);
    };

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

    const renderAutocomplete = (label) => {
        const options = getOptionsForField(label.toLowerCase());
        return (
            <Autocomplete
                freeSolo
                options={options}
                value={formik.values[label.toLowerCase()]}
                onChange={(event, value) => formik.setFieldValue(label.toLowerCase(), value)}
                renderInput={(params) => <TextField {...params} label={label} variant="outlined" fullWidth />}
                sx={{ width: "100%", marginTop: "20px" }}
            />
        );
    };

    const { getRootProps, getInputProps, isDragActive } = useDropzone({
        onDrop: handleFileChange,
        accept: dataTypes[selectedDataType].fileType,
    });

    return (
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
                    {!isLoading && !isUploading && (
                        <>
                            {dataTypes[selectedDataType].fields.map((field) =>
                                renderAutocomplete(field.charAt(0).toUpperCase() + field.slice(1))
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
                            <Button type="submit" variant="contained" color="primary" sx={{ mt: 2 }}>
                                Upload
                            </Button>
                        </>
                    )}
                    {isUploading && (
                        <Paper variant="outlined" sx={{ p: 2, mt: 2, textAlign: "center" }}>
                            <Typography>Uploading...</Typography>
                            <LinearProgress variant="determinate" value={progress} />
                            <Button
                                variant="contained"
                                color="secondary"
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
                </form>
            </Grid>
        </Grid>
    );
};

export default FileUploadComponent;
