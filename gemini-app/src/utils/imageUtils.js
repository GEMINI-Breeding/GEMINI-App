/**
 * Pure utility functions for image list operations.
 */

export function mergeLists(imageList, existingData) {
    // Create a lookup object for faster search using image name
    const dataLookup = existingData.reduce((acc, image) => {
        acc[image.image_path.split("/").pop()] = image;
        return acc;
    }, {});

    // Merge the lists
    return imageList.map((image) => {
        const imageName = image.image_path.split("/").pop();
        if (dataLookup[imageName]) {
            // If the image name exists in the previous data, append pointX and pointY
            return {
                ...image,
                pointX: dataLookup[imageName].pointX,
                pointY: dataLookup[imageName].pointY,
            };
        }
        return image; // Return the image as it is if no match found
    });
}
