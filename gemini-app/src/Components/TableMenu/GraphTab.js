import React, { useState, useEffect, useRef } from "react";

import useTrackComponent from "../../useTrackComponent";

const GraphTab = () => {
    useTrackComponent("GraphTab");
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
            <img src="/graph_sample.jpg" alt="Place holder for Graph Tab" style={{ maxWidth: "100%" }}/>
        </div>
    );
}

export default GraphTab;