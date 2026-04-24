# 🌱 GxExMINI Phenotyping App

![GEMINI Logo](assets/gemini_logo.png)

---

## 🔗 Overview

**GxExMINI** (GEMI for short) is a high-throughput phenotyping platform designed to accelerate the development of nutritious, stress-resistant staple crops. The platform includes:

- **Desktop Application:** Built with [Tauri v2](https://tauri.app) (Rust), React, and the [GEMINIbase](https://github.com/GEMINI-Breeding/GEMINIbase) (Litestar + Postgres + MinIO) backend.
- **Automated Processing Pipelines:** Support for both aerial and ground-based data.
- **Advanced Analytics:** Feature-rich interface for mapping, trait extraction, and data querying.

For more information about the project and our research, visit: [https://projectgemini.ucdavis.edu/](https://projectgemini.ucdavis.edu/)

---

## 📚 Resources

- 📝 [**Full Documentation & User Guides**](https://gemini-breeding.github.io/)  
- 📂 [**Example Data**](https://ucdavis.box.com/s/ts802xlcddyufixfjmeayxwiiz2mxrb9)

---

## ⚙️ Installation & Setup

### Development Environment
For active development on the Tauri/React/GEMINIbase stack, please refer to the **[Developer Guide](https://gemini-breeding.github.io/start_guide/developer_guide/)** in our official documentation.

**Quick start:**
```
# 1. Clone with submodules
git clone --recurse-submodules https://github.com/GEMINI-Breeding/GEMINI-App.git
cd GEMINI-App

# 2. Start the backend stack (GEMINIbase in backend/ submodule)
./scripts/setup-backend.sh     # one-time: init submodule, seed .env
docker compose up -d           # bring up Postgres/MinIO/Redis/REST API/workers

# 3. Setup Frontend
cd frontend
npm install
npm run dev
```

#### Backend (GEMINIbase)

The backend is the [GEMINIbase](https://github.com/GEMINI-Breeding/GEMINIbase) framework, pulled in as a git submodule at `backend/`. It runs as a Docker Compose stack: Postgres, MinIO, Redis, a Litestar REST API, TiTiler, NodeODM, and background workers.

```
./scripts/setup-backend.sh     # one-time: init submodule, seed .env files
docker compose up -d           # start the full stack
```

The REST API lands on port 7777, TiTiler on 8091, NodeODM on 13000. The `geminibase-ui` container exposes GEMINIbase's reference UI on 3000 — if you are also running the GEMINI-App frontend dev server, stop one or remap the port.

### Building for Production
See [`docs/BUILDING.md`](./docs/BUILDING.md) for platform-specific build instructions (Linux, macOS, Windows).

> **Note on Windows:** **Docker Desktop** is required for certain data processing features in the application. Ensure it is running when performing these tasks.

---

## 📦 Key Dependencies

GEMI integrates several open-source tools and packages as core components of its processing pipelines:

### [OpenDroneMap (ODM)](https://opendronemap.org/)
Used in the **aerial pipeline** for photogrammetric reconstruction — processing drone imagery into georeferenced orthomosaics and digital elevation models (DEMs). GEMI orchestrates ODM as a sidecar process and consumes its outputs for downstream trait extraction.

### [AgRowStitch](https://github.com/GEMINI-Breeding/AgRowStitch)
Used in the **ground pipeline** for stitching rover-captured (Amiga) row images into plot-level mosaics. AgRowStitch runs inside the GEMINIbase stitch worker when a `RUN_STITCH` job is submitted.

> Uyehara, I. K. et al. *AgRowStitch: A High-fidelity Image Stitching Pipeline for Ground-based Agricultural Images* arXiv, 2025. [arxiv.org/pdf/2503.21990](https://arxiv.org/pdf/2503.21990)

### [farm-ng Amiga SDK](https://github.com/farm-ng/farm-ng-amiga)
Used for decoding and extracting data from **farm-ng Amiga** ground rover logs (`.bin` files). The SDK provides the tools needed to parse platform telemetry and camera data recorded during field operations.

---

## 🔍 Pipeline Overview

![Sensing Pipeline](assets/sensing_pipeline.png)

- **File Management System** – Effortlessly organize, verify, and sync metadata for raw and processed data.
- **Aerial Pipeline** – Full workflow for drone imagery, from GPS sync and GCP alignment to orthomosaic generation and trait extraction.
- **Ground Pipeline** – Purpose-built pipeline for rover-based (Amiga) data, featuring custom plot marking, image stitching, and inference model execution.
- **Linked Data Visualization** – Visualize data with direct links to field design layouts via the **Analyze** tab.
- **AI-Enabled Analysis** – Integration with RoboFlow for computer vision tasks (object detection and segmentation).
- **Trait Extraction & Export** – Compute and export key plant traits (e.g., height, vegetation fraction) for downstream research.
