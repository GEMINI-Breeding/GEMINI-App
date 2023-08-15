import React from 'react';
import { AppBar, IconButton, Drawer, Box, Divider, List, ListItem, ListItemIcon, ListItemText, Toolbar, useTheme, ThemeProvider, createTheme } from '@mui/material';
import DataSelectionMenu from './DataSelectionMenu';
import GCPPickerSelectionMenu from './GCPPickerSelectionMenu';
import PictureInPictureIcon from '@mui/icons-material/PictureInPicture';
import MapIcon from '@mui/icons-material/Map';

export default function CollapsibleSidebar({ onTilePathChange, onGeoJsonPathChange, selectedMetric, setSelectedMetric, currentView, setCurrentView, onCsvChange, onImageFolderChange, onRadiusChange }) {
  const drawerWidth = 350;
  const smallDrawerWidth = 50;

  const darkTheme = createTheme({
    palette: {
      mode: 'dark',
      primary: {
        main: '#282c34',
      }
    },
  });

  const handleDrawerToggle = (index) => {
    if (currentView === index) {
      setCurrentView(null);
    } else {
      setCurrentView(index);
    }
  };

  console.log("Rendering sidebar with currentView =", currentView);

  return (
    <ThemeProvider theme={darkTheme}>
      <Box sx={{ display: 'flex', flexDirection: 'row' }}>

      <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            position: 'fixed',
            height: '100vh',
            backgroundColor: '#272726',
            width: `${smallDrawerWidth}px`,
            zIndex: (theme) => theme.zIndex.drawer + 1,
          }}>
          <IconButton edge="start" color="white" aria-label="Map" onClick={() => handleDrawerToggle(0)}>
              <MapIcon color="white"/>
          </IconButton>
          <IconButton edge="start" color="white" aria-label="photo" onClick={() => handleDrawerToggle(1)}>
              <PictureInPictureIcon color="white"/>
          </IconButton>

      </Box>

      <Drawer 
        variant="persistent" 
        anchor="left" 
        open={currentView !== null}
        sx={{ 
          width: currentView !== null ? `${drawerWidth}px` : 0,
          flexShrink: 0,
          marginLeft: `${smallDrawerWidth}px`,
          "& .MuiDrawer-paper": {
            marginLeft: `${smallDrawerWidth}px`,
            width: currentView !== null ? `${drawerWidth}px` : 0,  
            transition: (theme) => theme.transitions.create('width', {
                easing: theme.transitions.easing.sharp,
                duration: currentView !== null ? theme.transitions.duration.enteringScreen : theme.transitions.duration.leavingScreen,
              }),
            boxSizing: 'border-box',
            backgroundColor: '#4a4848'
          }
        }}
      >
        <Divider />
        <List>
          <ListItem>
            <ListItemText sx={{ px: 2, py: 1 }}>
              {currentView === 0 ? (
                <DataSelectionMenu 
                  onTilePathChange={onTilePathChange} 
                  onGeoJsonPathChange={onGeoJsonPathChange}
                  selectedMetric={selectedMetric}
                  setSelectedMetric={setSelectedMetric}
                />
              ) : (
                <GCPPickerSelectionMenu 
                  onCsvChange={onCsvChange} 
                  onImageFolderChange={onImageFolderChange}
                  onRadiusChange={onRadiusChange}
                />
              )}
            </ListItemText>
          </ListItem>
        </List>
      </Drawer>

      </Box>
    </ThemeProvider>
  );
}
