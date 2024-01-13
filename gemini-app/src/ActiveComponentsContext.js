import React, { createContext, useState } from "react";

export const ActiveComponentsContext = createContext();

export const ActiveComponentsProvider = ({ children }) => {
    const [activeComponents, setActiveComponents] = useState(new Set());

    const registerComponent = (componentName) => {
        setActiveComponents((prevComponents) => new Set(prevComponents).add(componentName));
    };

    const unregisterComponent = (componentName) => {
        setActiveComponents((prevComponents) => {
            const newComponents = new Set(prevComponents);
            newComponents.delete(componentName);
            return newComponents;
        });
    };

    return (
        <ActiveComponentsContext.Provider value={{ activeComponents, registerComponent, unregisterComponent }}>
            {children}
        </ActiveComponentsContext.Provider>
    );
};
