import React from 'react';
import { useDataState, useDataSetters } from '../../DataContext';
import Button from '@mui/material/Button';
import PointPicker from './PointPicker';

const API_ENDPOINT = 'http://127.0.0.1:5001/flask_app/files';

const ImageViewer = () => {
    const {
        imageIndex,
        imageList,
        imageViewerLoading,
        imageViewerError
    } = useDataState();

    const {
        setImageIndex,
        setImageList,
        setImageViewerLoading,
        setImageViewerError
    } = useDataSetters();

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
        <div style={{ textAlign: 'center', position: 'relative', width: '100%' }}>
            {imageList.length > 0 ? (
                <>
                    <PointPicker src={API_ENDPOINT + imageList[imageIndex].image_path} />
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '20px' }}>
                        <Button variant='contained' onClick={handlePrevious}>Previous</Button>
                        <Button variant='contained' onClick={handleNext}>Next</Button>
                    </div>
                </>
            ) : (
                <p>No images to display</p>
            )}
        </div>
    );
};

export default ImageViewer;