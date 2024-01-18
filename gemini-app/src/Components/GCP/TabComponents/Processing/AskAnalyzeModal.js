import React, { useEffect } from "react";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { useDataState, useDataSetters, fetchData } from "../../../../DataContext";

const AskAnalyzeModal = ({ open, onClose, item }) => {
    const { flaskUrl, nowDroneProcessing, selectedLocationGCP, selectedPopulationGCP } = useDataState();

    const { setNowDroneProcessing } = useDataSetters();

    useEffect(() => {
        if (nowDroneProcessing && item) {
            const fetchUrl = `${flaskUrl}process_drone_tiff/${selectedLocationGCP}/${selectedPopulationGCP}/${item.date}`;
            fetchData(fetchUrl)
                .then(() => {
                    console.log("Drone tiff file processed!");
                    setNowDroneProcessing(false);
                    onClose();
                })
                .catch((error) => console.error("Error:", error));
        }
    }, [
        nowDroneProcessing,
        item,
        onClose,
        flaskUrl,
        selectedLocationGCP,
        selectedPopulationGCP,
        setNowDroneProcessing,
    ]);

    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth={false}>
            <DialogTitle style={{ textAlign: "center", fontWeight: "bold", fontSize: "x-large" }}>
                {item && item.date} is not analyzed yet.
            </DialogTitle>
            <DialogContent>
                Would you like to process it now?
                <Grid container spacing={1} justifyContent="center" alignItems="center" style={{ marginTop: "20px" }}>
                    <Grid item>
                        <Button
                            variant="contained"
                            color="primary"
                            disabled={nowDroneProcessing}
                            onClick={() => {
                                setNowDroneProcessing(true);
                            }}
                        >
                            {nowDroneProcessing ? "Analyzing" : "Analyze"}
                            {nowDroneProcessing && <CircularProgress size={24} style={{ marginLeft: "14px" }} />}
                        </Button>
                    </Grid>
                    <Grid item>
                        <Button variant="contained" color="primary" disabled={nowDroneProcessing} onClick={onClose}>
                            Close
                        </Button>
                    </Grid>
                </Grid>
            </DialogContent>
        </Dialog>
    );
};

export default AskAnalyzeModal;
