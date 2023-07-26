import React, { useState } from 'react';
import { IconButton, Drawer, Box, Divider, List, ListItem, ListItemIcon, ListItemText, Button } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import DataSelectionMenu from './DataSelectionMenu';

export default function CollapsibleSidebar({ onTilePathChange }) {
  const [open, setOpen] = useState(false);
  const drawerWidth = 350;

  const handleDrawerToggle = () => {
    setOpen(prevOpen => !prevOpen);
  };

  return (
    <Box sx={{ display: 'flex' }}>
      <Drawer 
        variant="persistent" 
        open={true}
        sx={{
          width: 50,
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: 50,  // This sets the width of the always open Drawer
            transition: (theme) => theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.leavingScreen,
            }),
          },
        }}
      >
        <IconButton
          color="inherit"
          aria-label="open drawer"
          onClick={handleDrawerToggle}
        >
          <MenuIcon fontSize='large'/>
        </IconButton>
      </Drawer>

      <Drawer 
        variant="persistent" 
        anchor="left" 
        open={open}
        sx={{ 
          width: open ? drawerWidth : 0, 
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: open ? drawerWidth : 0,  // This sets the width of the expandable Drawer
            transition: (theme) => theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
          }
        }}
      >
        <div>
          <IconButton 
            onClick={handleDrawerToggle}
          >
            <MenuIcon fontSize='large'/>
          </IconButton>
        </div>
        <Divider />
        <List>
          <ListItem>
            <ListItemText sx={{ px: 2, py: 1 }}>
            <DataSelectionMenu 
              onTilePathChange={onTilePathChange} 
            />
            </ListItemText>
          </ListItem>
        </List>
      </Drawer>
    </Box>
  );
}
