import React, { useContext, useEffect } from "react";
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
                        <li><b>Year</b> (optional): The year of the experiment. If not provided, the current year will be used.</li>
                        <li><b>Plot</b>: The unique plot number associated with each plant.</li>
                        <li><b>Accession</b>: the unique accession number associated with each plant.</li>
                        <li><b>Location</b>: The location of the experiment.</li>
                        <li><b>Population</b>: The population from which the plants were selected.</li>
                        <li><b>Row</b>: The row number of the plot.</li>
                        <li><b>Column</b>: The column number of the plot.</li>
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
    } else if (activeComponents.has("TabbedPrepUI")) {
        return (
            <HelpStyled>
                <div>
                    <h1>Ground-Based Processing</h1>
                    <h2>Locate Plants</h2>
                        This functionality locates each plant for a given population. Each of these tasks must be done sequentially:
                        <ol>
                            <li><b>Labels</b>: Upload labels of plants using CVAT for a given date. To open CVAT, click the Annotate
                                button. After annotating in CVAT, export your label in YOLO format, and then upload your .txt label
                                files here. Press Upload when finished. </li>
                            <li><b>Model</b>: Train a deep learning model for individual plant detection. Each model trained can be tracked
                            using its Model ID. Best performing models are recommended to use for Locations. </li>
                            <li><b>Locations</b>: Locate each plant in a population for a given date. The user inputs their model of choice 
                            to run this function. Best performing models are recommended to use for Locations. </li>
                        </ol>
                    <h2>Label Traits</h2>
                        This section allows users to upload their annotations for each trait. To open CVAT, click the Annotate
                        button. After annotating in CVAT, export your label in YOLO format, and then upload your .txt label
                        files here. Press Upload when finished.
                    <h2>Teach Traits</h2>
                        This section train models to detect the selected trait. First, select a trait to teach. Then, input the platform, sensor
                        and date of choice to train the model. 
                    <h2>Extract Traits</h2>
                        This section allows users to extract the selected trait for a given population and date. First, select a trait to teach. 
                        Then, input the platform, sensor and date of choice to extract the specified trait. It is recommended to use the highest
                        performing model and locations.  
                </div>
            </HelpStyled>
        );
    } else {
        return (
            <HelpStyled>                
                <h2>Active Components</h2>
                <ul>
                    {[...activeComponents].map((componentName) => (
                        <li key={componentName}>{componentName}</li>
                    ))}
                </ul>
            </HelpStyled>
        );
    }
};

export default HelpPane;
