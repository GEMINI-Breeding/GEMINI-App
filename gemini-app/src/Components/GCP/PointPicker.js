import React, { useState, useEffect } from "react";
import { useDataState, useDataSetters } from "../../DataContext";
import {
    CircularProgress,
} from "@mui/material";

const PointPicker = ({ src }) => {
    const { 
        imageList, 
        imageIndex, 
        gcpPath, 
        flaskUrl, 
        sliderMarks, 
        imageViewerLoading,
        selectedSensorGCP,
        selectedPlatformGCP
    } = useDataState();
    const { 
        setImageList, 
        setSliderMarks, 
        setImageViewerLoading
    } = useDataSetters();
    
    const [pointPosition, setPointPosition] = useState({ x: null, y: null });

    const CustomMark = ({ color }) => (
        <div style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: color }} />
    );

    const saveData = async (imageList) => {
        console.log("Saving Data");
        console.log("Image List: ", imageList);

        try {
            const response = await fetch(`${flaskUrl}save_array`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    array: imageList,
                    platform: selectedPlatformGCP,
                    sensor: selectedSensorGCP
                }),
            });

            const result = await response.json();

            if (response.ok) {
                console.log(result.message); // or handle the success message however you like
            } else {
                console.error("Error saving data:", result.message); // or handle the error however you like
            }
        } catch (error) {
            console.error("Network error:", error);
        }
    };

    useEffect(() => {
        const currentImage = imageList[imageIndex];
        console.log("Current Image: ", currentImage);
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
    }, [imageIndex]);

    useEffect(() => {
        // If any image has a point, save the data
        const hasPoint = imageList.some((image) => image.pointX && image.pointY);
        if (hasPoint) {
            //saveData(imageList);
            const imageListCleaned = imageList
                .map((image) => {
                    // If the image contains null values, remove it from the list
                    if (image.pointX === null || image.pointY === null) {
                        return null;
                    } else {
                        return image;
                    }
                })
                .filter((image) => image !== null);
            saveData(imageListCleaned);
        }

        const marks = imageList.map((img, index) => {
            return {
                value: index,
                label:
                    img.pointX && img.pointY ? (
                        <CustomMark color="red" style={{ width: 16, height: 16 }} />
                    ) : (
                        <CustomMark color="rgba(255,255,255,0)" />
                    ),
            };
        });
        setSliderMarks(marks);

        console.log("Slider Marks: ", marks);
    }, [imageList]);

    const distanceBetween = (x1, y1, x2, y2) => {
        return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
    };

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

    const handleImageRightClick = (event) => {
        event.preventDefault(); // Prevent the default context menu from showing.

        const imgElement = event.target;
        const widthRatio = imgElement.naturalWidth / imgElement.width;
        const heightRatio = imgElement.naturalHeight / imgElement.height;
        const x = event.nativeEvent.offsetX;
        const y = event.nativeEvent.offsetY;
        const originalX = Math.round(x * widthRatio);
        const originalY = Math.round(y * heightRatio);

        const currentImage = imageList[imageIndex];
        const pointX = (currentImage.pointX / currentImage.naturalWidth) * imgElement.width;
        const pointY = (currentImage.pointY / currentImage.naturalHeight) * imgElement.height;

        const distance = distanceBetween(pointX, pointY, x, y);

        const allowableDistance = 20; // You can adjust this value as desired.

        if (distance < allowableDistance) {
            // User right-clicked close to the point, so remove the point.
            const updatedImageList = [...imageList];
            updatedImageList[imageIndex].pointX = null;
            updatedImageList[imageIndex].pointY = null;
            setImageList(updatedImageList);
            setPointPosition({ x: null, y: null });
        }
    };

    const handleImageLoad = (event) => {
        setImageViewerLoading(false)
        const imgElement = event.target;
        const updatedImageList = [...imageList];
        updatedImageList[imageIndex].naturalWidth = imgElement.naturalWidth;
        updatedImageList[imageIndex].naturalHeight = imgElement.naturalHeight;
        setImageList(updatedImageList);
    };

    useEffect(() => {
        setImageViewerLoading(true)
        console.log("Loading...")
    }, [imageIndex]);
    
    return (
        <div style={{ position: "relative", width: "100%", height: "auto" }}>
            <img
                src={src}
                alt="Point Picker"
                onClick={handleImageClick}
                onLoad={handleImageLoad}
                onContextMenu={handleImageRightClick}
                style={{ display: imageViewerLoading ? 'none' : 'block', cursor: "crosshair", width: "100%", height: "auto" }}
            />
            {pointPosition.x !== null && pointPosition.y !== null && (
                <div
                    style={{
                        position: "absolute",
                        top: `${pointPosition.y}%`,
                        left: `${pointPosition.x}%`,
                        transform: "translate(-50%, -50%)",
                        width: "10px",
                        height: "10px",
                        backgroundColor: "red",
                        borderRadius: "50%",
                        pointerEvents: "none",
                    }}
                />
            )}
        </div>
    );
};

export default PointPicker;
