import React from "react";
import {
    Accordion,
    AccordionSummary,
    AccordionDetails,
    List,
    ListItem,
    ListItemText,
    Checkbox,
    TextField,
    Typography,
    Grid,
    Box,
    Button,
    Dialog,
    DialogTitle
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { TrainMenu } from './TrainModel';

function RenderItem({ item, column, handleClickOpen, dateValue }) {
    if (column.label === "Date") {
        return <ListItemText primary={item[column.field]} />;
    } else if (column.label === "Model") {
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
function CameraDetailsList({ data, columns, activeTab, sensor }) {
    const [open, setOpen] = React.useState(false);
    const [locateDate, setLocateDate] = React.useState('');

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
                                    />
                                </Grid>
                            ))}
                        </Grid>
                    </ListItem>
                ))}
            </List>
            <TrainMenu open={open} onClose={handleClose} locateDate={locateDate} activeTab={activeTab} sensor={sensor} />
        </>
    );
}

// This component represents the nested or terminal accordions that contain the actual data
function NestedAccordion({ data, columns, summary, activeTab, sensor }) {
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
                <CameraDetailsList data={data} columns={columns} activeTab={activeTab} sensor={sensor} />
            </AccordionDetails>
        </Accordion>
    );
}

// This is the top-level accordion that contains nested accordions or lists
export function CamerasAccordion({ nestedAccordions, activeTab, sensor }) {
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
                />
            ))}
        </List>
    );
}

export function NestedSection({ title, nestedData, activeTab }) {
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
                        <CamerasAccordion nestedAccordions={[nestedItem]} activeTab={activeTab} sensor={title} />
                    </Box>
                ))}
            </AccordionDetails>
        </Accordion>
    );
}
