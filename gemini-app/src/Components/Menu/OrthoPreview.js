import React, { useState, useEffect } from 'react';
import { Dialog, CircularProgress, Typography } from '@mui/material';
import { getTifToPng } from '../../api/files';
import { FRAMEWORK_URL } from '../../api/config';

const OrthoPreview = ({ open, onClose, imageUrl }) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [imageSrc, setImageSrc] = useState(null);

    useEffect(() => {
        if (open && imageUrl) {
            setLoading(true);
            setError(null);

            getTifToPng({ filePath: imageUrl })
                .then(result => {
                    if (result.url) {
                        setImageSrc(result.url);
                        setLoading(false);
                    } else if (result.id) {
                        // Job submitted — use the download URL for the converted PNG
                        const pngPath = imageUrl.replace(/\.tif$/i, '.png');
                        setImageSrc(`${FRAMEWORK_URL}files/download/gemini/${pngPath}`);
                        setLoading(false);
                    }
                })
                .catch(error => {
                    console.error('Error fetching image:', error);
                    setError(`Failed to fetch image. Error: ${error.message}`);
                    setLoading(false);
                });
        }
    }, [open, imageUrl]);

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
