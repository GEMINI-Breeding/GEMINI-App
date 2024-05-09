import React, { useState, useEffect, useRef } from "react";

import useTrackComponent from "../../useTrackComponent";

const TableTab = () => {
    useTrackComponent("TableView");
    return (
        <div
            style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                color: "black",
                backgroundColor: "white",
                padding: "20px",
                zIndex: "1000",
                fontSize: "24px",
            }}
        >
            {/* Placeholder for Table Tab */}
            <img src="/table_sample.jpg" alt="Place holder for Table Tab" style={{ maxWidth: "100%" }}/>
            


        </div>
    );
}

export default TableTab;