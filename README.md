# 🌱 GxExMINI Phenotyping App

![GEMINI Logo](assets/gemini_logo.png)

---

## 🔗 Overview

**GxExMINI** is a web-based phenotyping platform designed to accelerate the development of nutritious, stress-resistant staple crops in low- and middle-income countries. The application features a *React.js frontend* and a *Flask backend*, offering a seamless interface for breeders, researchers, and data scientists.

We aim to improve the speed and quality of crop breeding by using affordable, multi-modal sensors and machine learning to rapidly collect high-resolution phenotypic data.

For more information about the project and our partners: https://projectgemini.ucdavis.edu/

---

## 📚 Resources

- 📝 [**Full Documentation**](https://gemini-breeding.github.io/)  
- 📂 [**Example Data**](https://ucdavis.box.com/s/ts802xlcddyufixfjmeayxwiiz2mxrb9)

---

## ⚙️ Installation
### Docker install (recommended)
```bash
git clone git@github.com:GEMINI-Breeding/GEMINI-App.git
cd GEMINI-App

# CPU version
docker compose up
# GPU version (if nvidia-smi works on host)
docker compose -f docker-compose-gpu.yml up
```

If you want to rebuild the image
```bash
# Run docker-compose up
docker-compose up --build
```

Build docker image
```
docker build -t gemini-breeding:latest .
```

### Docker Configuration
The `docker-compose.yml` file contains important configuration parameters that you can customize:

```yaml
ports:
    - "3000:3000"  # React frontend (external:internal)
    - "5000:5000"  # Flask backend (external:internal)
    - "8091:8091"  # Tile server (external:internal)
volumes:
    - /var/run/docker.sock:/var/run/docker.sock  # Allow Docker-in-Docker
    - /mnt/d/GEMINI-App-Data:/root/GEMINI-App-Data  # Mount host data to container data directory
```
For more detailed configuration options, see the [docker-compose.yml](docker-compose.yml) file.

### Native install for development
```bash
# Step 1: Initialize submodules
git submodule update --init --recursive

# Step 2: Set up Flask backend
cd GEMINI-Flask-Server
./install_flask_server.sh
cd ../

# Step 3: Install Node Version Manager (NVM)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
source ~/.bashrc

# Step 4: Install Node 18 and switch to it
nvm install 18
nvm use 18

# Step 5: Install frontend dependencies
cd gemini-app
npm install --legacy-peer-deps  # Fixes upstream dependency conflict

```

---

## 🚀 Running for Development

After completing the native install steps above:

```bash
cd gemini-app
npm run gemini
```

This starts both the React frontend and Flask backend concurrently. By default:
- Frontend: http://localhost:3000
- Backend: http://localhost:5000

Ports and the data directory are configured in `gemini-app/.env` (see `.env.example`).

---

## 🔍 Pipeline Overview

![Sensing Pipeline](assets/sensing_pipeline.png)

- **File Management System** – Easily organize and access raw and processed data.
- **Codeless Image Orthomosaic Process** – Generate field-scale mosaics without writing code.
- **Linked Data Visualization** – Visualize data with direct links to field design layouts.
- **AI-Enabled Model Creation** – Train and deploy machine learning models for trait analysis.
- **Trait Extraction & Export** – Extract key traits and export results for downstream use.


