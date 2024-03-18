import React, { useState } from "react";
import { Importer, ImporterField } from "react-csv-importer";
import "react-csv-importer/dist/index.css";
import { useDataState, useDataSetters } from "../../../DataContext";
import ImportSettingsModal from "../../Util/ImportSettingsModal";

import useTrackComponent from "../../../useTrackComponent";

const DataImporter = () => {
    useTrackComponent("DataImporter");

    const { selectedLocationGCP, selectedPopulationGCP, selectedYearGCP, selectedExperimentGCP, flaskUrl } =
        useDataState();
    const { setActiveStepBoundaryPrep } = useDataSetters();

    const [importedData, setImportedData] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const handleClose = () => {
        setIsModalOpen(false);
        setActiveStepBoundaryPrep(1);
    };

    const sendDataToServer = async (data) => {
        // Prepare the data object to match the Flask endpoint's expectations
        const payload = {
            selectedLocationGcp: selectedLocationGCP,
            selectedPopulationGcp: selectedPopulationGCP,
            selectedYearGcp: selectedYearGCP,
            selectedExperimentGcp: selectedExperimentGCP,
            filename: "FieldDesign.csv",
            csvData: data,
        };

        try {
            const response = await fetch(`${flaskUrl}save_csv`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            });
            // Handle the response from the server
            const responseData = await response.json();
            console.log("Server response:", responseData);
        } catch (error) {
            console.error("Error sending data to server:", error);
        }
    };

    return (
        <div>
            <h2 id="instructions">Instructions</h2>
            <ol>
                <li>
                    <p>Prepare a CSV file with the following columns:</p>
                    <ul>
                        <li>
                            <strong>Year</strong> (optional): The year of the experiment. If not provided, the current
                            year will be used.
                        </li>
                        <li>
                            <strong>Plot</strong>: The unique plot number associated with each plot.
                        </li>
                        <li>
                            <strong>Accession</strong>: The unique accession number associated with each plant.
                        </li>
                        <li>
                            <strong>Location</strong>: The location of the experiment.
                        </li>
                        <li>
                            <strong>Population</strong>: The population from which the plants were selected.
                        </li>
                        <li>
                            <strong>Row</strong>: The row number of the plot.
                        </li>
                        <li>
                            <strong>Column</strong>: The column number of the plot.
                        </li>
                    </ul>
                </li>
                <li>
                    <p>
                        Drag the file to the box below to upload it. Use the interface to map the columns to the
                        required names if necessary.
                    </p>
                </li>
                <li>
                    <p>
                        Fill out the remaining information about the field to the best of your ability. You will have a
                        chance to adjust the parameters in a future step, where the plots will be displayed on a map.
                    </p>
                </li>
            </ol>
            <Importer
                dataHandler={async (rows, { startIndex }) => {
                    // Accumulate rows of data
                    console.log(rows); // Log to check the parsed data
                    setImportedData((currentData) => [...currentData, ...rows]);
                }}
                defaultNoHeader={false}
                restartable={false}
                onComplete={() => {
                    // Send accumulated data to the server
                    sendDataToServer(importedData);
                    console.log("Data sent to server:", importedData);
                    setIsModalOpen(true);
                }}
            >
                <ImporterField name="year" label="Year" optional />
                <ImporterField name="plot" label="Plot" />
                <ImporterField name="accession" label="Accession" />
                <ImporterField name="location" label="Location" />
                <ImporterField name="population" label="Population" />
                <ImporterField name="row" label="Row" />
                <ImporterField name="col" label="Column" />
            </Importer>
            <ImportSettingsModal importedData={importedData} onClose={() => handleClose()} open={isModalOpen} />
        </div>
    );
};

export default DataImporter;
