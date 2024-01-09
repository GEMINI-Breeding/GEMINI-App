import React, { useState } from "react";
import { Importer, ImporterField } from "react-csv-importer";
import "react-csv-importer/dist/index.css";
import { useDataState, useDataSetters } from "../../../DataContext";
import ImportSettingsModal from "../../Util/ImportSettingsModal";

const DataImporter = () => {
    const { selectedLocationGCP, selectedPopulationGCP, flaskUrl } = useDataState();
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
            selectedLocationGcp: selectedLocationGCP, // Replace with actual value
            selectedPopulationGcp: selectedPopulationGCP, // Replace with actual value
            filename: "FieldDesign.csv", // Replace with actual filename or logic to determine it
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
            <Importer
                dataHandler={async (rows, { startIndex }) => {
                    // Accumulate rows of data
                    setImportedData((currentData) => [...currentData, ...rows]);
                }}
                defaultNoHeader={false}
                restartable={false}
                onComplete={() => {
                    // Send accumulated data to the server
                    sendDataToServer(importedData);
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
