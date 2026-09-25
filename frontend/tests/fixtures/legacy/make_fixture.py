"""Build the fixture "previous GEMI install" (v0.0.5) used by the dev stack
and the legacy-import E2E: app/gemi.db + data/ (the old data folder).

The database uses the exact schema GEMI v0.0.5's own code created
(backend/tests/fixtures/gemi_legacy/schema-v0.0.5.sql). Rows are stored the
old app's way (32-hex UUIDs, ISO-string timestamps, JSON in TEXT, paths
relative to the data folder), and files sit where the old app put them
(its core/paths.py layout: Raw/, Intermediate/{workspace}/, Processed/
{workspace}/, reference_data/{dataset id}/).

    python3 frontend/tests/fixtures/legacy/make_fixture.py

Contents (experiment E2E-legacy-fixture, site Davis, population Cowpea MAGIC):
- uploads: Image Data (2 drone images, 2025-06-10), Field Design, a Farm-ng
  upload already extracted by the old app (4 real frames + metadata, from
  amiga-extract/, cut from the track fixture by the real extractor), and
  an upload the old app had marked missing
- workspace "E2E-legacy-fixture WS" with an aerial and a ground pipeline
- aerial run: orthomosaic v1 (RGB + DEM + pyramid), boundary versions v1
  (plot/row/column/accession) and v2 (the old app's Plot/Tier/Bed/Label
  keys, active), trait record v1 with per-plot traits, cropped plot
  images, a Roboflow predictions CSV, Traits-WGS84.geojson
- ground run: plot marking v1, AgRowStitch_v1, association v1, plot images
- reference datasets: "LAI survey" with its original CSV, and a second,
  unrelated "LAI survey" (old names weren't unique; both must import)
- a plot record whose plot id isn't a whole number ("5A"): its values
  must be kept (unlinked), not dropped
"""
import json
import shutil
import sqlite3
import struct
import uuid
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
SCHEMA = REPO / "backend/tests/fixtures/gemi_legacy/schema-v0.0.5.sql"
FIX = REPO / "frontend/tests/fixtures"

E, L, P = "E2E-legacy-fixture", "Davis", "Cowpea MAGIC"
WS = f"{E} WS"
SCOPE = f"Raw/2025/{E}/{L}/{P}"
IP = f"Intermediate/{WS}/2025/{E}/{L}/{P}"
AERIAL_DATE, GROUND_DATE = "2025-06-10", "2025-07-15"
PR = f"Processed/{WS}/2025/{E}/{L}/{P}/{AERIAL_DATE}/Drone/RGB"
PR_G = f"Processed/{WS}/2025/{E}/{L}/{P}/{GROUND_DATE}/Amiga/RGB"


def uid(n: int) -> uuid.UUID:
    return uuid.UUID(int=n)


OWNER = uid(0xA0)
U_IMG, U_DESIGN, U_MISSING, U_AMIGA = uid(1), uid(2), uid(3), uid(4)
WS_ID, P_AERIAL, P_GROUND = uid(0x10), uid(0x11), uid(0x12)
R_AERIAL, R_GROUND = uid(0x20), uid(0x21)
T_AERIAL = uid(0x30)
REF, REF2 = uid(0x40), uid(0x41)

PLOTS = [  # plot, row, col, accession, Vegetation_Fraction, Height_95p_meters
    (1, 1, 1, "ACC-A", 0.41, 0.52),
    (2, 1, 2, "ACC-B", 0.37, 0.48),
    (3, 2, 1, "ACC-C", 0.55, 0.61),
    (4, 2, 2, "ACC-D", 0.29, 0.44),
]


def png(r: int, g: int, b: int, size: int = 4) -> bytes:
    """A tiny valid RGB PNG (no image library needed)."""
    raw = b"".join(b"\x00" + bytes([r, g, b]) * size for _ in range(size))
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def write(root: Path, rel: str, data) -> str:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, Path):
        shutil.copy(data, p)
    elif isinstance(data, bytes):
        p.write_bytes(data)
    else:
        p.write_text(data)
    return rel


def boundary(keys: str) -> dict:
    """The fixture ortho's boundaries, with the old app's property names."""
    src = json.loads((FIX / "geojson/e2e-plot-boundaries.geojson").read_text())
    for f in src["features"]:
        p = f["properties"]
        if keys == "old":  # plot_record_utils' alternatives: Plot/Tier/Bed/Label
            f["properties"] = {"Plot": p["plot"], "Tier": p["row"], "Bed": p["column"], "Label": p["accession"]}
    return src


def main() -> None:
    app, data = HERE / "app", HERE / "data"
    # Empty the folders rather than replace them: a running dev stack
    # bind-mounts them, and a replaced folder would leave it seeing none.
    for d in (app, data):
        d.mkdir(parents=True, exist_ok=True)
        for child in d.iterdir():
            shutil.rmtree(child) if child.is_dir() else child.unlink()

    # ── Raw uploads ────────────────────────────────────────────────────────
    images = f"{SCOPE}/{AERIAL_DATE}/Drone/RGB/Images"
    for name in ("test_image_001.jpg", "test_image_002.jpg"):
        write(data, f"{images}/{name}", FIX / "images" / name)
    design = f"{SCOPE}/FieldDesign"
    write(data, f"{design}/field_design.csv", "row,col,plot,accession\n1,1,1,ACC-A\n1,2,2,ACC-B\n2,1,3,ACC-C\n2,2,4,ACC-D\n")
    amiga = f"{SCOPE}/{GROUND_DATE}/Amiga/RGB/Images"
    shutil.copytree(HERE / "amiga-extract", data / amiga)
    frames = sorted(p.name for p in (data / amiga / "RGB/top").iterdir())

    # ── Aerial run outputs ─────────────────────────────────────────────────
    rgb = write(data, f"{PR}/{AERIAL_DATE}-RGB-v1.tif", FIX / "ortho/e2e_test_orthophoto.tif")
    dem = write(data, f"{PR}/{AERIAL_DATE}-DEM-v1.tif", FIX / "ortho/e2e_test_thermal.tif")
    pyramid = write(data, f"{PR}/{AERIAL_DATE}-RGB-Pyramid-v1.tif", FIX / "ortho/e2e_test_orthophoto.tif")
    b1 = write(data, f"{IP}/Plot-Boundary-WGS84_v1.geojson", json.dumps(boundary("new")))
    b2 = write(data, f"{IP}/Plot-Boundary-WGS84_v2.geojson", json.dumps(boundary("old")))
    write(data, f"{IP}/Plot-Boundary-WGS84.geojson", json.dumps(boundary("old")))
    traits_geo = boundary("new")
    for f, (_, _, _, _, vf, h) in zip(traits_geo["features"], PLOTS):
        f["properties"].update(Vegetation_Fraction=vf, Height_95p_meters=h)
    tgeo = write(data, f"{PR}/Traits-WGS84.geojson", json.dumps(traits_geo))
    for plot, *_ in PLOTS:
        write(data, f"{PR}/cropped_images/plot_{plot}.png", png(40 * plot, 120, 60))
    preds = write(data, f"{PR}/roboflow_predictions_pods.csv",
                  "image,class,confidence,x,y,width,height\nplot_1.png,pod,0.91,10,12,4,5\n")

    # ── Ground run outputs ─────────────────────────────────────────────────
    marks = write(data, f"{IP}/plot_borders_v1.csv",
                  "plot_id,start_image,end_image,direction,start_lat,start_lon,end_lat,end_lon\n"
                  f"1,{frames[0]},{frames[1]},South,38.5366,-121.7765,38.5365,-121.7765\n"
                  f"2,{frames[2]},{frames[3]},South,38.5364,-121.7765,38.5363,-121.7765\n")
    stitch = f"{PR_G}/AgRowStitch_v1"
    for n in (1, 2):
        write(data, f"{stitch}/full_res_mosaic_temp_plot_{n}.png", png(90, 90 + 40 * n, 30))
    write(data, f"{stitch}/plot_boundaries.geojson", json.dumps(boundary("new")))
    assoc = write(data, f"{IP}/{GROUND_DATE}/Amiga/RGB/association_v1.csv", "plot_id,tif_index\n1,1\n2,2\n")
    write(data, f"{PR_G}/cropped_images/plot_1.png", png(200, 100, 50))

    # ── Reference data ─────────────────────────────────────────────────────
    ref_csv = "Plot,Row,Col,Entry,LAI\n1,1,1,ACC-A,2.1\n2,1,2,ACC-B,1.8\n3,2,1,ACC-C,2.6\n4,2,2,ACC-D,1.5\n"
    write(data, f"reference_data/{REF}/lai.csv", ref_csv)

    # ── Database ───────────────────────────────────────────────────────────
    conn = sqlite3.connect(app / "gemi.db")
    conn.executescript(SCHEMA.read_text())
    x = conn.execute
    x('INSERT INTO "user" (email, is_active, is_superuser, full_name, id, hashed_password) '
      "VALUES ('admin@example.com', 1, 1, NULL, ?, 'x')", (OWNER.hex,))
    uploads = [
        (U_IMG, "Image Data", AERIAL_DATE, "Drone", "RGB", images, None, 2, "completed", "2025-06-11T09:15:00"),
        (U_DESIGN, "Field Design", "", None, None, design, None, 1, "completed", "2025-06-01T08:00:00"),
        (U_MISSING, "Image Data", "2025-06-20", "Drone", "RGB", f"{SCOPE}/2025-06-20/Drone/RGB/Images",
         None, 5, "missing", "2025-06-21T10:00:00"),
        (U_AMIGA, "Farm-ng Binary File", GROUND_DATE, "Amiga", "RGB", amiga,
         f"{amiga}/RGB/Metadata/msgs_synced.csv", 4, "completed", "2025-07-16T07:30:00"),
    ]
    for id_, dtype, date, platform, sensor, path, msgs, count, status, created in uploads:
        x("INSERT INTO fileupload (id, owner_id, data_type, experiment, location, population, date, "
          "platform, sensor, storage_path, msgs_synced_path, file_count, status, created_at) "
          "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          (id_.hex, OWNER.hex, dtype, E, L, P, date, platform, sensor, path, msgs, count, status, created))
    x("INSERT INTO workspace (name, description, id, owner_id, created_at) VALUES (?,?,?,?,?)",
      (WS, "Imported from the fixture", WS_ID.hex, OWNER.hex, "2025-06-01T00:00:00+00:00"))
    pipelines = [
        (P_AERIAL, "Drone pipe", "aerial", {"odm_preset": "draft", "pc_quality": "lowest", "custom_odm_options": "",
                                            "roboflow_models": [], "inference_mode": "cloud"}),
        (P_GROUND, "Amiga pipe", "ground", {"device": "cpu", "num_cpu": 2, "custom_agrowstitch_options": "",
                                            "agrowstitch_params": {"forward_limit": 5}}),
    ]
    for id_, name, typ, cfg in pipelines:
        x("INSERT INTO pipeline (name, type, config, id, workspace_id, created_at) VALUES (?,?,?,?,?,?)",
          (name, typ, json.dumps(cfg), id_.hex, WS_ID.hex, "2025-06-02T00:00:00+00:00"))
    aerial_outputs = {
        "orthomosaics": [{"version": 1, "name": "First ODM", "rgb": rgb, "dem": dem, "pyramid": pyramid,
                          "created_at": "2025-06-12T10:00:00+00:00"}],
        "active_ortho_version": 1,
        "plot_boundaries": [
            {"version": 1, "name": "Grid", "geojson_path": b1, "ortho_version": 1,
             "created_at": "2025-06-12T11:00:00+00:00"},
            {"version": 2, "name": "Adjusted", "geojson_path": b2, "ortho_version": 1,
             "created_at": "2025-06-12T12:00:00+00:00"},
        ],
        "active_plot_boundary_version": 2,
        "traits_geojson": tgeo,
        "cropped_images": f"{PR}/cropped_images",
        "inference": [{"label": "pods", "csv_path": preds, "trait_version": 1,
                       "created_at": "2025-06-13T09:00:00+00:00"}],
    }
    ground_outputs = {
        "plot_markings": [{"version": 1, "name": "Rows", "csv_path": marks,
                           "created_at": "2025-07-16T08:00:00+00:00"}],
        "active_plot_marking_version": 1,
        "stitchings": [{"version": 1, "name": "First stitch", "dir": stitch, "plot_count": 2,
                        "succeeded_plots": 2, "failed_plots": 0, "plot_marking_version": 1,
                        "created_at": "2025-07-16T09:00:00+00:00"}],
        "stitching_version": 1,
        "associations": [{"version": 1, "stitch_version": 1, "boundary_version": None,
                          "association_path": assoc, "matched": 2, "total": 2,
                          "created_at": "2025-07-16T10:00:00+00:00"}],
        "cropped_images": f"{PR_G}/cropped_images",
    }
    runs = [
        (R_AERIAL, P_AERIAL, U_IMG, AERIAL_DATE, "Drone", "RGB",
         {"data_sync": True, "orthomosaic": True, "plot_boundary_prep": True, "trait_extraction": True,
          "inference": True}, aerial_outputs, "2025-06-11T12:00:00+00:00"),
        (R_GROUND, P_GROUND, U_AMIGA, GROUND_DATE, "Amiga", "RGB",
         {"data_sync": True, "plot_marking": True, "stitching": True, "associate_boundaries": True},
         ground_outputs, "2025-07-16T07:45:00+00:00"),
    ]
    for id_, pipe, upload, date, platform, sensor, steps, outputs, created in runs:
        x("INSERT INTO pipelinerun (pipeline_id, file_upload_id, date, experiment, location, population, "
          "platform, sensor, status, current_step, steps_completed, outputs, error, id, created_at, "
          "completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          (pipe.hex, upload.hex, date, E, L, P, platform, sensor, "completed", None, json.dumps(steps),
           json.dumps(outputs), None, id_.hex, created, created))
    x("INSERT INTO traitrecord (id, run_id, geojson_path, ortho_version, ortho_name, boundary_version, "
      "boundary_name, version, plot_count, trait_columns, vf_avg, height_avg, created_at) "
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      (T_AERIAL.hex, R_AERIAL.hex, tgeo, 1, "First ODM", 2, "Adjusted", 1, len(PLOTS),
       json.dumps(["Vegetation_Fraction", "Height_95p_meters"]), 0.405, 0.5125, "2025-06-12T13:00:00+00:00"))
    for n, (plot, row, col, acc, vf, h) in enumerate(PLOTS):
        x("INSERT INTO plotrecord (id, trait_record_id, run_id, pipeline_id, pipeline_type, pipeline_name, "
          "workspace_id, workspace_name, date, experiment, location, population, platform, sensor, "
          "trait_record_version, plot_id, accession, col, row, geometry_wkt, traits, extra_properties, "
          "created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          (uid(0x100 + n).hex, T_AERIAL.hex, R_AERIAL.hex, str(P_AERIAL), "aerial", "Drone pipe",
           str(WS_ID), WS, AERIAL_DATE, E, L, P, "Drone", "RGB", 1, str(plot), acc, f"{col}.0", str(row),
           None, json.dumps({"Vegetation_Fraction": vf, "Height_95p_meters": h}), "{}",
           "2025-06-12T13:00:00+00:00"))
    # A plot id that isn't a whole number: kept, unlinked, never dropped.
    x("INSERT INTO plotrecord (id, trait_record_id, run_id, pipeline_id, pipeline_type, pipeline_name, "
      "workspace_id, workspace_name, date, experiment, location, population, platform, sensor, "
      "trait_record_version, plot_id, accession, col, row, geometry_wkt, traits, extra_properties, "
      "created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      (uid(0x1FF).hex, T_AERIAL.hex, R_AERIAL.hex, str(P_AERIAL), "aerial", "Drone pipe",
       str(WS_ID), WS, AERIAL_DATE, E, L, P, "Drone", "RGB", 1, "5A", "ACC-E", "1", "3",
       None, json.dumps({"Vegetation_Fraction": 0.33, "Height_95p_meters": 0.4}), "{}",
       "2025-06-12T13:00:00+00:00"))
    x("INSERT INTO referencedataset (id, name, experiment, location, population, date, column_mapping, "
      "plot_count, trait_columns, original_filename, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      (REF.hex, "LAI survey", E, L, P, "2025-06-15",
       json.dumps({"Plot": "plot_id", "Row": "row", "Col": "col", "Entry": "accession", "LAI": "LAI"}),
       len(PLOTS), json.dumps(["LAI"]), "lai.csv", "2025-06-16T00:00:00"))
    lai = {1: 2.1, 2: 1.8, 3: 2.6, 4: 1.5}
    for n, (plot, row, col, acc, *_ ) in enumerate(PLOTS):
        x("INSERT INTO referenceplot (id, dataset_id, plot_id, col, row, accession, traits) "
          "VALUES (?,?,?,?,?,?,?)",
          (uid(0x200 + n).hex, REF.hex, str(plot), str(col), str(row), acc, json.dumps({"LAI": lai[plot]})))
    # A second, unrelated dataset with the same name (another date).
    x("INSERT INTO referencedataset (id, name, experiment, location, population, date, column_mapping, "
      "plot_count, trait_columns, original_filename, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      (REF2.hex, "LAI survey", E, L, P, "2025-08-01", json.dumps({"Plot": "plot_id", "LAI": "LAI"}),
       2, json.dumps(["LAI"]), None, "2025-08-02T00:00:00"))
    for n, plot in enumerate((1, 2)):
        x("INSERT INTO referenceplot (id, dataset_id, plot_id, col, row, accession, traits) "
          "VALUES (?,?,?,?,?,?,?)",
          (uid(0x300 + n).hex, REF2.hex, str(plot), None, None, None, json.dumps({"LAI": 3.0 + plot})))
    x("INSERT INTO workspacereferencedataset (workspace_id, dataset_id, created_at) VALUES (?,?,?)",
      (WS_ID.hex, REF.hex, "2025-06-16T00:00:00"))
    conn.commit()
    conn.close()
    print(f"wrote {app / 'gemi.db'} and {data}")


if __name__ == "__main__":
    main()
