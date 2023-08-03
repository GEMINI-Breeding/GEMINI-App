import React, { useState } from 'react';
import { IconButton, Drawer, Box, Divider, List, ListItem, ListItemIcon, ListItemText } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import DataSelectionMenu from './DataSelectionMenu';
import PhotoSizeSelectLargeIcon from '@mui/icons-material/PhotoSizeSelectLarge';
import FilterAltIcon from '@mui/icons-material/FilterAlt';

export default function CollapsibleSidebar({ onTilePathChange, onGeoJsonPathChange, selectedMetric, setSelectedMetric }) {
  const [currentView, setCurrentView] = useState(-1);
  const drawerWidth = 350;
  const smallDrawerWidth = 50;

  return {
    jsx: (
      <Box sx={{ display: 'flex' }}>
      <Drawer
        variant="permanent"
        sx={{
          width: smallDrawerWidth,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: smallDrawerWidth,
          },
        }}
      >
        <List>
          <ListItem button onClick={() => setCurrentView(0)}>
            <ListItemIcon>
              <FilterAltIcon />
            </ListItemIcon>
          </ListItem>
          <ListItem button onClick={() => setCurrentView(1)}>
            <ListItemIcon>
              <PhotoSizeSelectLargeIcon />
            </ListItemIcon>
          </ListItem>
        </List>
      </Drawer>
      
      <Drawer 
        variant="persistent" 
        anchor="left" 
        open={currentView !== -1}
        sx={{ 
          width: currentView !== -1 ? drawerWidth : 0, 
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: currentView !== -1 ? drawerWidth : 0,  
            transition: (theme) => theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
          }
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
          <IconButton
            color="inherit"
            aria-label="close drawer"
            onClick={() => setCurrentView(-1)}
          >
            <MenuIcon fontSize='medium'/>
          </IconButton>
        </Box>
        <Divider />
        <List>
          <ListItem>
            <ListItemText sx={{ px: 2, py: 1 }}>
              {currentView === 0 && (
                <DataSelectionMenu 
                  onTilePathChange={onTilePathChange} 
                  onGeoJsonPathChange={onGeoJsonPathChange}
                  selectedMetric={selectedMetric}
                  setSelectedMetric={setSelectedMetric}
                />
              )}
              {currentView === 1 && (
                <div>Second View Placeholder</div>
              )}
            </ListItemText>
          </ListItem>
        </List>
      </Drawer>
    </Box>
    ),
    currentView,
  };
}
