import React, { useState, useEffect } from 'react';
import { useDataState, useDataSetters } from '../../DataContext';

const PointPicker = ({ src }) => {
    const { imageList, imageIndex } = useDataState();
    const { setImageList } = useDataSetters();

    const [pointPosition, setPointPosition] = useState({ x: null, y: null });

    useEffect(() => {
        const currentImage = imageList[imageIndex];
        if (currentImage.pointX && currentImage.pointY) {
            setPointPosition({
                x: (currentImage.pointX / currentImage.naturalWidth) * 100,
                y: (currentImage.pointY / currentImage.naturalHeight) * 100,
            });
        } else {
            setPointPosition({ x: null, y: null });
        }
        console.log("Current Image: ", currentImage);
        console.log("Calculated Position: ", {
            x: (currentImage.pointX / currentImage.naturalWidth) * 100,
            y: (currentImage.pointY / currentImage.naturalHeight) * 100,
        });
        console.log("Point X: ", currentImage.pointX);
        console.log("Point Y: ", currentImage.pointY);
        console.log("Natural Width: ", currentImage.naturalWidth);
        console.log("Natural Height: ", currentImage.naturalHeight);

    }, [imageIndex, imageList]);

    const handleImageClick = (event) => {
        const imgElement = event.target;
        const widthRatio = imgElement.naturalWidth / imgElement.width;
        const heightRatio = imgElement.naturalHeight / imgElement.height;
        const x = event.nativeEvent.offsetX;
        const y = event.nativeEvent.offsetY;
        const originalX = Math.round(x * widthRatio);
        const originalY = Math.round(y * heightRatio);
    
        const updatedImageList = [...imageList];
        updatedImageList[imageIndex].pointX = originalX;
        updatedImageList[imageIndex].pointY = originalY;
        setImageList(updatedImageList);
    
        // Set relative position in percentages for the point
        const newX = (x / imgElement.width) * 100;
        const newY = (y / imgElement.height) * 100;
        setPointPosition({ x: newX, y: newY });
    };    

    const handleImageLoad = (event) => {
        const imgElement = event.target;
        const updatedImageList = [...imageList];
        updatedImageList[imageIndex].naturalWidth = imgElement.naturalWidth;
        updatedImageList[imageIndex].naturalHeight = imgElement.naturalHeight;
        setImageList(updatedImageList);
    };    

    return (
        <div style={{ position: 'relative', width: '100%', height: 'auto' }}>
        <img 
            src={src} 
            alt="Point Picker" 
            onClick={handleImageClick}
            onLoad={handleImageLoad}  // Add this line
            style={{ cursor: 'crosshair', width: '100%', height: 'auto' }}
        />
            {pointPosition.x !== null && pointPosition.y !== null && (
                <div
                    style={{
                        position: 'absolute',
                        top: `${pointPosition.y}%`,
                        left: `${pointPosition.x}%`,
                        transform: 'translate(-50%, -50%)',
                        width: '10px',
                        height: '10px',
                        backgroundColor: 'red',
                        borderRadius: '50%',
                        pointerEvents: 'none',
                    }}
                />
            )}
        </div>
    );
};

export default PointPicker;
