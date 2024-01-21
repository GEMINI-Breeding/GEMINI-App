import React, { useState, useEffect } from "react";
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
} from "@mui/material";
import { useDropzone } from "react-dropzone";
import { useFormik } from "formik";
import { useDataState } from "../../DataContext";
import useTrackComponent from "../../useTrackComponent";
import dataTypes from "../../uploadDataTypes.json";

const FileUploadComponent = () => {
    useTrackComponent("FileUploadComponent");

    const { flaskUrl } = useDataState();
    const [isLoading, setIsLoading] = useState(false);
    const [nestedDirectories, setNestedDirectories] = useState({});
    const [selectedDataType, setSelectedDataType] = useState("image");
    const [files, setFiles] = useState([]);

    useEffect(() => {
        setIsLoading(true);
        fetch(`${flaskUrl}list_dirs_nested`)
            .then((response) => response.json())
            .then((data) => {
                console.log("Nested directories:", data);
                setNestedDirectories(data);
                setIsLoading(false);
            })
            .catch((error) => {
                console.error("Error fetching nested directories:", error);
                setIsLoading(false);
            });
    }, [flaskUrl]);

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
            console.log("Form values before submission:", values);
            const formData = new FormData();
            files.forEach((file) => {
                formData.append("files", file);
            });

            // Construct directory path based on data type and form values
            let dirPath = "";
            for (const field of dataTypes[selectedDataType].fields) {
                if (values[field]) {
                    if (dirPath === "") {
                        dirPath += `${values[field]}`;
                    } else {
                        dirPath += `/${values[field]}`;
                    }
                }
            }

            if (selectedDataType === "image") {
                dirPath += "/Images";
            }

            console.log("Directory path:", dirPath);
            formData.append("dirPath", dirPath);

            setIsLoading(true);
            try {
                const response = await fetch(`${flaskUrl}upload`, {
                    method: "POST",
                    body: formData,
                });
                if (response.ok) {
                    alert("Files uploaded successfully");
                } else {
                    alert("Error uploading files");
                }
            } catch (error) {
                alert("Error uploading files");
            }
            setIsLoading(false);
            setSelectedDataType(selectedDataType);
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
                onChange={(event, value) => {
                    console.log(`Setting ${label.toLowerCase()}:`, value);
                    formik.setFieldValue(label.toLowerCase(), value);
                }}
                renderInput={(params) => (
                    <TextField
                        {...params}
                        label={label}
                        variant="outlined"
                        fullWidth
                        onBlur={(event) => {
                            const value = event.target.value;
                            console.log(`Setting ${label.toLowerCase()} on blur:`, value);
                            formik.setFieldValue(label.toLowerCase(), value);
                        }}
                    />
                )}
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
                <form onSubmit={formik.handleSubmit}>
                    {isLoading && <CircularProgress />}
                    {!isLoading && (
                        <>
                            {dataTypes[selectedDataType].fields.map((field) =>
                                renderAutocomplete(field.charAt(0).toUpperCase() + field.slice(1))
                            )}
                            <Paper
                                variant="outlined"
                                sx={{ p: 6, mt: 2, textAlign: "center", cursor: "pointer" }}
                                {...getRootProps()}
                            >
                                <input {...getInputProps()} />
                                <Typography>
                                    {isDragActive
                                        ? "Drop the files here..."
                                        : "Drag and drop files here, or click to select files"}
                                </Typography>
                            </Paper>
                            <Button type="submit" variant="contained" color="primary" sx={{ mt: 2 }}>
                                Upload
                            </Button>
                        </>
                    )}
                </form>
            </Grid>
        </Grid>
    );
};

export default FileUploadComponent;
