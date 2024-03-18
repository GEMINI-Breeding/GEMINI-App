# GEMINI-App
GEMINI web browser based application using React JS as front-end.

### To-Do
- Migrate data to `GEMINI-Data`
- Link geojson to population identifiers



### Setup
```bash
# Download git submodules
git submodule update --init --recursive

# Install conda virtual environment
cd GEMINI-Flask-Server
./install_flask_server.sh
cd ../

# Install Node Version Manager
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
source ~/.bashrc

# Install Node 18
nvm install 18
nvm use 18

# Install dependencies
cd gemini-app
npm install

# Run development server
npm run gemini # It wil run front and server concurrently. It will mix the logs

# If you want to run front only 
npm run front

# If you want to run flask server only
npm run server
```

### Change the port for debugging
You can change the port inside the [package.json](gemini-app/package.json) file
The default port for react is 3000 and for flask is 5000
```json
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test",
    "eject": "react-scripts eject",
    "front": "PORT=3002 react-scripts start",
    "server": "../GEMINI-Flask-Server/run_flask_server.sh /home/GEMINI/GEMINI-Data 5002",
    "gemini": "concurrently \"npm run front\"  \"npm run server\""
  },
```