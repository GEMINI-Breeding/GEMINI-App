import React from "react";
import {
    Dialog,
    DialogTitle,
    Button,
    Box,
    Typography,
} from "@mui/material";

function LocateMenu({ open, onClose, title, content }) {
    return (
        <Dialog open={open} onClose={onClose}>
            <DialogTitle>{title || "Temporary Dialog"}</DialogTitle>
            <Box p={2}>
                <Typography variant="body1">
                    {content || "This is a temporary dialog box."}
                </Typography>
                <Box mt={2} display="flex" justifyContent="center">
                    <Button
                        onClick={onClose}
                        style={{
                            backgroundColor: "#1976d2",
                            color: "white",
                            borderRadius: "4px",
                        }}
                    >
                        Close
                    </Button>
                </Box>
            </Box>
        </Dialog>
    );
}

export default LocateMenu;
