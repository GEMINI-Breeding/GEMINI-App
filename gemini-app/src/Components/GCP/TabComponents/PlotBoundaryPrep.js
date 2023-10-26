// PlotBoundaryPrep.js
import React, { useState } from 'react';
import Stepper from '@mui/material/Stepper';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Grid from '@mui/material/Grid';
import DeckGL from "@deck.gl/react";
import { StaticMap } from "react-map-gl";
import { EditableGeoJsonLayer, TranslateMode } from "nebula.gl";
//import StepIconProps from '@mui/material/StepIconProps';

const fc = {
    type: "FeatureCollection",
    features: []
};

const initialViewState = {
    latitude: 63,
    longitude: 16.5,
    zoom: 6
};

function PlotBoundaryPrep() {
    const [activeStep, setActiveStep] = useState(0);
    const steps = ['Step 1', 'Step 2', 'Step 3'];  // Adjust as needed

    const largerIconStyle = {
        fontSize: '3rem',   // Adjust for desired size
        fontWeight: 'normal',
        textAlign: 'center'
    };

    const [featureCollection, setFetureCollection] = useState(fc);
    const [selectedFeIndex, setSelectedFeIndex] = useState(0);

    const selectedFeatureIndexes = [selectedFeIndex]; //[...Array(featureCollection.features.length).keys()]

    const layer = new EditableGeoJsonLayer({
        data: featureCollection,
        mode: TranslateMode,
        pickable: true,
        selectedFeatureIndexes: selectedFeatureIndexes,
        autoHighlight: true,
        onClick: (info, event) => {
            setSelectedFeIndex(info.index);
        },
        onEdit: ({ updatedData }) => {
            console.log("onEdit: ", updatedData);
            setFetureCollection(updatedData);
        }
    });

    console.log("layer: ", layer);

    return (
        <Grid container direction="column" spacing={2} style={{ width: '80%', margin: '0 auto' }}>
            <Grid item style={{ width: '100%' }}>
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
            < Grid item container justifyContent="center" spacing={2}>
                <div>
                    <DeckGL
                        initialViewState={initialViewState}
                        controller={{ doubleClickZoom: false }}
                        layers={[layer]}
                    >
                        <StaticMap
                            mapStyle={"mapbox://styles/mapbox/light-v10"}
                            mapboxApiAccessToken={process.env.REACT_APP_MAPBOX_TOKEN}
                        />
                    </DeckGL>
                </div>
            </Grid>
        </Grid>
    );
}

export default PlotBoundaryPrep;
