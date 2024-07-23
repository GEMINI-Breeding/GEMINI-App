import React, { useEffect } from "react";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";

import { fetchData, useDataSetters, useDataState } from "../../DataContext.js";

const LoadGraphModal = ({ open, onClose, item }) => {
    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedYearGCP,
        selectedExperimentGCP,
    } = useDataState();

    const { setNowDroneProcessing 

    } = useDataSetters();

 

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth={false}>
            <DialogTitle style={{ textAlign: "center", fontWeight: "bold", fontSize: "x-large" }}>
                {item && item.date || "Graph Tab"}
            </DialogTitle>
            <DialogContent>
                <img src="/graph_sample.jpg" alt="Place holder for Graph Tab" style={{ maxWidth: "100%" }}/>
                <Grid container spacing={1} justifyContent="center" alignItems="center" style={{ marginTop: "20px" }}>
                    <Grid item>
                        <Button variant="contained" color="primary"  onClick={onClose}>
                            Close
                        </Button>
                    </Grid>
                </Grid>
            </DialogContent>
        </Dialog>
    );
};

export default LoadGraphModal;
