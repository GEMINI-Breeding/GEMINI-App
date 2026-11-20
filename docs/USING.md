# Using GEMI

[← README](../README.md)

Step-by-step guides with screenshots: [App Guide](https://gemini-breeding.github.io/app_guide/).

| Page | What it is for |
|---|---|
| **Home** | Two tabs. **Dashboard**: an overview built from your trait data (traits over the season, which traits move together, heritability, the latest field map, where processing stands), plus tabs of your own; pin any view to keep it. **Agent**: ask for work in plain words. Either tab can be turned off (Settings → Home). |
| **Files** | Upload rover logs (`.bin`), drone images, handheld photos, GPS logs, orthomosaics, field designs and trait tables. Optional: a treatment, and a run number for fields covered more than once a day; when uploading many folders, say which folder is which run or treatment. |
| **Process** | Every run by experiment and date, with where it stands (running, waiting for its next step, failed, complete). Rovers and handheld cameras go through the **ground** pipeline (data sync, plot marking, stitching, plot boundaries, plot images, inference); drones through the **aerial** pipeline (orthomosaic, plot boundaries, plot images, trait extraction, inference). Runs the agent started carry a small agent mark. |
| **Analyze** | Tables, maps and charts of traits; correlation, ANOVA, heritability, PCA, GGE biplots, field maps. |
| **Genotyping** | Marker data (HapMap, VCF, CSV) per experiment, genome-wide association of measured traits, and TASSEL results. |
| **Settings** | Home, data and services, Compute (what runs on the cluster, start and stop), sign-in. |

## Ground images: rover or handheld

Handheld photos with GPS (a phone with location on, or a GPS log carried on the walk) go through the same steps as a rover's pass. Without GPS, the Plot Images step pairs the photos with the field design: one photo per plot, or a marked walk. Every ground run can use either the stitched plots or each plot's own raw frames; counts on raw frames are summed over frames that don't overlap, so a plant is counted once. Details: [Ground pipeline guide](https://gemini-breeding.github.io/app_guide/ground_pipeline/).

## Models

Inference models can come from Roboflow, Hugging Face, or your own YOLO weights (`.pt` / `.onnx`). Each pipeline keeps a list of models, and the Inference step shows the results of every model run on a run. Detections can be corrected and used to train a model of your own (Label & train).
