import React, { useState, useEffect, useRef } from "react";
import { Bar } from 'react-chartjs-2';
import { Chart as ChartJS, Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale } from 'chart.js';
import { Box, Tabs, Tab, FormControl, InputLabel, Select, MenuItem, Typography, Button } from '@mui/material';
import useTrackComponent from "../../useTrackComponent";
import html2canvas from 'html2canvas';

ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale);

const GraphTab = ({ data, item }) => {
        useTrackComponent("GraphTab");

    const [selectedAccession, setSelectedAccession] = useState('');
    const [chartType, setChartType] = useState('heightHistogram');
    const [chartData, setChartData] = useState({
        heightHistogramData: {},
        vegetationHistogramData: {},
    });
    const [accessionOptions, setAccessionOptions] = useState([]);
    const [error, setError] = useState(null);
    const chartRef = useRef(null);

    useEffect(() => {
        if (data && data.length > 0) {
            const uniqueAccessions = [...new Set(data.map(item => item.accession))];
            setAccessionOptions(uniqueAccessions);
            if (uniqueAccessions.length > 0) {
                setSelectedAccession(uniqueAccessions[0]);
            }
        } else {
            setError("No data available to display.");
        }
    }, [data]);

    useEffect(() => {
        if (data) {
            try {
                const filteredData = data.filter(row => row.accession === selectedAccession);

                const heightValues = filteredData.map(row => parseFloat(row.Height_95p_meters) || 0);
                const vegetationValues = filteredData.map(row => parseFloat(row.Vegetation_Fraction) || 0);

                const heightHistogram = getHistogram(heightValues, 10);
                const vegetationHistogram = getHistogram(vegetationValues, 10);

                setChartData({
                    heightHistogramData: {
                        labels: heightHistogram.bins.map(bin => `${bin.min.toFixed(2)} - ${bin.max.toFixed(2)}`),
                        datasets: [{
                            label: 'Height Distribution',
                            data: heightHistogram.counts,
                            backgroundColor: 'rgba(75, 192, 192, 0.2)',
                            borderColor: 'rgba(75, 192, 192, 1)',
                            borderWidth: 1
                        }]
                    },
                    vegetationHistogramData: {
                        labels: vegetationHistogram.bins.map(bin => `${bin.min.toFixed(2)} - ${bin.max.toFixed(2)}`),
                        datasets: [{
                            label: 'Vegetation Fraction Distribution',
                            data: vegetationHistogram.counts,
                            backgroundColor: 'rgba(153, 102, 255, 0.2)',
                            borderColor: 'rgba(153, 102, 255, 1)',
                            borderWidth: 1
                        }]
                    }
                });
                setError(null);
            } catch (e) {
                setError("Error processing data.");
            }
        }
    }, [selectedAccession, data]);

    const getHistogram = (data, numBins) => {
        if (data.length === 0) return { bins: [], counts: [] };

        const min = Math.min(...data);
        const max = Math.max(...data);
        const binSize = (max - min) / numBins;

        const bins = Array.from({ length: numBins }, (_, i) => ({
            min: min + i * binSize,
            max: min + (i + 1) * binSize,
            count: 0
        }));

        data.forEach(value => {
            const index = Math.floor((value - min) / binSize);
            if (index >= 0 && index < numBins) {
                bins[index].count += 1;
            }
        });

        return {
            bins,
            counts: bins.map(bin => bin.count)
        };
    };

    // Improved saveChartAsImage function with proper error handling and null checks
    const saveChartAsImage = () => {
        if (!chartRef.current) {
            console.error("Chart reference is not available");
            return;
        }
        
        try {
            html2canvas(chartRef.current).then(canvas => {
                try {
                    const imgData = canvas.toDataURL('image/png');
                    const link = document.createElement('a');
                    link.href = imgData;
                    // Added null check with optional chaining for item.date
                    link.download = `${item?.date || 'chart'}_${chartType === 'heightHistogram' ? 'height_95_p' : 'veg_frac'}_chart.png`;
                    link.click();
                } catch (err) {
                    console.error("Error creating download link:", err);
                }
            }).catch(err => {
                console.error("Failed to create canvas:", err);
            });
        } catch (err) {
            console.error("Error in saveChartAsImage:", err);
        }
    };

    return (
        <Box sx={{ padding: 2, width: '50vw'}}>
            {error ? (
                <Typography color="error">{error}</Typography>
            ) : (
                <>
                    <FormControl fullWidth sx={{ marginBottom: 2 }}>
                        <InputLabel id="accession-lab">Select Accession</InputLabel>
                        <Select labelId="accession-lab" value={selectedAccession} onChange={(e) => setSelectedAccession(e.target.value)} label="Select Accession">
                            {accessionOptions.map((acc, index) => (
                                <MenuItem key={index} value={acc}>
                                    {acc}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                        <Tabs value={chartType} onChange={(event, newValue) => setChartType(newValue)} aria-label="chart type tabs" sx={{ marginBottom: 2 }}>
                            <Tab value="heightHistogram" label="Height Distribution" />
                            <Tab value="vegetationHistogram" label="Vegetation Fraction Distribution" />
                        </Tabs>
                    <Box sx={{ height: 'calc(100% - 60px)', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {/* Added wrapper Box with null checks for chart data */}
                        <Box ref={chartRef} sx={{ width: '100%' }}>
                            {chartType === 'heightHistogram' && (
                                chartData?.heightHistogramData?.labels?.length > 0 ? 
                                <Bar data={chartData.heightHistogramData} options={{
                                    scales: {
                                        x: {
                                            title: {
                                                display: true,
                                                text: 'Height (meters)'
                                            }
                                        },
                                        y: {
                                            title: {
                                                display: true,
                                                text: 'Frequency'
                                            }
                                        }
                                    }
                                }} /> : 
                                <Typography>No height data available.</Typography>
                            )}
                            {chartType === 'vegetationHistogram' && (
                                chartData?.vegetationHistogramData?.labels?.length > 0 ? 
                                <Bar data={chartData.vegetationHistogramData} options={{
                                    scales: {
                                        x: {
                                            title: {
                                                display: true,
                                                text: 'Vegetation Fraction'
                                            }
                                        },
                                        y: {
                                            title: {
                                                display: true,
                                                text: 'Frequency'
                                            }
                                        }
                                    }
                                }} /> : 
                                <Typography>No vegetation data available.</Typography>
                            )}
                        </Box>
                    </Box>
                    <Button variant="contained" color="primary" onClick={saveChartAsImage}>
                            Save as Image
                    </Button>
                </>
            )} 
        </Box>
    );
};

export default GraphTab;