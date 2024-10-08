import React, { useState, useEffect, useRef } from "react";

import useTrackComponent from "../../useTrackComponent";

const DownloadsTab = () => {
    useTrackComponent("DownloadsTab");
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
            Placeholder for Downloads Tab
        </div>
    );
}

export default DownloadsTab;