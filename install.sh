# Init script for the project
# This script will install all the dependencies for the project

# 1. Checkout submodules
git submodule update --init --recursive
cd GEMINI-Flask-Server
./install_flask_server.sh

# 2. Install npm packages
cd ../gemini-app
npm install --legacy-peer-deps

# 3. Test run
npm run gemini