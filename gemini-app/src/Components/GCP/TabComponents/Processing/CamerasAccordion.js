import React, { createContext, useContext, useState } from "react";
import {
    Accordion,
    AccordionSummary,
    AccordionDetails,
    List,
    ListItem,
    ListItemText,
    Checkbox,
    Typography,
    Grid,
    Box,
    Button,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { styled } from "@mui/material/styles";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
const CameraAccordionContext = createContext();

function RenderItem({ item, column, handleAction, handleClickOpen }) {
    const actionHandler = handleAction || handleClickOpen;
    if (column.actionType) {
        if (item[column.field] == false) {
            return (
                <Button
                    onClick={() => actionHandler(item, column)}
                    style={{
                        background: "#1976d2",
                        color: "white",
                        borderRadius: "4px",
                    }}
                >
                    {column.actionLabel || "Action"}
                </Button>
            );
        } else if (item[column.field] === true) {
            return (
                <Checkbox
                    checked={true}
                    disabled={true} // Assuming you want it disabled; remove if not
                />
            );
        }
    } else if (item[column.field] === 2) {
        return <WarningAmberIcon />; // if value is 2, return warning icon
    } else if (column.label === "Date") {
        return <ListItemText primary={item[column.field]} />; // return date if in Date column
    } else if (typeof item[column.field] !== "boolean" && typeof item[column.field] !== "number") {
        return <ListItemText primary={item[column.field]} />; // returns string if not number or boolean
    } else if (item[column.field] === 1 || item[column.field] === 0) {
        return <Checkbox checked={Boolean(item[column.field])} disabled />; // integer to boolean case
    } else {
        return <WarningAmberIcon titleAccess="Data not yet processed" />;
    }
}

function CameraDetailsList({ data, columns, handleAction, CustomComponent }) {
    const { activeTab, sensor, platform } = useContext(CameraAccordionContext);
    const [open, setOpen] = useState(false);
    const [selectedItem, setSelectedItem] = useState(null);
    const [selectedColumn, setSelectedColumn] = useState(null);

    const handleClickOpen = (item, column) => {
        setOpen(true);
        setSelectedItem(item);
        setSelectedColumn(column.actionType);
    };

    const handleClose = () => {
        setOpen(false);
        setSelectedItem(null);
    };

    return (
        <>
            <List>
                {/* Render the header row for column titles */}
                <ListItem style={{ backgroundColor: "#f5f5f5" }}>
                    <Grid container>
                        {columns.map((column) => (
                            <Grid item xs key={column.label}>
                                <ListItemText primary={column.label} />
                            </Grid>
                        ))}
                    </Grid>
                </ListItem>

                {/* Render the data rows */}
                {data.map((item, index) => (
                    <ListItem key={index}>
                        <Grid container alignItems="center">
                            {columns.map((column) => (
                                <Grid item xs key={column.label}>
                                    <RenderItem
                                        item={item}
                                        column={column}
                                        handleAction={handleAction}
                                        handleClickOpen={handleClickOpen}
                                    />
                                </Grid>
                            ))}
                        </Grid>
                    </ListItem>
                ))}
            </List>
            {CustomComponent[selectedColumn] &&
                React.createElement(CustomComponent[selectedColumn], {
                    open: open,
                    onClose: handleClose,
                    item: selectedItem,
                    activeTab: activeTab,
                    platform: platform,
                    sensor: sensor,
                })}
        </>
    );
}

function NestedAccordion({ data, columns, summary, handleAction, CustomComponent }) {
    return (
        <Accordion sx={{ width: "100%" }}>
            <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                sx={{
                    flexDirection: "row-reverse",
                    "& .MuiAccordionSummary-expandIconWrapper.Mui-expanded": {
                        transform: "rotate(-90deg)",
                    },
                    "& .MuiAccordionSummary-expandIconWrapper": {
                        marginRight: "auto",
                    },
                    backgroundColor: "#f5f5f5",
                    "&:hover": {
                        backgroundColor: "#e0e0e0",
                    },
                }}
            >
                <Typography sx={{ fontWeight: "bold", ml: 2 }}>{summary}</Typography>
            </AccordionSummary>
            <AccordionDetails>
                <CameraDetailsList
                    data={data}
                    columns={columns}
                    handleAction={handleAction}
                    CustomComponent={CustomComponent}
                />
            </AccordionDetails>
        </Accordion>
    );
}

export function CamerasAccordion({ nestedAccordions, activeTab, platform, sensor, handleAction, CustomComponent }) {
    return (
        <CameraAccordionContext.Provider value={{ activeTab, sensor, platform }}>
            <List>
                {nestedAccordions.map((nestedItem, index) => (
                    <NestedAccordion
                        key={index}
                        summary={nestedItem.summary}
                        data={nestedItem.data}
                        columns={nestedItem.columns}
                        handleAction={handleAction}
                        CustomComponent={CustomComponent}
                    />
                ))}
            </List>
        </CameraAccordionContext.Provider>
    );
}

export function NestedSection({ title, nestedData, activeTab, handleAction, CustomComponent }) {
    return (
        <Accordion sx={{ width: "100%", my: 2 }}>
            <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                sx={{
                    backgroundColor: "#e0e0e0",
                    flexDirection: "row-reverse",
                    "& .MuiAccordionSummary-expandIconWrapper.Mui-expanded": { transform: "rotate(-90deg)" },
                    "&:hover": { backgroundColor: "#d0d0d0" },
                }}
            >
                <Typography sx={{ fontWeight: "bold", marginLeft: "8px" }}>{title}</Typography>
            </AccordionSummary>
            <AccordionDetails>
                {nestedData.map((nestedItem, index) => (
                    <Box key={index} sx={{ width: "100%" }}>
                        <CamerasAccordion
                            nestedAccordions={[nestedItem]}
                            activeTab={activeTab}
                            platform={title}
                            sensor={nestedItem.summary}
                            handleAction={handleAction}
                            CustomComponent={CustomComponent}
                        />
                    </Box>
                ))}
            </AccordionDetails>
        </Accordion>
    );
}

// Custom styled component for the Tabs
export const FolderTabs = styled(Tabs)({
    borderBottom: "1px solid #e0e0e0",
    "& .MuiTabs-indicator": {
        display: "none", // Hide the default indicator
    },
    justifyContent: "center", // Center the tabs
    flexGrow: 1,
    minWidth: 0,
});

// Custom styled component for the Tab
export const FolderTab = styled(Tab)({
    textTransform: "none",
    fontWeight: "bold",
    marginRight: "4px", // Space between tabs
    color: "black",
    backgroundColor: "#f5f5f5", // Default non-selected background color
    "&.Mui-selected": {
        backgroundColor: "#fff", // Selected tab background color
        borderTop: "3px solid #000", // Mimic the folder divider look
        borderLeft: "1px solid #e0e0e0",
        borderRight: "1px solid #e0e0e0",
        borderBottom: "none", // This ensures the selected tab merges with the content area
        color: "black",
    },
    "&:hover": {
        backgroundColor: "#fff", // Hover background color
        opacity: 1,
    },
    borderRadius: "8px 8px 0 0", // Round the top corners
});
