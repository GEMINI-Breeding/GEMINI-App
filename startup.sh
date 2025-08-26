#!/bin/bash
clear

# Print the startup message
echo "Please wait while the app starts up..."
echo "To close the app, close this terminal window and the chrome tab!"

# Load the user's environment to ensure npm is available
source ~/.bashrc  # or source ~/.profile if npm is set up there

# Pull updates if necessary
git stash
git checkout main
git fetch
git pull
git stash pop

# Update submodules
cd GEMINI-Flask-Server
git stash
cd ../
git submodule update --init --recursive
cd GEMINI-Flask-Server
git stash pop

cd ../gemini-app

# Run the app
npm run gemini