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
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

function CameraListItem({ item, columns }) {
    // This component will render each item (date) with its checkboxes based on the columns provided
    return (
        <ListItem>
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
    );
}

export default function CamerasAccordion({ data, columns }) {
    // `data` is an array of objects with dynamic keys
    // `columns` is an array of objects describing the columns
    return (
        <Accordion>
            <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                aria-controls="panel-camera-content"
                id="panel-camera-header"
            >
                <Typography>RGB Camera</Typography>
            </AccordionSummary>
            <AccordionDetails>
                <List>
                    {data.map((item, index) => (
                        <CameraListItem key={index} item={item} columns={columns} />
                    ))}
                </List>
            </AccordionDetails>
        </Accordion>
    );
}
