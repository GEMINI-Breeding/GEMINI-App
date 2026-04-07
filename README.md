# GxExMINI Phenotyping App

![GEMINI Logo](assets/gemini_logo.png)

---

## Overview

**GxExMINI** is a web-based phenotyping platform designed to accelerate the development of nutritious, stress-resistant staple crops in low- and middle-income countries. The application features a *React.js frontend* and a *gemini-framework backend* (Litestar/FastAPI + PostgreSQL + MinIO), offering a seamless interface for breeders, researchers, and data scientists.

We aim to improve the speed and quality of crop breeding by using affordable, multi-modal sensors and machine learning to rapidly collect high-resolution phenotypic data.

For more information about the project and our partners: https://projectgemini.ucdavis.edu/

---

## Resources

- [**Full Documentation**](https://gemini-breeding.github.io/)
- [**Example Data**](https://ucdavis.box.com/s/ts802xlcddyufixfjmeayxwiiz2mxrb9)

---

## Installation

### Docker install (recommended)

```bash
git clone git@github.com:GEMINI-Breeding/GEMINI-App.git
cd GEMINI-App
git submodule update --init --recursive

# Start the backend pipeline (PostgreSQL, MinIO, Redis, REST API, workers, tile server)
cd gemini-framework
cp gemini/pipeline/.env.example gemini/pipeline/.env
docker compose -f gemini/pipeline/docker-compose.yaml up -d --build
# Wait for REST API to be ready
docker logs gemini-rest-api -f  # Look for "Uvicorn running on http://0.0.0.0:7777"

# Start the frontend
cd ../gemini-app
npm install --legacy-peer-deps
npm start
```

### Native install for development

```bash
# Step 1: Initialize submodules
git submodule update --init --recursive

# Step 2: Start the backend pipeline
cd gemini-framework
cp gemini/pipeline/.env.example gemini/pipeline/.env
docker compose -f gemini/pipeline/docker-compose.yaml up -d --build
cd ..

# Step 3: Install frontend dependencies
cd gemini-app
npm install --legacy-peer-deps
```

---

## Running for Development

After completing the install steps above:

```bash
cd gemini-app
npm start
```

- Frontend: http://localhost:3000
- Backend REST API: http://localhost:7777
- MinIO Console: http://localhost:9001
- Tile Server: http://localhost:8091

Ports and the data directory are configured in `gemini-app/.env` (see `.env.example`).

---

## Testing

### Unit tests
Unit tests cover pure utility functions (CSV parsing, geospatial calculations, unit conversion) using Jest. No mocking — these test real logic only.

```bash
cd gemini-app
npm run test:unit          # Single run
npm run test:unit:watch    # Watch mode
```

### E2E tests
End-to-end tests use Playwright against the real gemini-framework backend (no mocking). They cover the full stack: sidebar navigation, data upload, orthomosaic generation, plot association, and user workflows.

```bash
# 1. Ensure the backend pipeline is running (see Installation above)

# 2. Run E2E tests
cd gemini-app
npm run test:e2e           # Headless
npm run test:e2e:headed    # With visible browser

# 3. Stop backend when done
cd gemini-framework
docker compose -f gemini/pipeline/docker-compose.yaml down
```

### CI
Both test suites run automatically on push/PR via GitHub Actions (`.github/workflows/test.yml`).

---

## Architecture

- **`gemini-app/`** — React 18 frontend (MUI v5, deck.gl, Mapbox GL)
- **`gemini-framework/`** — Git submodule; Litestar REST API, PostgreSQL, MinIO storage, Redis, processing workers (ODM, geo, FLIR)

### Pipeline Overview

![Sensing Pipeline](assets/sensing_pipeline.png)

- **File Management System** — Organize and access raw and processed data
- **Codeless Image Orthomosaic Process** — Generate field-scale mosaics via OpenDroneMap
- **Plot Association** — Import field designs, define plot boundaries, extract plot images
- **Linked Data Visualization** — Visualize data with direct links to field design layouts
- **AI-Enabled Model Creation** — Train and deploy machine learning models for trait analysis
- **Trait Extraction & Export** — Extract key traits and export results for downstream use
