"""Build the fixture "previous GEMI install" (v0.0.5) used by the dev stack
and the legacy-import E2E: app/gemi.db + data/ (the old data folder).

The database uses the exact schema GEMI v0.0.5's own code created
(backend/tests/fixtures/gemi_legacy/schema-v0.0.5.sql). Rows are stored the
old app's way: 32-hex UUIDs, ISO-string timestamps, paths relative to the
data folder.

    python3 frontend/tests/fixtures/legacy/make_fixture.py

Contents:
- Image Data: 2 drone images (E2E-legacy-fixture / Davis / Cowpea MAGIC,
  2025-06-10, Drone / RGB)
- Field Design: one CSV
- an upload the old app had already marked missing (the import skips it
  and says why)
"""
import shutil
import sqlite3
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
SCHEMA = REPO / "backend/tests/fixtures/gemi_legacy/schema-v0.0.5.sql"
IMAGES = REPO / "frontend/tests/fixtures/images"

EXPERIMENT = "E2E-legacy-fixture"
SCOPE = f"Raw/2025/{EXPERIMENT}/Davis/Cowpea MAGIC"
OWNER = uuid.UUID("00000000-0000-4000-8000-000000000001").hex


def main() -> None:
    app, data = HERE / "app", HERE / "data"
    for d in (app, data):
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)

    images = f"{SCOPE}/2025-06-10/Drone/RGB/Images"
    (data / images).mkdir(parents=True)
    for name in ("test_image_001.jpg", "test_image_002.jpg"):
        shutil.copy(IMAGES / name, data / images / name)
    design = f"{SCOPE}/FieldDesign"
    (data / design).mkdir(parents=True)
    (data / design / "field_design.csv").write_text(
        "row,col,plot,accession\n1,1,101,IT97K-499-35\n1,2,102,CB27\n"
    )

    conn = sqlite3.connect(app / "gemi.db")
    conn.executescript(SCHEMA.read_text())
    conn.execute(
        'INSERT INTO "user" (email, is_active, is_superuser, full_name, id, hashed_password) '
        "VALUES ('admin@example.com', 1, 1, NULL, ?, 'x')",
        (OWNER,),
    )
    uploads = [
        ("Image Data", "2025-06-10", "Drone", "RGB", images, 2, "completed", "2025-06-11T09:15:00"),
        ("Field Design", "", None, None, design, 1, "completed", "2025-06-01T08:00:00"),
        ("Image Data", "2025-06-20", "Drone", "RGB", f"{SCOPE}/2025-06-20/Drone/RGB/Images", 5,
         "missing", "2025-06-21T10:00:00"),
    ]
    for i, (dtype, date, platform, sensor, path, count, status, created) in enumerate(uploads):
        conn.execute(
            "INSERT INTO fileupload (id, owner_id, data_type, experiment, location, population, date, "
            "platform, sensor, storage_path, file_count, status, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (uuid.UUID(int=i + 1).hex, OWNER, dtype, EXPERIMENT, "Davis", "Cowpea MAGIC", date,
             platform, sensor, path, count, status, created),
        )
    conn.commit()
    conn.close()
    print(f"wrote {app / 'gemi.db'} and {data}")


if __name__ == "__main__":
    main()
