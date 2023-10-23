// PlotBoundaryPrep.js
import React, { useState } from 'react';
import Stepper from '@mui/material/Stepper';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Grid from '@mui/material/Grid';
//import StepIconProps from '@mui/material/StepIconProps';

function PlotBoundaryPrep() {
    const [activeStep, setActiveStep] = useState(0);
    const steps = ['Step 1', 'Step 2', 'Step 3'];  // Adjust as needed

    const largerIconStyle = {
        fontSize: '3rem',   // Adjust for desired size
        fontWeight: 'normal',
        textAlign: 'center'
    };

    return (
        <Grid container direction="column" spacing={2} style={{ width: '80%', margin: '0 auto' }}>
            <Grid item style={{width: '100%'}}>
                <Stepper activeStep={activeStep} style={{ padding: '8px 0', background: 'transparent' }}>
                    {steps.map((label, index) => (
                        <Step key={index}>
                            <StepLabel StepIconProps={{ style: largerIconStyle }}>{
                                <span style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>{label}</span>
                            }</StepLabel>
                        </Step>
                    ))}
                </Stepper>
            </Grid>
            <Grid item>
                {activeStep === 0 && <div align='center' >Content for Step 1</div>}
                {activeStep === 1 && <div align='center' >Content for Step 2</div>}
                {activeStep === 2 && <div align='center' >Content for Step 3</div>}
            </Grid>
        </Grid>
    );
}

export default PlotBoundaryPrep;
