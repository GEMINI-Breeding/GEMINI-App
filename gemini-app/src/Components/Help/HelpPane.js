import React, { useContext } from "react";
import { ActiveComponentsContext } from "../../ActiveComponentsContext";
import { styled } from "@mui/system";

const HelpStyled = styled("div")(({ theme }) => ({
    width: "250px", // Adjust the width as needed
    padding: theme.spacing(2),
    // Add more styling as required
}));

const HelpPane = () => {
    const { activeComponents } = useContext(ActiveComponentsContext);

    if (activeComponents.has("FileUploadComponent")) {
        return (
            <HelpStyled>
                <div>
                    <h2>Data Types</h2>
                    <p>
                        <b>Image Data:</b> This is the raw image files taken from the sensing platforms. Some image types include: jpg, jpeg, png, or tif.
                    </p>
                    <p>
                        <b>Amiga File:</b> This is the .bin that is outputted from Farm-ng's Amiga platform. This file contains the raw data from the sensors.
                    </p>
                    <p>
                        <b>Weather Data:</b> This is a csv file containing temperature and humidity data for a respective date.
                    </p>
                    <p>
                        <b>Field Design:</b> This is a csv file containing field these properties
                    </p>
                    <ul>
                        <li>
                            <b>Year</b> (optional): The year of the experiment. If not provided, the current year will be used.
                        </li>
                        <li>
                            <b>Plot</b>: The unique plot number associated with each plant.
                        </li>
                        <li>
                            <b>Accession</b>: the unique accession number associated with each plant.
                        </li>
                        <li>
                            <b>Location</b>: The location of the experiment.
                        </li>
                        <li>
                            <b>Population</b>: The population from which the plants were selected.
                        </li>
                        <li>
                            <b>Row</b>: The row number of the plot.
                        </li>
                        <li>
                            <b>Column</b>: The column number of the plot.
                        </li>
                    </ul>
                    <p>
                        <b>GCP Locations:</b> This is a csv file containing locations of GCPs. The first column should contain the label, the second column contains latitude and the third column contains longitude.
                    </p>
                    <h2>Active Components</h2>
                    <ul>
                        {[...activeComponents].map((componentName) => (
                            <li key={componentName}>{componentName}</li>
                        ))}
                    </ul>
                </div>
            </HelpStyled>
        );
    }
    
    // return (
    //     <HelpStyled>
    //         {/* If File Upload Component */}
    //         if (activeComponents.has("FileUploadComponent")) {
    //             <h2>File Upload Component</h2>
    //             <p>Instructions for File Upload Component</p>
    //         }
            
    //         <h2>Active Components</h2>
    //         <ul>
    //             {[...activeComponents].map((componentName) => (
    //                 <li key={componentName}>{componentName}</li>
    //             ))}
    //         </ul>
    //     </HelpStyled>
    // );
};

export default HelpPane;
