# GEMINI-App
GEMINI web browser based application using React JS as front-end.

Full Documentation found here:
https://gemini-breeding.github.io/

Example Data found here:
https://ucdavis.box.com/s/ts802xlcddyufixfjmeayxwiiz2mxrb9

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
npm install --legacy-peer-deps # Fix the upstream dependency conflict
```
