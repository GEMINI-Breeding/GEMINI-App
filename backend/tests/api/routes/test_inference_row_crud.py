"""
Tests for the row-level label CRUD routes (add/update/delete one prediction
row) used by the labeling/review tool. `_resolve_label_csv` is monkeypatched
to point directly at a temp CSV file — these routes' only real logic is the
CSV read-modify-write cycle, so this exercises that directly without needing
to construct a full Workspace/Pipeline/PipelineRun/RunPaths chain.
"""

import csv
import json
import uuid
from pathlib import Path

import pytest

from app.api.routes import processing as processing_routes
from app.api.routes.processing import (
    InferenceRowCreate,
    InferenceRowUpdate,
    add_inference_row,
    delete_inference_row,
    update_inference_row,
)

FIELDNAMES = [
    "image", "plot_index", "plot_label", "accession", "row", "col", "model_id",
    "class", "confidence", "x", "y", "width", "height", "points", "verified",
]


@pytest.fixture
def csv_path(tmp_path: Path) -> Path:
    path = tmp_path / "roboflow_predictions_test.csv"
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerow({
            "image": "plot_1.png", "class": "weed", "confidence": "0.42",
            "x": "10", "y": "20", "width": "30", "height": "40",
        })
        writer.writerow({
            "image": "plot_1.png", "class": "crop", "confidence": "0.9",
            "x": "100", "y": "120", "width": "50", "height": "60",
        })
    return path


@pytest.fixture(autouse=True)
def _patch_resolver(monkeypatch: pytest.MonkeyPatch, csv_path: Path):
    def _fake_resolve(session, run_id, label):
        return None, None, csv_path

    monkeypatch.setattr(processing_routes, "_resolve_label_csv", _fake_resolve)


def _read_rows(csv_path: Path) -> list[dict]:
    with open(csv_path, newline="") as f:
        return list(csv.DictReader(f))


def test_add_row_geometry(csv_path: Path) -> None:
    result = add_inference_row(
        session=None,  # type: ignore[arg-type]
        current_user=None,  # type: ignore[arg-type]
        id=uuid.uuid4(),
        label="test",
        body=InferenceRowCreate(image="plot_2.png", label_class="weed", x=1, y=2, width=3, height=4),
    )
    assert result["status"] == "added"
    assert result["row_index"] == 2

    rows = _read_rows(csv_path)
    assert len(rows) == 3
    new_row = rows[2]
    assert new_row["image"] == "plot_2.png"
    assert new_row["class"] == "weed"
    assert new_row["confidence"] == "1.0"
    assert new_row["verified"] == "1"
    assert new_row["x"] == "1.0"


def test_add_row_polygon(csv_path: Path) -> None:
    points = [{"x": 1.0, "y": 2.0}, {"x": 3.0, "y": 4.0}, {"x": 5.0, "y": 6.0}]
    add_inference_row(
        session=None,  # type: ignore[arg-type]
        current_user=None,  # type: ignore[arg-type]
        id=uuid.uuid4(),
        label="test",
        body=InferenceRowCreate(image="plot_3.png", label_class="leaf", points=points),
    )
    rows = _read_rows(csv_path)
    assert json.loads(rows[2]["points"]) == points
    # No geometry provided for a polygon-only row — x/y/width/height stay blank.
    assert rows[2]["x"] == ""


def test_add_row_classification(csv_path: Path) -> None:
    """A classification label has no geometry at all."""
    add_inference_row(
        session=None,  # type: ignore[arg-type]
        current_user=None,  # type: ignore[arg-type]
        id=uuid.uuid4(),
        label="test",
        body=InferenceRowCreate(image="plot_4.png", label_class="healthy"),
    )
    rows = _read_rows(csv_path)
    assert rows[2]["class"] == "healthy"
    assert rows[2]["x"] == ""
    assert rows[2]["points"] == ""


def test_update_row_class_and_verify(csv_path: Path) -> None:
    result = update_inference_row(
        session=None,  # type: ignore[arg-type]
        current_user=None,  # type: ignore[arg-type]
        id=uuid.uuid4(),
        label="test",
        row_index=0,
        body=InferenceRowUpdate(label_class="grass", verified=True),
    )
    assert result["status"] == "updated"

    rows = _read_rows(csv_path)
    assert rows[0]["class"] == "grass"
    assert rows[0]["verified"] == "1"
    # Untouched fields stay as they were.
    assert rows[0]["confidence"] == "0.42"
    assert rows[0]["x"] == "10"
    # The other row is unaffected.
    assert rows[1]["class"] == "crop"


def test_update_row_geometry(csv_path: Path) -> None:
    update_inference_row(
        session=None,  # type: ignore[arg-type]
        current_user=None,  # type: ignore[arg-type]
        id=uuid.uuid4(),
        label="test",
        row_index=1,
        body=InferenceRowUpdate(x=999, y=888),
    )
    rows = _read_rows(csv_path)
    assert rows[1]["x"] == "999.0"
    assert rows[1]["y"] == "888.0"
    # width/height untouched.
    assert rows[1]["width"] == "50"


def test_update_row_out_of_range(csv_path: Path) -> None:
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        update_inference_row(
            session=None,  # type: ignore[arg-type]
            current_user=None,  # type: ignore[arg-type]
            id=uuid.uuid4(),
            label="test",
            row_index=99,
            body=InferenceRowUpdate(verified=True),
        )
    assert exc_info.value.status_code == 404


def test_delete_row(csv_path: Path) -> None:
    result = delete_inference_row(
        session=None,  # type: ignore[arg-type]
        current_user=None,  # type: ignore[arg-type]
        id=uuid.uuid4(),
        label="test",
        row_index=0,
    )
    assert result["status"] == "deleted"

    rows = _read_rows(csv_path)
    assert len(rows) == 1
    assert rows[0]["class"] == "crop"


def test_delete_row_out_of_range(csv_path: Path) -> None:
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc_info:
        delete_inference_row(
            session=None,  # type: ignore[arg-type]
            current_user=None,  # type: ignore[arg-type]
            id=uuid.uuid4(),
            label="test",
            row_index=5,
        )
    assert exc_info.value.status_code == 404
