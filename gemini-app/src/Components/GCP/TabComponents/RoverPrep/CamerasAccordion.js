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
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

// This component will be used for the lowest level list that contains the dates and checkboxes
function CameraDetailsList({ data, columns }) {
    return (
        <List>
            {/* Render the header row */}
            <ListItem style={{ backgroundColor: "#f5f5f5" }}>
                <Grid container alignItems="center">
                    {columns.map((column) => (
                        <Grid item xs key={column.label}>
                            <Typography variant="subtitle2" style={{ fontWeight: "bold" }}>
                                {column.label}
                            </Typography>
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
                                {column.label === "Date" ? (
                                    <ListItemText primary={item[column.field]} />
                                ) : (
                                    <Checkbox checked={item[column.field]} disabled />
                                )}
                            </Grid>
                        ))}
                    </Grid>
                </ListItem>
            ))}
        </List>
    );
}

// This component represents the nested or terminal accordions that contain the actual data
function NestedAccordion({ data, columns, summary }) {
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
                <CameraDetailsList data={data} columns={columns} />
            </AccordionDetails>
        </Accordion>
    );
}

// This is the top-level accordion that contains nested accordions or lists
export function CamerasAccordion({ nestedAccordions }) {
    return (
        <List>
            {nestedAccordions.map((nestedItem, index) => (
                <NestedAccordion
                    key={index}
                    summary={nestedItem.summary}
                    data={nestedItem.data}
                    columns={nestedItem.columns}
                />
            ))}
        </List>
    );
}

export function NestedSection({ title, nestedData }) {
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
                        <CamerasAccordion nestedAccordions={[nestedItem]} />
                    </Box>
                ))}
            </AccordionDetails>
        </Accordion>
    );
}
