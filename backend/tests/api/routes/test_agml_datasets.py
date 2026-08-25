"""
Tests for the AgML dataset discovery routes. No mocking needed — agml's
catalog lookups (`public_data_sources`/`source`) are fully offline, reading a
bundled local resource, same as its benchmark JSON files.
"""

from fastapi.testclient import TestClient

from app.core.config import settings

# A real, stable dataset name from agml's bundled catalog, used across tests.
_REAL_DATASET = "bean_disease_uganda"


def test_list_datasets(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/agml/datasets")
    assert response.status_code == 200
    content = response.json()
    assert isinstance(content, list)
    assert len(content) > 100  # the real catalog has thousands of entries


def test_list_datasets_filtered(client: TestClient) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/agml/datasets",
        params={"ml_task": "image_classification", "location": "continent:africa"},
    )
    assert response.status_code == 200
    content = response.json()
    assert len(content) > 0
    for item in content:
        assert item["ml_task"] == "image_classification"
        assert item["location"]["continent"] == "africa"


def test_get_dataset(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/agml/datasets/{_REAL_DATASET}")
    assert response.status_code == 200
    content = response.json()
    assert content["name"] == _REAL_DATASET
    assert content["ml_task"] == "image_classification"


def test_get_dataset_not_found(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/agml/datasets/this-dataset-does-not-exist")
    assert response.status_code == 404


def test_similar_datasets(client: TestClient) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/agml/datasets/{_REAL_DATASET}/similar",
        params={"limit": 3},
    )
    assert response.status_code == 200
    content = response.json()
    assert content["source"] == _REAL_DATASET
    assert len(content["candidates"]) <= 3
    for candidate in content["candidates"]:
        assert candidate["name"] != _REAL_DATASET


def test_similar_datasets_not_found(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/agml/datasets/this-dataset-does-not-exist/similar")
    assert response.status_code == 404


def test_leaderboard(client: TestClient) -> None:
    response = client.get(f"{settings.API_V1_STR}/agml/leaderboard")
    assert response.status_code == 200
    content = response.json()
    assert content["status"] == "ok"
    assert content["source"] == "agml-bundled"
    assert len(content["models"]) > 0


def test_select_list_delete_round_trip(client: TestClient) -> None:
    # Ensure a clean slate in case a prior run left this selected.
    client.delete(f"{settings.API_V1_STR}/agml/selected/{_REAL_DATASET}")

    select_response = client.post(
        f"{settings.API_V1_STR}/agml/selected",
        json={"dataset_name": _REAL_DATASET, "notes": "test note"},
    )
    assert select_response.status_code == 200
    selected_content = select_response.json()
    assert selected_content["dataset_name"] == _REAL_DATASET
    assert selected_content["notes"] == "test note"
    assert selected_content["dataset_metadata"]["selected"] is True

    list_response = client.get(f"{settings.API_V1_STR}/agml/selected")
    assert list_response.status_code == 200
    names = [row["dataset_name"] for row in list_response.json()]
    assert _REAL_DATASET in names

    # Re-selecting (upsert) should update notes, not create a duplicate row.
    reselect_response = client.post(
        f"{settings.API_V1_STR}/agml/selected",
        json={"dataset_name": _REAL_DATASET, "notes": "updated note"},
    )
    assert reselect_response.status_code == 200
    assert reselect_response.json()["notes"] == "updated note"
    names_after = [row["dataset_name"] for row in client.get(f"{settings.API_V1_STR}/agml/selected").json()]
    assert names_after.count(_REAL_DATASET) == 1

    delete_response = client.delete(f"{settings.API_V1_STR}/agml/selected/{_REAL_DATASET}")
    assert delete_response.status_code == 200

    names_after_delete = [row["dataset_name"] for row in client.get(f"{settings.API_V1_STR}/agml/selected").json()]
    assert _REAL_DATASET not in names_after_delete


def test_select_unknown_dataset(client: TestClient) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/agml/selected",
        json={"dataset_name": "this-dataset-does-not-exist"},
    )
    assert response.status_code == 404


def test_unselect_not_selected(client: TestClient) -> None:
    response = client.delete(f"{settings.API_V1_STR}/agml/selected/this-dataset-was-never-selected")
    assert response.status_code == 404
