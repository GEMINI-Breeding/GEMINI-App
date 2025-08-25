import { createTheme } from '@mui/material/styles';

export const globalTheme = createTheme({
    palette: {
        mode: "light",
        primary: {
            main: "#546d78", 
            light: "#648390ff",
            dark: "#455a63ff",
            contrastText: "#fff",
        },
        secondary: {
            main: "#9165a8ff", 
            light: "#b784d2ff",
            dark: "#7e5892ff",
            contrastText: "#fff",
        },
        success: {
            main: "#b3d99a",
            light: "#bee6a4ff",
            dark: "#a0c289ff",
        },
        error: {
            main: "#f44336",
            light: "#ef5350",
            dark: "#d32f2f",
        },
        warning: {
            main: "#ff9800",
            light: "#ffb74d",
            dark: "#f57c00",
        },
        info: {
            main: "#2196f3",
            light: "#64b5f6",
            dark: "#1976d2",
        },
        background: {
            default: "#ffffff",
            paper: "#fefefe",
        },
        text: {
            primary: "#000000",
            secondary: "rgba(0, 0, 0, 0.7)",
        },
    },
    typography: {
        fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    },
    components: {
        MuiIconButton: {
            styleOverrides: {
                root: {
                    '&:hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    },
                },
            },
        },
        MuiDrawer: {
            styleOverrides: {
                paper: {
                    backgroundColor: "#ffffff",
                },
            },
        },
    },
});