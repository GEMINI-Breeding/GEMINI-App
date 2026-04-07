import React, { useState, useEffect } from 'react';
import { Dialog, CircularProgress, Typography } from '@mui/material';
import { getTifToPng } from '../../api/files';
import { connectJobProgress } from '../../api/jobs';
import { FRAMEWORK_URL } from '../../api/config';

const OrthoPreview = ({ open, onClose, imageUrl }) => {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [imageSrc, setImageSrc] = useState(null);
    const [statusText, setStatusText] = useState('');

    useEffect(() => {
        if (!open || !imageUrl) return;
        let ws = null;

        const loadImage = async () => {
            setLoading(true);
            setError(null);
            setStatusText('Checking for preview image...');

            try {
                const result = await getTifToPng({ filePath: imageUrl });

                if (result.url) {
                    setImageSrc(result.url);
                    setLoading(false);
                    return;
                }

                if (result.id) {
                    setStatusText('Converting orthophoto to PNG for preview...');
                    const pngPath = imageUrl.replace(/\.tif$/i, '.png');

                    ws = connectJobProgress(result.id, {
                        onProgress: (data) => {
                            setStatusText(`Converting... ${Math.round(data.progress || 0)}%`);
                        },
                        onComplete: () => {
                            setImageSrc(`${FRAMEWORK_URL}files/download/gemini/${pngPath}`);
                            setLoading(false);
                        },
                        onError: (data) => {
                            setError(`Conversion failed: ${data.error_message || 'Unknown error'}`);
                            setLoading(false);
                        },
                    });
                }
            } catch (err) {
                console.error('Error fetching image:', err);
                setError(`Failed to fetch image: ${err.message}`);
                setLoading(false);
            }
        };

        loadImage();
        return () => { if (ws) ws.close(); };
    }, [open, imageUrl]);

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
                {loading && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                        <CircularProgress />
                        {statusText && <Typography variant="body2" color="textSecondary">{statusText}</Typography>}
                    </div>
                )}
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
