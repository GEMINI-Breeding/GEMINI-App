import { useContext, useEffect } from "react";
import { ActiveComponentsContext } from "./ActiveComponentsContext"; // Adjust the path as needed

const useTrackComponent = (componentName) => {
    const { registerComponent, unregisterComponent } = useContext(ActiveComponentsContext);

    useEffect(() => {
        registerComponent(componentName);

        return () => {
            unregisterComponent(componentName);
        };
    }, []);
};

export default useTrackComponent;
