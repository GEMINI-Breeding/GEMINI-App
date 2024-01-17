import React from "react";
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
import { TrainMenu } from "./TrainModel";
import { styled } from "@mui/material/styles";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";

function RenderItem({ item, column, handleClickOpen, dateValue, trainModel }) {
    if (column.label === "Date") {
        return <ListItemText primary={item[column.field]} />;
    } else if (column.label === "Model" && trainModel) {
        return item[column.field] ? (
            <Checkbox checked disabled />
        ) : (
            <Button
                onClick={() => handleClickOpen(dateValue)} // Pass the date here
                style={{
                    backgroundColor: "#1976d2",
                    color: "white",
                    borderRadius: "4px",
                }}
            >
                Start
            </Button>
        );
    } else {
        return <Checkbox checked={item[column.field]} disabled />;
    }
}

// This component will be used for the lowest level list that contains the dates and checkboxes
function CameraDetailsList({ data, columns, activeTab, sensor, trainModel }) {
    const [open, setOpen] = React.useState(false);
    const [locateDate, setLocateDate] = React.useState("");

    const handleClickOpen = (date) => {
        setOpen(true);
        setLocateDate(date);
    };

    const handleClose = () => {
        setOpen(false);
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
                                        handleClickOpen={handleClickOpen}
                                        dateValue={item.date} // Assuming 'date' is the property name
                                        trainModel={trainModel}
                                    />
                                </Grid>
                            ))}
                        </Grid>
                    </ListItem>
                ))}
            </List>
            <TrainMenu
                open={open}
                onClose={handleClose}
                locateDate={locateDate}
                activeTab={activeTab}
                sensor={sensor}
            />
        </>
    );
}

// This component represents the nested or terminal accordions that contain the actual data
function NestedAccordion({ data, columns, summary, activeTab, sensor, trainModel }) {
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
                        marginRight: "auto", // moves the icon to the left
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
                    activeTab={activeTab}
                    sensor={sensor}
                    trainModel={trainModel}
                />
            </AccordionDetails>
        </Accordion>
    );
}

// This is the top-level accordion that contains nested accordions or lists
function CamerasAccordion({ nestedAccordions, activeTab, sensor, trainModel }) {
    return (
        <List>
            {nestedAccordions.map((nestedItem, index) => (
                <NestedAccordion
                    key={index}
                    summary={nestedItem.summary}
                    data={nestedItem.data}
                    columns={nestedItem.columns}
                    activeTab={activeTab}
                    sensor={sensor}
                    trainModel={trainModel}
                />
            ))}
        </List>
    );
}

export function NestedSection({ title, nestedData, activeTab, trainModel }) {
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
                            sensor={title}
                            trainModel={trainModel}
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
