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
};

export default HelpPane;
