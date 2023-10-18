import React, { useState } from 'react';
import { useDataState, useDataSetters } from '../../DataContext';
import Button from '@mui/material/Button';
import Slider from '@mui/material/Slider';
import PointPicker from './PointPicker';
import OrthoModal from './OrthoModal';

const ImageViewer = () => {
    const {
        imageIndex,
        imageList,
        imageViewerLoading,
        imageViewerError,
        flaskUrl,
        sliderMarks,
    } = useDataState();

    const {
        setImageIndex,
        setImageList,
        setImageViewerLoading,
        setImageViewerError,
        setOrthoModalOpen
    } = useDataSetters();

    const API_ENDPOINT = `${flaskUrl}files`;

    const handlePrevious = () => {
        if (imageIndex > 0) {
            setImageIndex(imageIndex - 1);
        }
    };

    const handleNext = () => {
        if (imageIndex < imageList.length - 1) {
            setImageIndex(imageIndex + 1);
        }
    };

    if (imageViewerLoading) {
        return <p>Loading...</p>;
    }

    if (imageViewerError) {
        return <p>Error: {imageViewerError}</p>;
    }

    return (
        <div style={{ display: 'grid', height: '100vh', gridTemplateColumns: '1fr 80vw 1fr', gridTemplateRows: '1fr auto auto', gridGap: '5px', alignItems: 'center' }}>
            <div style={{ gridColumn: '2', display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', padding: '30px' }}>
                {imageList.length > 0 && (
                    <PointPicker style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} src={API_ENDPOINT + imageList[imageIndex].image_path} />
                )}
            </div>
            {imageList.length > 0 && (
                <Slider
                    value={imageIndex}
                    onChange={(event, newValue) => setImageIndex(newValue)}
                    aria-labelledby="image-slider"
                    step={1}
                    marks={sliderMarks}
                    min={0}
                    max={imageList.length - 1}
                    valueLabelDisplay="auto"
                    valueLabelFormat={(value) => `${value + 1} of ${imageList.length}`}
                    track={false}
                    style={{ gridColumn: '2', width: '50%', justifySelf: 'center' }}
                    sx={{'& .MuiSlider-rail': {
                            height: 10, // Increase rail and track thickness
                            width: '120%', 
                            // Center the track on the tick marks
                            marginLeft: '-10%',
                        },
                        '& .MuiSlider-thumb': {
                            width: 20,   // Increase thumb size
                            height: 20,
                        },

                    }}
                />
            )}
            {imageList.length > 0 && (
            <div style={{ gridColumn: '2', display: 'block', height: '50px', justifySelf: 'center', gap: '20px' }}>
                <Button variant='contained' onClick={handlePrevious}>Previous</Button>
                &nbsp;&nbsp;&nbsp;
                {imageIndex === imageList.length - 1 ? (
                <Button variant='contained' color="warning" onClick={() => setOrthoModalOpen(true)}>Generate Orthophoto</Button>
                ) : (
                    <Button variant='contained' onClick={handleNext}>Next</Button>
                )}
            </div>)}
            <OrthoModal />
        </div>
    );
};

export default ImageViewer;