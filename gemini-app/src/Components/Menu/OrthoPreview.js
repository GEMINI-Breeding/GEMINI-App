import React, { useState, useEffect } from 'react';
import { Dialog, CircularProgress, Typography } from '@mui/material';
import { useDataState } from '../../DataContext';

const OrthoPreview = ({ open, onClose, imageUrl }) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [imageSrc, setImageSrc] = useState(null);
    const { flaskUrl } = useDataState();

    useEffect(() => {
        if (open && imageUrl) {
            setLoading(true);
            setError(null);
            fetch(`${flaskUrl}convert_tif_to_png`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ filePath: imageUrl }),
            })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    return response.blob();
                })
                .then(blob => {
                    const objectUrl = URL.createObjectURL(blob);
                    setImageSrc(objectUrl);
                    setLoading(false);
                })
                .catch(error => {
                    console.error('Error fetching image:', error);
                    setError(`Failed to fetch image. Error: ${error.message}`);
                    setLoading(false);
                });
        }
    }, [open, imageUrl, flaskUrl]);

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
                {loading && <CircularProgress />}
                {error && <Typography color="error">{error}</Typography>}
                {!loading && !error && imageSrc && (
                    <img 
                        src={imageSrc}
                        alt="Orthomosaic" 
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} 
                    />
                )}
            </div>
        </Dialog>
    );
};

export default OrthoPreview;