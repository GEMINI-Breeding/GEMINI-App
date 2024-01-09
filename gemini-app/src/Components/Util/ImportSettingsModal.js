import React, { useState, useEffect } from "react";
import { useDataState, useDataSetters } from "../../DataContext";
import {
    TextField,
    Button,
    Radio,
    RadioGroup,
    FormControlLabel,
    Box,
    Typography,
    Modal,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
} from "@mui/material";

const ImportSettingsModal = ({ importedData, onClose, open }) => {
    const { fieldDesignOptions } = useDataState();
    const { setFieldDesignOptions, setPolygonProposalOptions } = useDataSetters();

    const [modalOptions, setModalOptions] = useState(fieldDesignOptions);
    const [unit, setUnit] = useState("meters");

    useEffect(() => {
        setModalOptions({
            ...modalOptions,
            rows: calculateMaxMinusMin(importedData, "row"),
            columns: calculateMaxMinusMin(importedData, "col"),
        });
    }, [importedData]);

    const calculateMaxMinusMin = (data, field) => {
        const values = data.map((row) => row[field]).filter((val) => val != null);
        return Math.max(...values) - Math.min(...values) + 1;
    };

    const handleChange = (event) => {
        const { name, value } = event.target;
        setModalOptions({
            ...modalOptions,
            [name]: parseFloat(value),
        });
    };

    const handleUnitChange = (event) => {
        setUnit(event.target.value);
    };

    const convertToMeters = (value) => {
        return unit === "feet" ? value * 0.3048 : value;
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        const convertedOptions = {
            width: convertToMeters(modalOptions.width),
            length: convertToMeters(modalOptions.length),
            verticalSpacing: convertToMeters(modalOptions.verticalSpacing),
            horizontalSpacing: convertToMeters(modalOptions.horizontalSpacing),
            angle: modalOptions.angle,
            rows: modalOptions.rows,
            columns: modalOptions.columns,
        };
        setFieldDesignOptions(convertedOptions);
        setPolygonProposalOptions(convertedOptions);
        onClose();
    };

    const modalStyle = {
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: 400,
        bgcolor: "background.paper",
        boxShadow: 24,
        p: 4,
    };

    return (
        <Modal open={open} onClose={onClose}>
            <Box sx={modalStyle}>
                <Typography variant="h6" sx={{ marginBottom: 2 }}>
                    Field Design Settings
                </Typography>
                <FormControl component="fieldset" sx={{ marginBottom: 2 }}>
                    <RadioGroup row value={unit} onChange={handleUnitChange}>
                        <FormControlLabel value="meters" control={<Radio />} label="Meters" />
                        <FormControlLabel value="feet" control={<Radio />} label="Feet" />
                    </RadioGroup>
                </FormControl>
                <form onSubmit={handleSubmit}>
                    <TextField
                        label="Width"
                        name="width"
                        value={modalOptions.width}
                        onChange={handleChange}
                        type="number"
                        fullWidth
                        margin="normal"
                    />
                    <TextField
                        label="Length"
                        name="length"
                        value={modalOptions.length}
                        onChange={handleChange}
                        type="number"
                        fullWidth
                        margin="normal"
                    />
                    <TextField
                        label="Vertical Spacing"
                        name="verticalSpacing"
                        value={modalOptions.verticalSpacing}
                        onChange={handleChange}
                        type="number"
                        fullWidth
                        margin="normal"
                    />
                    <TextField
                        label="Horizontal Spacing"
                        name="horizontalSpacing"
                        value={modalOptions.horizontalSpacing}
                        onChange={handleChange}
                        type="number"
                        fullWidth
                        margin="normal"
                    />
                    <TextField
                        label="Angle"
                        name="angle"
                        value={modalOptions.angle}
                        onChange={handleChange}
                        type="number"
                        fullWidth
                        margin="normal"
                    />
                    <TextField
                        label="Rows"
                        name="rows"
                        value={modalOptions.rows}
                        onChange={handleChange}
                        type="number"
                        fullWidth
                        margin="normal"
                    />
                    <TextField
                        label="Columns"
                        name="columns"
                        value={modalOptions.columns}
                        onChange={handleChange}
                        type="number"
                        fullWidth
                        margin="normal"
                    />
                    <Button type="submit" variant="contained" color="primary" sx={{ marginRight: 1 }}>
                        Save Settings
                    </Button>
                    <Button onClick={onClose} variant="outlined" color="secondary">
                        Close
                    </Button>
                </form>
            </Box>
        </Modal>
    );
};

export default ImportSettingsModal;
