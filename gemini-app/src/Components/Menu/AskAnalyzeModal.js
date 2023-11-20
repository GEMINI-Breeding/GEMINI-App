import React from 'react';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Autocomplete from '@mui/material/Autocomplete';
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';

import { useDataState, useDataSetters } from '../../DataContext';

const AskAnalyzeodal = () => {

    const {
        nowDroneProcessing,
        isAskAnalyzeModalOpen,
        selectedDate,
        selectedSensor,
    } = useDataState();

    const {
        setAskAnalyzeModalOpen,
        setNowDroneProcessing
    } = useDataSetters();

    // Process sliderMarks to check the label value for pointX and pointY
    // const labeledGcpImages = sliderMarks.filter((mark) => mark.label.props.color !== "rgba(255,255,255,0)");
    // const labeledGcpImagesCount = labeledGcpImages.length;


    return (
        <Dialog open={isAskAnalyzeModalOpen} onClose={() => setAskAnalyzeModalOpen(false)} maxWidth='md' fullWidth={false}>
            <DialogTitle style={{ textAlign: 'center', fontWeight: 'bold', fontSize: 'x-large' }}>
                {selectedDate} {selectedSensor} data is not analazed yet. 
            </DialogTitle>
            <DialogContent>
                Would you like to process it now?

                <Grid container spacing={1} justifyContent="center" alignItems="center" style={{ marginTop: '20px' }}>
                    <Grid item>
                        <Button
                            variant="contained"
                            color="primary"
                            disabled={nowDroneProcessing}
                            onClick={() => {
                                console.log(selectedSensor)
                                if (selectedSensor === "Drone") {
                                    setNowDroneProcessing(true)
                                } else {
                                    // Place holder for other sensors
                                }
                            }
                            }
                        >
                            {nowDroneProcessing ? "Analyzing" : "Analyze"}
                            {nowDroneProcessing && <CircularProgress size={24} style={{ marginLeft: '14px' }} />}
                        </Button>
                    </Grid>
                    <Grid item >
                        <Button
                            variant="contained"
                            color="primary"
                            disabled={nowDroneProcessing}
                            onClick={() => { setAskAnalyzeModalOpen(false) }}
                        >
                            Close
                        </Button>
                    </Grid>
                </Grid>

            </DialogContent>
        </Dialog>
    );
};

export default AskAnalyzeodal;
