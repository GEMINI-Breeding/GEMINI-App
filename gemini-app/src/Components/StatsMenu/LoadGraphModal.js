import React, { useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Grid from "@mui/material/Grid";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { geojsonToCSV } from "./GeojsonUtils.js";

import { fetchData, useDataSetters, useDataState } from "../../DataContext.js";
import GraphTab from "./GraphTab.js";

const LoadGraphModal = ({ open, onClose, item }) => {

    const {
        selectedLocationGCP,
        selectedPopulationGCP,
        selectedYearGCP,
        selectedExperimentGCP,
    } = useDataState();

    const { setNowDroneProcessing 

    } = useDataSetters();

    const [geojsonData, setGeojsonData] = useState(null);
    const [csvString, setCsvString] = useState("");
    const [csvData, setCsvData] = useState([]);

    useEffect(() => {
        if(open){
            //console.log("LoadTableModal useEffect",open);
            //console.log("item", item);
            // Load Geojson Data
            if (item.geoJsonFile) {
                fetch(item.geoJsonFile)
                    .then((response) => response.json())
                    .then((data) => setGeojsonData(data))
                    .catch((error) => console.error("Error fetching geojson:", error));
            } else{
                console.log("No Geojson File");
            }
        }
    }, [open]);    

    useEffect(() => {
        //console.log("geojsonData", geojsonData);
        const csv = geojsonToCSV(geojsonData);
        //console.log("csv", csv);
        setCsvString(csv);
    }, [geojsonData]);
    
    const parseCSV = (csvText) => {
        console.log("parseCSV", csvText);
        const lines = csvText.split("\n");
        const headers = lines[0].split(",");
        const parsedData = [];
      
        for (let i = 1; i < lines.length; i++) {
          const currentLine = lines[i].split(",");
      
          if (currentLine.length === headers.length) {
            const row = {};
            for (let j = 0; j < headers.length; j++) {
              row[headers[j].trim()] = currentLine[j].trim();
            }
            parsedData.push(row);
          }
        }
      
        setCsvData(parsedData);
      };

    useEffect(() => {
        parseCSV(csvString)
    }, [csvString]);


    // console.log('helllllo');
    // console.log(csvData)

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth={false}>
            <DialogTitle style={{ textAlign: "center", fontWeight: "bold", fontSize: "x-large", position: 'relative', paddingBottom: '0px'}}>
                {item && ("Graph for " + item.date + " Data") || "Graph Tab"}
                <Button variant="contained" color="primary" onClick={onClose} style={{ position: 'absolute', right: 16, top: 16 }}>
                    Close
                </Button>
            </DialogTitle>
            <DialogContent style={{ padding: 0, height: '65vh' }}>
                <GraphTab data={csvData} />
            </DialogContent>
        </Dialog>
    );
};

export default LoadGraphModal;

