---
name: inference
description: Run a detection, segmentation or classification model (Roboflow, Hugging Face, or uploaded weights) over an image or a folder of plot images, and read the predictions. Use for "count plants", "run the model", "detect", "classify plots".
---

# Model inference

## Quick path

1. Images: a `…/PlotImages/` folder (check it with `browse`).
2. Model: ask which. It goes in `model` as an object with `source` (`roboflow`, `huggingface` or `local_weights`) and that source's keys (table below).
3. `run_inference` with `images_prefix`, `output_predictions_path` (`…/predictions/<name>-v1.json`), `model`, `per_plot` true, `count_label`.
4. `wait_jobs`, then `inference_stats` with the predictions path. Report images, detections, and how many images had none.
Few or no detections is a result: say so; do not lower the threshold until something appears.

`run_inference` submits a LOCATE_PLANTS job to the ml worker. It runs one
model over one image or every image under a folder and writes a predictions
JSON file.

## What to collect first

1. **Images**: exactly one of
   - `image_path` — a single object, or
   - `images_prefix` — a folder, e.g. the stitched plots
     `Processed/…/AgRowStitch_v3/` or `Processed/…/PlotImages/`.
   Check it with `browse`.
2. **Model** — one of three sources (ask which, and for the details):

   | `model_source` | Other keys | Notes |
   |---|---|---|
   | `roboflow` | `api_key`, `model_id` (e.g. `plants-x1y2/3`), optional `api_url` | hosted or self-hosted Roboflow |
   | `huggingface` | `hf_model_id` (e.g. `facebook/detr-resnet-50`), `task_type`, optional `hf_token`, `hf_mode` (`local` or `cloud`) | `local` downloads and runs in the worker |
   | `huggingface`, open vocabulary | as above plus `"hf_zero_shot": true, "hf_prompt": "sorghum panicle, grain head"` | detects whatever the prompt names: `google/owlvit-base-patch32`, `google/owlvit-base-patch16`. Classification the same way with CLIP (`openai/clip-vit-base-patch32`), labels as the prompt |
   | `local_weights` | `weights_path` (object under `Models/weights/…`), `task_type` | Ultralytics `.pt` / `.onnx` uploaded beforehand |

   `task_type`: `detection`, `segmentation` or `classification`. The key for
   the source in the model object is `source`.
3. **Output path** for the predictions, next to the images, e.g.
   `Processed/…/predictions/<model>-v1.json`.

Never print or repeat an API key or token back to the person.

## Run

```json
{"tool": "run_inference", "args": {
 "images_prefix": "Processed/2026/GEMINI/Coachella/Lima/2026-09-17/Amiga/RGB/AgRowStitch_v3/",
 "output_predictions_path": "Processed/2026/GEMINI/Coachella/Lima/2026-09-17/Amiga/RGB/predictions/yolo-v1.json",
 "model": {"source": "local_weights", "weights_path": "Models/weights/cowpea-yolo.pt", "task_type": "detection"},
 "confidence_threshold": 0.25, "per_plot": true, "count_label": "cowpea-yolo"}}
```

- `per_plot: true` (on a `…/PlotImages/` folder): each plot's count (or class
  scores) is stored as a trait named after `count_label`, so it appears in
  Analyze and on the map. Needs active plot boundaries.
- To run a subset, narrow the prefix: `…/PlotImages/plot_5` matches plots
  5, 50–59, 500–599.
- `count_label` names the result (use a different one per model);
  `iou_threshold` merges overlapping boxes.

## Look at the numbers

`inference_stats` with the predictions path returns per-image statistics,
counts by class and a chart. Always run it and say what it shows: how many
images had no detection, the spread, obvious outliers.

**Comparing two models**: run both on the same images with different
`count_label`s, then `compare_predictions` with the two predictions paths:
correlation, mean difference and a scatter chart. Report which plots
disagree most.

## Open-vocabulary models: what to expect

- The object must be visible at the image's scale: a seedling a few pixels
  wide, or a panicle in a coarse orthomosaic, may give nothing. Zero
  detections everywhere is a finding to report, not a reason to keep
  lowering the threshold.
- Scores are low compared with trained detectors: thresholds of 0.05–0.15
  are normal. Try one image at two thresholds before a folder.
- Prompt with plain nouns for what is seen ("sorghum panicle", "grain
  head", "flower head"); several comma-separated alternatives are fine.
- A model trained for another crop (for example rice panicles) is a
  comparison point, not ground truth. Say that.

Then `wait_jobs`, and `job_detail` for the result summary (images
processed, detections, per-class counts).

## Try small first

For a new model, run one image (`image_path`) before a whole folder. Check
that classes and counts are plausible. A model that returns nothing on an
image that clearly contains the target usually means a wrong `task_type`,
too high a `confidence_threshold`, or the wrong model id.

## Status of this skill

Roboflow works with the published ml worker. Hugging Face and local weights
need the model backends: built into the rebuilt ml image, or on a cluster
installed once with `hpc` `pull_ml_deps`. Without them those sources fail
with an import or unknown-source error — report that rather than retrying.
OWLv2 models also need SciPy, which is not installed.

## A measurement without a model

`canopy_cover` with a `…/PlotImages/` prefix measures green cover (0-1) of
every plot image from colour and stores it as a per-plot trait. It needs no
model and no worker. When a detector finds little (objects only a few pixels
wide), this is the honest fallback: report it as cover, not as a count.
